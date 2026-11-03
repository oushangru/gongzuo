'use strict';

/**
 * 应用层：Express 路由 + 静态资源服务。
 */

const express = require('express');
const path = require('node:path');
const {
  STATUS,
  ALL_STATUSES,
  isValidDate,
  listApplications,
  getApplication,
  createApplication,
  updateApplication,
  deleteApplication,
  getStats,
} = require('./db');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ECHARTS_DIR = path.join(__dirname, '..', 'node_modules', 'echarts', 'dist');

/** 把路由参数解析为合法正整数 id，解析失败返回 null */
function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function createApp(db) {
  const app = express();

  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));
  // ECharts 从本地 node_modules 提供，保证离线可用
  app.use('/vendor', express.static(ECHARTS_DIR));

  // ---------- 看板统计 ----------
  app.get('/api/stats', (req, res) => {
    res.json(getStats(db));
  });

  // ---------- 投递记录列表 ----------
  app.get('/api/applications', (req, res) => {
    const { status, search, sort } = req.query;
    if (status && !ALL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `无效的状态筛选: ${status}` });
    }
    const items = listApplications(db, { status, search, sort });
    res.json({ items, total: items.length });
  });

  // ---------- 投递记录详情 ----------
  app.get('/api/applications/:id', (req, res) => {
    const id = parseId(req.params.id);
    const item = id === null ? null : getApplication(db, id);
    if (!item) return res.status(404).json({ error: '记录不存在' });
    res.json(item);
  });

  // ---------- 新增投递 ----------
  app.post('/api/applications', (req, res) => {
    const { company, position, apply_date, notes } = req.body || {};
    const errors = validateBasics({ company, position, apply_date });
    if (errors.length) return res.status(400).json({ error: errors.join('；') });
    const item = createApplication(db, {
      company: String(company).trim(),
      position: String(position).trim(),
      apply_date,
      notes: notes === undefined ? null : String(notes),
    });
    res.status(201).json(item);
  });

  // ---------- 修改投递（基本信息 + 阶段时间均可改） ----------
  app.put('/api/applications/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null || !getApplication(db, id)) {
      return res.status(404).json({ error: '记录不存在' });
    }
    const body = req.body || {};
    const errors = [];
    if (body.company !== undefined && (!body.company || !String(body.company).trim())) {
      errors.push('公司名称不能为空');
    }
    if (body.position !== undefined && (!body.position || !String(body.position).trim())) {
      errors.push('岗位名称不能为空');
    }
    if (body.apply_date !== undefined && !isValidDate(body.apply_date)) {
      errors.push('投递时间必须是有效日期 (YYYY-MM-DD)');
    }
    if (errors.length) return res.status(400).json({ error: errors.join('；') });

    const fields = { ...body };
    if (body.company !== undefined) fields.company = String(body.company).trim();
    if (body.position !== undefined) fields.position = String(body.position).trim();
    if (body.notes !== undefined) fields.notes = body.notes === '' ? null : String(body.notes);

    try {
      const item = updateApplication(db, id, fields);
      res.json(item);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ---------- 状态流转（进入面试 / 拿到 Offer / 未通过） ----------
  app.patch('/api/applications/:id/status', (req, res) => {
    const id = parseId(req.params.id);
    if (id === null || !getApplication(db, id)) {
      return res.status(404).json({ error: '记录不存在' });
    }
    const { status, date, reason } = req.body || {};
    if (!ALL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `无效状态: ${status}，可选: ${ALL_STATUSES.join(', ')}` });
    }
    if (date !== undefined && date !== null && date !== '') {
      if (!isValidDate(date)) {
        return res.status(400).json({ error: '日期必须是有效日期 (YYYY-MM-DD)' });
      }
    }

    const fields = { status };
    if (status === STATUS.INTERVIEWED && date) fields.interview_date = date;
    if (status === STATUS.OFFERED && date) fields.offer_date = date;
    if (status === STATUS.REJECTED) {
      if (date) fields.end_date = date;
      fields.end_reason = reason === undefined || reason === '' ? '未通过' : String(reason);
    }

    try {
      const item = updateApplication(db, id, fields);
      res.json(item);
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ---------- 删除投递 ----------
  app.delete('/api/applications/:id', (req, res) => {
    const id = parseId(req.params.id);
    const ok = id !== null && deleteApplication(db, id);
    if (!ok) return res.status(404).json({ error: '记录不存在' });
    res.status(204).end();
  });

  // ---------- 未匹配的 API 请求 ----------
  app.use('/api', (req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  // ---------- 统一错误处理 ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: '请求体不是合法 JSON' });
    }
    console.error('[server error]', err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  return app;
}

/** 新增投递时的必填与格式校验 */
function validateBasics({ company, position, apply_date }) {
  const errors = [];
  if (!company || !String(company).trim()) errors.push('公司名称不能为空');
  else if (String(company).trim().length > 200) errors.push('公司名称过长');
  if (!position || !String(position).trim()) errors.push('岗位名称不能为空');
  else if (String(position).trim().length > 200) errors.push('岗位名称过长');
  if (!apply_date) errors.push('投递时间不能为空');
  else if (!isValidDate(apply_date)) errors.push('投递时间必须是有效日期 (YYYY-MM-DD)');
  return errors;
}

module.exports = { createApp };
