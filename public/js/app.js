'use strict';

/* ================= 工具函数 ================= */
const $ = (sel) => document.querySelector(sel);

const STATUS_LABELS = {
  applied: '已投递',
  interviewed: '面试中',
  offered: '已拿到 Offer',
  rejected: '未通过/已结束',
};

const STATUS_COLORS = {
  applied: '#2563eb',
  interviewed: '#d97706',
  offered: '#16a34a',
  rejected: '#94a3b8',
};

const PAGE_SIZE = 10;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDate(s) {
  return s ? s : '—';
}

let toastTimer = null;
function showToast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2500);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && data.error) || `请求失败 (${res.status})`);
  }
  return data;
}

/* ================= 状态 ================= */
const state = {
  view: 'dashboard',
  applications: [],
  search: '',
  statusFilter: '',
  page: 1,
  editingId: null,
  transition: null,
};

/* ================= 看板 ================= */
let funnelChart = null;
let trendChart = null;

function ensureCharts() {
  if (!funnelChart) funnelChart = echarts.init($('#funnelChart'));
  if (!trendChart) trendChart = echarts.init($('#trendChart'));
  window.addEventListener('resize', () => {
    if (funnelChart) funnelChart.resize();
    if (trendChart) trendChart.resize();
  });
}

function renderStatCards(d) {
  const cards = [
    { label: '累计投递', value: d.totals.total, color: '#2563eb', sub: '所有已投递记录' },
    { label: '进入面试', value: d.funnel.interviewed, color: '#d97706', sub: `面试率 ${d.rates.interviewRate}%` },
    { label: '获得 Offer', value: d.funnel.offered, color: '#16a34a', sub: `Offer 率 ${d.rates.offerRate}% · 面试通过率 ${d.rates.passRate}%` },
    { label: '未通过/已结束', value: d.totals.rejected, color: '#94a3b8', sub: `进行中 ${d.totals.applied + d.totals.interviewed} 份` },
  ];
  $('#statCards').innerHTML = cards.map((c) => `
    <div class="stat-card">
      <div class="stat-value" style="color:${c.color}">${c.value}</div>
      <div class="stat-label">${c.label}</div>
      <div class="stat-sub">${c.sub}</div>
    </div>`).join('');
}

function renderFunnel(d) {
  funnelChart.setOption({
    tooltip: { trigger: 'item', formatter: '{b}: {c} 份' },
    series: [{
      type: 'funnel',
      left: '14%',
      right: '14%',
      top: 16,
      bottom: 8,
      minSize: '30%',
      maxSize: '100%',
      sort: 'descending',
      gap: 4,
      label: {
        show: true,
        position: 'inside',
        color: '#fff',
        fontSize: 14,
        formatter: '{b}\n{c} 份',
      },
      itemStyle: { borderColor: '#fff', borderWidth: 1 },
      emphasis: { label: { fontSize: 16 } },
      data: [
        { name: '投递简历', value: d.funnel.submitted, itemStyle: { color: '#2563eb' } },
        { name: '进入面试', value: d.funnel.interviewed, itemStyle: { color: '#f59e0b' } },
        { name: '获得 Offer', value: d.funnel.offered, itemStyle: { color: '#22c55e' } },
      ],
    }],
  });
}

function renderTrend(d) {
  const months = d.monthlyTrend.map((m) => m.month);
  trendChart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['投递', '进入面试', '获得Offer'], top: 0 },
    grid: { left: 40, right: 16, top: 36, bottom: 28 },
    xAxis: {
      type: 'category',
      data: months,
      axisLabel: { rotate: months.length > 8 ? 30 : 0 },
    },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        name: '投递',
        type: 'bar',
        data: d.monthlyTrend.map((m) => m.applied),
        itemStyle: { color: '#93c5fd' },
        barMaxWidth: 28,
      },
      {
        name: '进入面试',
        type: 'line',
        smooth: true,
        data: d.monthlyTrend.map((m) => m.interviewed),
        itemStyle: { color: '#f59e0b' },
      },
      {
        name: '获得Offer',
        type: 'line',
        smooth: true,
        data: d.monthlyTrend.map((m) => m.offered),
        itemStyle: { color: '#22c55e' },
      },
    ],
  });
}

function renderRecent(items) {
  const el = $('#recentList');
  if (!items.length) {
    el.innerHTML = '<p class="empty">还没有投递记录，去「投递记录」页新增吧。</p>';
    return;
  }
  el.innerHTML = items.map((it) => `
    <div class="recent-item">
      <div class="recent-main">
        <span class="recent-company">${escapeHtml(it.company)}</span>
        <span class="recent-position">${escapeHtml(it.position)}</span>
      </div>
      <span class="status-badge" style="background:${STATUS_COLORS[it.status]}">${STATUS_LABELS[it.status]}</span>
      <span class="recent-date">${fmtDate(it.apply_date)}</span>
    </div>`).join('');
}

