'use strict';

/**
 * 后端 API 集成测试（node:test + 内置 fetch，零额外依赖）。
 * 运行：npm test
 * 每个用例使用独立的内存数据库，互不影响。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { openDatabase } = require('../src/db');

/** 启动一个使用内存数据库的测试服务，返回 { server, base } */
async function startServer() {
  const db = openDatabase(':memory:');
  const app = createApp(db);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

/** 简易 HTTP 请求封装 */
async function api(base, method, url, body) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: res.status, data };
}

const sample = {
  company: '字节跳动',
  position: '后端开发工程师',
  apply_date: '2026-10-15',
  notes: '内推投递',
};

/* ================= 新增 ================= */

test('新增投递：创建成功且默认状态为「已投递」', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const { status, data } = await api(base, 'POST', '/api/applications', sample);
  assert.equal(status, 201);
  assert.equal(data.company, sample.company);
  assert.equal(data.position, sample.position);
  assert.equal(data.apply_date, sample.apply_date);
  assert.equal(data.notes, sample.notes);
  assert.equal(data.status, 'applied');
  assert.ok(data.id > 0);
  assert.ok(data.created_at);
  assert.ok(data.updated_at);
  assert.equal(data.interview_date, null);
  assert.equal(data.offer_date, null);
});

test('新增投递：缺少必填字段返回 400', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const r1 = await api(base, 'POST', '/api/applications', { position: '测试岗', apply_date: '2026-10-01' });
  assert.equal(r1.status, 400);

  const r2 = await api(base, 'POST', '/api/applications', { company: '测试公司', apply_date: '2026-10-01' });
  assert.equal(r2.status, 400);

  const r3 = await api(base, 'POST', '/api/applications', { company: '测试公司', position: '测试岗' });
  assert.equal(r3.status, 400);
});

test('新增投递：非法日期返回 400', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const r = await api(base, 'POST', '/api/applications', { company: 'A', position: 'B', apply_date: '2026-13-40' });
  assert.equal(r.status, 400);
});

/* ================= 列表 / 筛选 / 搜索 ================= */

test('列表：返回全部记录，并支持状态筛选与关键词搜索', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  await api(base, 'POST', '/api/applications', { company: '阿里巴巴', position: 'Java 开发', apply_date: '2026-09-01' });
  await api(base, 'POST', '/api/applications', { company: '腾讯', position: '前端开发', apply_date: '2026-10-01' });

  const all = await api(base, 'GET', '/api/applications');
  assert.equal(all.status, 200);
  assert.equal(all.data.total, 2);
  assert.equal(all.data.items.length, 2);

  const id = all.data.items[0].id;
  await api(base, 'PATCH', `/api/applications/${id}/status`, { status: 'interviewed' });

  const interviewed = await api(base, 'GET', '/api/applications?status=interviewed');
  assert.equal(interviewed.data.total, 1);
  assert.equal(interviewed.data.items[0].status, 'interviewed');

  const byCompany = await api(base, 'GET', '/api/applications?search=阿里');
  assert.equal(byCompany.data.total, 1);
  assert.equal(byCompany.data.items[0].company, '阿里巴巴');

  const byPosition = await api(base, 'GET', '/api/applications?search=前端');
  assert.equal(byPosition.data.total, 1);
  assert.equal(byPosition.data.items[0].position, '前端开发');

  const invalid = await api(base, 'GET', '/api/applications?status=ghost');
  assert.equal(invalid.status, 400);
});

/* ================= 状态流转 ================= */

test('状态流转：进入面试时自动记录面试时间（默认今天）', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const created = await api(base, 'POST', '/api/applications', sample);
  const { status, data } = await api(base, 'PATCH', `/api/applications/${created.data.id}/status`, { status: 'interviewed' });
  assert.equal(status, 200);
  assert.equal(data.status, 'interviewed');
  assert.ok(data.interview_date, '面试时间应被自动记录');
  assert.match(data.interview_date, /^\d{4}-\d{2}-\d{2}$/);
});

test('状态流转：手动指定的面试时间被采纳', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const created = await api(base, 'POST', '/api/applications', sample);
  const { data } = await api(base, 'PATCH', `/api/applications/${created.data.id}/status`, { status: 'interviewed', date: '2026-10-20' });
  assert.equal(data.interview_date, '2026-10-20');
});

test('状态流转：拿到 Offer 记录 Offer 时间', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const created = await api(base, 'POST', '/api/applications', sample);
  const id = created.data.id;
  await api(base, 'PATCH', `/api/applications/${id}/status`, { status: 'interviewed', date: '2026-10-20' });
  const { data } = await api(base, 'PATCH', `/api/applications/${id}/status`, { status: 'offered', date: '2026-11-01' });
  assert.equal(data.status, 'offered');
  assert.equal(data.offer_date, '2026-11-01');
});

test('状态流转：未通过记录结束时间与原因', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const created = await api(base, 'POST', '/api/applications', sample);
  const { data } = await api(base, 'PATCH', `/api/applications/${created.data.id}/status`, {
    status: 'rejected',
    date: '2026-10-25',
    reason: '笔试未通过',
  });
  assert.equal(data.status, 'rejected');
  assert.equal(data.end_date, '2026-10-25');
  assert.equal(data.end_reason, '笔试未通过');
});

test('状态流转：无效状态返回 400', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const created = await api(base, 'POST', '/api/applications', sample);
  const r = await api(base, 'PATCH', `/api/applications/${created.data.id}/status`, { status: 'ghost' });
  assert.equal(r.status, 400);
});

