'use strict';

/**
 * 数据库层：基于 Node.js 内置的 node:sqlite（SQLite 3），零外部数据库依赖。
 * 负责建表、增删改查与统计查询。
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

/** 应用状态常量 */
const STATUS = Object.freeze({
  APPLIED: 'applied',         // 已投递
  INTERVIEWED: 'interviewed', // 面试中
  OFFERED: 'offered',         // 已拿到 Offer
  REJECTED: 'rejected',       // 未通过 / 已结束
});

const ALL_STATUSES = Object.values(STATUS);

/** 状态 → 中文标签 */
const STATUS_LABELS = Object.freeze({
  [STATUS.APPLIED]: '已投递',
  [STATUS.INTERVIEWED]: '面试中',
  [STATUS.OFFERED]: '已拿到 Offer',
  [STATUS.REJECTED]: '未通过/已结束',
});

/** 当前本地日期，格式 YYYY-MM-DD */
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 校验 YYYY-MM-DD 是否为真实存在的日期 */
function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** 打开（或创建）数据库并初始化表结构 */
function openDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS applications (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      company        TEXT NOT NULL,
      position       TEXT NOT NULL,
      apply_date     TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT '${STATUS.APPLIED}',
      interview_date TEXT,
      offer_date     TEXT,
      end_date       TEXT,
      end_reason     TEXT,
      notes          TEXT,
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_app_status  ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_app_apply   ON applications(apply_date);
    CREATE INDEX IF NOT EXISTS idx_app_company ON applications(company);
  `);
  return db;
}

/** 数据库行 → API 输出对象 */
function rowToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    company: row.company,
    position: row.position,
    apply_date: row.apply_date,
    status: row.status,
    interview_date: row.interview_date || null,
    offer_date: row.offer_date || null,
    end_date: row.end_date || null,
    end_reason: row.end_reason || null,
    notes: row.notes || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** 投递记录列表（支持状态筛选 / 关键词搜索 / 排序） */
function listApplications(db, { status, search, sort } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (search) {
    where.push('(company LIKE ? OR position LIKE ?)');
    const kw = `%${search}%`;
    params.push(kw, kw);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderMap = {
    apply_date_desc: 'apply_date DESC, id DESC',
    apply_date_asc: 'apply_date ASC, id ASC',
    created_desc: 'created_at DESC, id DESC',
  };
  const orderSql = orderMap[sort] || orderMap.apply_date_desc;
  const rows = db.prepare(`SELECT * FROM applications ${whereSql} ORDER BY ${orderSql}`).all(...params);
  return rows.map(rowToApi);
}

/** 单条记录详情 */
function getApplication(db, id) {
  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(id);
  return rowToApi(row);
}

/** 新增投递记录（默认状态：已投递） */
function createApplication(db, { company, position, apply_date, notes }) {
  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO applications (company, position, apply_date, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(company, position, apply_date, STATUS.APPLIED, notes || null, now, now);
  return getApplication(db, Number(info.lastInsertRowid));
}

/** 可编辑字段白名单 */
const EDITABLE_FIELDS = [
  'company', 'position', 'apply_date', 'notes',
  'status', 'interview_date', 'offer_date', 'end_date', 'end_reason',
];

/**
 * 更新投递记录（白名单字段）。
 * 状态联动规则：
 *  - 流转到 面试中：未指定面试时间时自动记录今天
 *  - 流转到 Offer：未指定 Offer 时间时自动记录今天
 *  - 流转到 未通过：未指定结束时间时自动记录今天；未指定原因时默认「未通过」
 *  - 从 未通过 回到进行中状态：自动清空结束时间 / 结束原因
 */
function updateApplication(db, id, fields) {
  const current = getApplication(db, id);
  if (!current) return null;

  const allowed = {};
  for (const key of Object.keys(fields)) {
    if (!EDITABLE_FIELDS.includes(key)) continue;
    let value = fields[key];
    if (value === undefined) continue;
    if (value === '') value = null;
    allowed[key] = value;
  }

  if ('status' in allowed) {
    const st = allowed.status;
    if (!ALL_STATUSES.includes(st)) {
      const err = new Error(`无效状态: ${st}`);
      err.status = 400;
      throw err;
    }
    if (st === STATUS.INTERVIEWED && !allowed.interview_date && !current.interview_date) {
      allowed.interview_date = todayStr();
    }
    if (st === STATUS.OFFERED && !allowed.offer_date && !current.offer_date) {
      allowed.offer_date = todayStr();
    }
    if (st === STATUS.REJECTED) {
      if (!allowed.end_date && !current.end_date) allowed.end_date = todayStr();
      if (!allowed.end_reason) allowed.end_reason = current.end_reason || '未通过';
    }
    if (st !== STATUS.REJECTED) {
      if (!('end_date' in allowed)) allowed.end_date = null;
      if (!('end_reason' in allowed)) allowed.end_reason = null;
    }
  }

  for (const key of ['apply_date', 'interview_date', 'offer_date', 'end_date']) {
    if (key in allowed && allowed[key] !== null && !isValidDate(allowed[key])) {
      const err = new Error(`${key} 不是有效日期 (YYYY-MM-DD)`);
      err.status = 400;
      throw err;
    }
  }

  const sets = ['updated_at = ?'];
  const params = [new Date().toISOString()];
  for (const key of Object.keys(allowed)) {
    sets.push(`${key} = ?`);
    params.push(allowed[key]);
  }
  params.push(id);
  db.prepare(`UPDATE applications SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getApplication(db, id);
}