async function loadDashboard() {
  try {
    const d = await api('/api/stats');
    ensureCharts();
    renderStatCards(d);
    renderFunnel(d);
    renderTrend(d);
    renderRecent(d.recent);
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ================= 投递记录列表 ================= */
function statusBadge(status) {
  return `<span class="status-badge" style="background:${STATUS_COLORS[status]}">${STATUS_LABELS[status]}</span>`;
}

function actionButtons(it) {
  let btns = '';
  if (it.status === 'applied') {
    btns += `<button class="btn-mini" data-action="interview" data-id="${it.id}">进入面试</button>`;
  }
  if (it.status === 'interviewed') {
    btns += `<button class="btn-mini" data-action="offer" data-id="${it.id}">拿到Offer</button>`;
  }
  if (it.status === 'applied' || it.status === 'interviewed') {
    btns += `<button class="btn-mini btn-mini-danger" data-action="reject" data-id="${it.id}">未通过</button>`;
  }
  btns += `<button class="btn-mini btn-mini-ghost" data-action="edit" data-id="${it.id}">编辑</button>`;
  btns += `<button class="btn-mini btn-mini-ghost" data-action="delete" data-id="${it.id}">删除</button>`;
  return btns;
}

function filteredApplications() {
  const kw = state.search.trim().toLowerCase();
  return state.applications.filter((it) => {
    if (state.statusFilter && it.status !== state.statusFilter) return false;
    if (kw && !(it.company.toLowerCase().includes(kw) || it.position.toLowerCase().includes(kw))) return false;
    return true;
  });
}

function renderPagination(totalPages) {
  const el = $('#pagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  const nums = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) nums.push(i);
  } else {
    nums.push(1);
    const start = Math.max(2, state.page - 1);
    const end = Math.min(totalPages - 1, state.page + 1);
    if (start > 2) nums.push('…');
    for (let i = start; i <= end; i++) nums.push(i);
    if (end < totalPages - 1) nums.push('…');
    nums.push(totalPages);
  }
  el.innerHTML = nums.map((n) => (n === '…'
    ? '<span class="page-ellipsis">…</span>'
    : `<button class="page-btn ${n === state.page ? 'active' : ''}" data-page="${n}">${n}</button>`)).join('');
}

function renderTable() {
  const list = filteredApplications();
  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (state.page > totalPages) state.page = totalPages;
  const pageItems = list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

  const tbody = $('#appTableBody');
  if (!pageItems.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">暂无投递记录，点击右上角「+ 新增投递」开始记录</td></tr>';
  } else {
    tbody.innerHTML = pageItems.map((it) => `
      <tr>
        <td class="cell-company">${escapeHtml(it.company)}</td>
        <td>${escapeHtml(it.position)}</td>
        <td>${fmtDate(it.apply_date)}</td>
        <td>${statusBadge(it.status)}</td>
        <td>${fmtDate(it.interview_date)}</td>
        <td>${fmtDate(it.offer_date)}</td>
        <td>${it.status === 'rejected' ? fmtDate(it.end_date) : '—'}</td>
        <td class="cell-actions">${actionButtons(it)}</td>
      </tr>`).join('');
  }

  $('#tableInfo').textContent = `共 ${list.length} 条记录`;
  renderPagination(totalPages);
}

async function loadApplications() {
  try {
    const data = await api('/api/applications');
    state.applications = data.items;
    state.page = 1;
    renderTable();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ================= 弹窗：新增 / 编辑 ================= */
function openEditModal(item = null) {
  state.editingId = item ? item.id : null;
  $('#editModalTitle').textContent = item ? '编辑投递记录' : '新增投递';
  $('#fCompany').value = item ? item.company : '';
  $('#fPosition').value = item ? item.position : '';
  $('#fApplyDate').value = item ? item.apply_date : todayStr();
  $('#fNotes').value = item ? (item.notes || '') : '';
  $('#fStatus').value = item ? item.status : 'applied';
  $('#fInterviewDate').value = item ? (item.interview_date || '') : '';
  $('#fOfferDate').value = item ? (item.offer_date || '') : '';
  $('#fEndDate').value = item ? (item.end_date || '') : '';
  $('#fEndReason').value = item ? (item.end_reason || '') : '';
  // 新增时隐藏状态/阶段时间区，保存后从「已投递」开始
  $('#stageSection').style.display = item ? '' : 'none';
  $('#editModal').classList.remove('hidden');
}

function closeEditModal() {
  $('#editModal').classList.add('hidden');
}

async function saveEdit(e) {
  e.preventDefault();
  const payload = {
    company: $('#fCompany').value.trim(),
    position: $('#fPosition').value.trim(),
    apply_date: $('#fApplyDate').value,
    notes: $('#fNotes').value.trim(),
  };
  try {
    if (state.editingId === null) {
      await api('/api/applications', { method: 'POST', body: JSON.stringify(payload) });
      showToast('投递记录已添加');
    } else {
      payload.status = $('#fStatus').value;
      payload.interview_date = $('#fInterviewDate').value || null;
      payload.offer_date = $('#fOfferDate').value || null;
      payload.end_date = $('#fEndDate').value || null;
      payload.end_reason = $('#fEndReason').value.trim() || null;
      await api(`/api/applications/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('投递记录已更新');
    }
    closeEditModal();
    await refreshAll();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ================= 弹窗：状态流转 ================= */
const ACTION_TO_STATUS = {
  interview: 'interviewed',
  offer: 'offered',
  reject: 'rejected',
};

function openTransitionModal(id, action) {
  state.transition = { id, action };
  const cfg = {
    interview: { title: '进入面试', dateLabel: '面试时间', showReason: false, reasonPlaceholder: '' },
    offer: { title: '拿到 Offer', dateLabel: 'Offer 时间', showReason: false, reasonPlaceholder: '' },
    reject: { title: '标记未通过/已结束', dateLabel: '结束时间', showReason: true, reasonPlaceholder: '如：未通过 / 放弃' },
  }[action];
  $('#transitionTitle').textContent = cfg.title;
  $('#transitionDateLabel').textContent = cfg.dateLabel;
  $('#transitionDate').value = todayStr();
  $('#transitionReason').value = '';
  $('#transitionReason').placeholder = cfg.reasonPlaceholder;
  $('#transitionReasonRow').classList.toggle('hidden', !cfg.showReason);
  $('#transitionModal').classList.remove('hidden');
}

function closeTransitionModal() {
  $('#transitionModal').classList.add('hidden');
}

async function confirmTransition() {
  const { id, action } = state.transition;
  const status = ACTION_TO_STATUS[action];
  const body = { status, date: $('#transitionDate').value || null };
  if (action === 'reject') {
    body.reason = $('#transitionReason').value.trim() || '未通过';
  }
  try {
    await api(`/api/applications/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) });
    showToast(`已更新为「${STATUS_LABELS[status]}」`);
    closeTransitionModal();
    await refreshAll();
  } catch (err) {
    showToast(err.message, true);
  }
}

/* ================= 事件绑定 ================= */
function bindEvents() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      const view = btn.dataset.view;
      state.view = view;
      $('#view-dashboard').classList.toggle('active', view === 'dashboard');
      $('#view-applications').classList.toggle('active', view === 'applications');
      if (view === 'dashboard') loadDashboard();
      else loadApplications();
    });
  });

  $('#btnAdd').addEventListener('click', () => openEditModal());
  $('#btnCancelEdit').addEventListener('click', closeEditModal);
  $('#editForm').addEventListener('submit', saveEdit);
  $('#btnCancelTransition').addEventListener('click', closeTransitionModal);
  $('#btnConfirmTransition').addEventListener('click', confirmTransition);

  // 搜索（防抖）
  let searchTimer = null;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value;
      state.page = 1;
      renderTable();
    }, 200);
  });

  $('#statusFilter').addEventListener('change', (e) => {
    state.statusFilter = e.target.value;
    state.page = 1;
    renderTable();
  });

  // 表格操作（事件委托）
  $('#appTableBody').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;

    if (action === 'interview' || action === 'offer' || action === 'reject') {
      openTransitionModal(id, action);
    } else if (action === 'edit') {
      const item = state.applications.find((a) => a.id === id);
      if (item) openEditModal(item);
    } else if (action === 'delete') {
      const item = state.applications.find((a) => a.id === id);
      if (!item) return;
      if (window.confirm(`确定删除「${item.company} · ${item.position}」这条投递记录吗？删除后不可恢复。`)) {
        try {
          await api(`/api/applications/${id}`, { method: 'DELETE' });
          showToast('记录已删除');
          await refreshAll();
        } catch (err) {
          showToast(err.message, true);
        }
      }
    }
  });

  $('#pagination').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-page]');
    if (!btn) return;
    state.page = Number(btn.dataset.page);
    renderTable();
  });

  // 点击遮罩关闭弹窗
  document.querySelectorAll('.modal-overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => {
      if (e.target === ov) ov.classList.add('hidden');
    });
  });
}

async function refreshAll() {
  if (state.view === 'dashboard') await loadDashboard();
  else await loadApplications();
}

/* ================= 初始化 ================= */
function init() {
  bindEvents();
  loadDashboard();
}

document.addEventListener('DOMContentLoaded', init);