test('状态流转：非法日期返回 400', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const created = await api(base, 'POST', '/api/applications', sample);
  const r = await api(base, 'PATCH', `/api/applications/${created.data.id}/status`, { status: 'interviewed', date: '2026-2-30' });
  assert.equal(r.status, 400);
});

/* ================= 修改 ================= */

test('修改：更新公司、岗位、备注', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const created = await api(base, 'POST', '/api/applications', sample);
  const { status, data } = await api(base, 'PUT', `/api/applications/${created.data.id}`, {
    company: '字节跳动（上海）',
    position: '资深后端开发工程师',
    notes: '已更新备注',
  });
  assert.equal(status, 200);
  assert.equal(data.company, '字节跳动（上海）');
  assert.equal(data.position, '资深后端开发工程师');
  assert.equal(data.notes, '已更新备注');
  assert.equal(data.apply_date, sample.apply_date);
});

test('修改：公司名为空返回 400', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const created = await api(base, 'POST', '/api/applications', sample);
  const r = await api(base, 'PUT', `/api/applications/${created.data.id}`, { company: '   ' });
  assert.equal(r.status, 400);
});

/* ================= 删除 ================= */

test('删除：删除后详情返回 404', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const created = await api(base, 'POST', '/api/applications', sample);
  const del = await api(base, 'DELETE', `/api/applications/${created.data.id}`);
  assert.equal(del.status, 204);

  const get = await api(base, 'GET', `/api/applications/${created.data.id}`);
  assert.equal(get.status, 404);
});

/* ================= 404 ================= */

test('不存在的记录：GET/PUT/PATCH/DELETE 均返回 404', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  assert.equal((await api(base, 'GET', '/api/applications/999999')).status, 404);
  assert.equal((await api(base, 'PUT', '/api/applications/999999', { company: 'X' })).status, 404);
  assert.equal((await api(base, 'PATCH', '/api/applications/999999/status', { status: 'interviewed' })).status, 404);
  assert.equal((await api(base, 'DELETE', '/api/applications/999999')).status, 404);
  assert.equal((await api(base, 'GET', '/api/applications/abc')).status, 404);
});

test('未知 API 路径返回 404', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const r = await api(base, 'GET', '/api/nothing-here');
  assert.equal(r.status, 404);
});

/* ================= 统计 ================= */

test('统计：totals / funnel / rates / monthlyTrend 计算正确', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  // 3 条投递：1 条拿到 Offer（含面试）、1 条面试中、1 条未通过
  const a = await api(base, 'POST', '/api/applications', { company: 'A公司', position: '岗位A', apply_date: '2026-10-05' });
  const b = await api(base, 'POST', '/api/applications', { company: 'B公司', position: '岗位B', apply_date: '2026-10-12' });
  const c = await api(base, 'POST', '/api/applications', { company: 'C公司', position: '岗位C', apply_date: '2026-11-01' });

  await api(base, 'PATCH', `/api/applications/${a.data.id}/status`, { status: 'interviewed', date: '2026-10-10' });
  await api(base, 'PATCH', `/api/applications/${a.data.id}/status`, { status: 'offered', date: '2026-10-28' });
  await api(base, 'PATCH', `/api/applications/${b.data.id}/status`, { status: 'interviewed', date: '2026-10-20' });
  await api(base, 'PATCH', `/api/applications/${c.data.id}/status`, { status: 'rejected', date: '2026-11-02' });

  const { status, data } = await api(base, 'GET', '/api/stats');
  assert.equal(status, 200);

  // 各状态当前数量
  assert.equal(data.totals.total, 3);
  assert.equal(data.totals.applied, 0);
  assert.equal(data.totals.interviewed, 1);
  assert.equal(data.totals.offered, 1);
  assert.equal(data.totals.rejected, 1);

  // 漏斗（以"是否发生过该阶段"为准）
  assert.equal(data.funnel.submitted, 3);
  assert.equal(data.funnel.interviewed, 2);
  assert.equal(data.funnel.offered, 1);

  // 转化率
  assert.equal(data.rates.interviewRate, 66.7);
  assert.equal(data.rates.offerRate, 33.3);
  assert.equal(data.rates.passRate, 50);

  // 月度趋势：2026-10 与 2026-11 连续补齐
  const months = data.monthlyTrend.map((m) => m.month);
  assert.deepEqual(months, ['2026-10', '2026-11']);
  const oct = data.monthlyTrend.find((m) => m.month === '2026-10');
  assert.equal(oct.applied, 2);
  assert.equal(oct.interviewed, 2);
  assert.equal(oct.offered, 1);
  const nov = data.monthlyTrend.find((m) => m.month === '2026-11');
  assert.equal(nov.applied, 1);
  assert.equal(nov.interviewed, 0);
  assert.equal(nov.offered, 0);
});

test('统计：空数据库返回全零数据', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const { status, data } = await api(base, 'GET', '/api/stats');
  assert.equal(status, 200);
  assert.equal(data.totals.total, 0);
  assert.equal(data.funnel.submitted, 0);
  assert.equal(data.rates.interviewRate, 0);
  assert.equal(data.rates.offerRate, 0);
  assert.equal(data.rates.passRate, 0);
  assert.deepEqual(data.monthlyTrend, []);
  assert.deepEqual(data.recent, []);
});

/* ================= 静态资源 ================= */

test('静态资源：首页与前端脚本可访问', async (t) => {
  const { server, base } = await startServer();
  t.after(() => server.close());

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('求职进度管理'));

  const js = await fetch(`${base}/js/app.js`);
  assert.equal(js.status, 200);
});