/** 删除投递记录，返回是否删除成功 */
function deleteApplication(db, id) {
  const info = db.prepare('DELETE FROM applications WHERE id = ?').run(id);
  return info.changes > 0;
}

/** 看板统计：总数 / 漏斗 / 转化率 / 月度趋势 / 最新记录 */
function getStats(db) {
  const total = db.prepare('SELECT COUNT(*) AS c FROM applications').get().c;

  const byStatus = {};
  for (const row of db.prepare('SELECT status, COUNT(*) AS c FROM applications GROUP BY status').all()) {
    byStatus[row.status] = row.c;
  }

  // 漏斗口径：以"是否发生过该阶段"为准（interview_date / offer_date 不为空）
  const interviewedCount = db.prepare('SELECT COUNT(*) AS c FROM applications WHERE interview_date IS NOT NULL').get().c;
  const offeredCount = db.prepare('SELECT COUNT(*) AS c FROM applications WHERE offer_date IS NOT NULL').get().c;

  const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

  const totals = {
    total,
    applied: byStatus[STATUS.APPLIED] || 0,
    interviewed: byStatus[STATUS.INTERVIEWED] || 0,
    offered: byStatus[STATUS.OFFERED] || 0,
    rejected: byStatus[STATUS.REJECTED] || 0,
  };

  const funnel = { submitted: total, interviewed: interviewedCount, offered: offeredCount };

  const rates = {
    interviewRate: rate(interviewedCount, total),  // 面试率 = 进入面试 / 投递总数
    offerRate: rate(offeredCount, total),          // Offer 率 = 拿 Offer / 投递总数
    passRate: rate(offeredCount, interviewedCount),// 面试通过率 = Offer / 进入面试
  };

  const monthlyTrend = buildMonthlyTrend(db);
  const recent = db.prepare('SELECT * FROM applications ORDER BY created_at DESC, id DESC LIMIT 8').all().map(rowToApi);

  return { totals, funnel, rates, monthlyTrend, recent };
}

/** 月度趋势：按月份统计投递 / 进入面试 / 获得 Offer 的数量，并补齐月份间隙 */
function buildMonthlyTrend(db) {
  const applied = db.prepare('SELECT substr(apply_date, 1, 7) AS month, COUNT(*) AS c FROM applications GROUP BY month').all();
  const interviewed = db.prepare('SELECT substr(interview_date, 1, 7) AS month, COUNT(*) AS c FROM applications WHERE interview_date IS NOT NULL GROUP BY month').all();
  const offered = db.prepare('SELECT substr(offer_date, 1, 7) AS month, COUNT(*) AS c FROM applications WHERE offer_date IS NOT NULL GROUP BY month').all();

  const months = new Set([...applied, ...interviewed, ...offered].map((r) => r.month));
  if (months.size === 0) return [];

  const sorted = [...months].sort();
  const [startY, startM] = sorted[0].split('-').map(Number);
  const [endY, endM] = sorted[sorted.length - 1].split('-').map(Number);

  const full = [];
  let y = startY;
  let m = startM;
  while (y < endY || (y === endY && m <= endM)) {
    full.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }

  const aMap = new Map(applied.map((r) => [r.month, r.c]));
  const iMap = new Map(interviewed.map((r) => [r.month, r.c]));
  const oMap = new Map(offered.map((r) => [r.month, r.c]));

  return full.map((month) => ({
    month,
    applied: aMap.get(month) || 0,
    interviewed: iMap.get(month) || 0,
    offered: oMap.get(month) || 0,
  }));
}

module.exports = {
  STATUS,
  STATUS_LABELS,
  ALL_STATUSES,
  openDatabase,
  listApplications,
  getApplication,
  createApplication,
  updateApplication,
  deleteApplication,
  getStats,
  isValidDate,
  todayStr,
};
