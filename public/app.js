/* GLM Token Tracker - dashboard */

const COLORS = {
  input: '#6366f1',
  output: '#22c55e',
  reasoning: '#f59e0b',
  cacheRead: '#94a3b8',
  cacheWrite: '#64748b',
};

const state = {
  usage: null,
  selectedDate: null,
  includeCache: false,
  dailyChart: null,
  hourlyChart: null,
  modelChart: null,
  sourceChart: null,
};

// ---------- utils ----------
const fmt = (n) => n.toLocaleString('ko-KR');
const fmtCompact = (n) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'K';
  return String(n);
};

const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function seriesFor(bucket) {
  const s = [
    ['input', 'Input', bucket.input, COLORS.input],
    ['output', 'Output', bucket.output, COLORS.output],
    ['reasoning', 'Reasoning', bucket.reasoning, COLORS.reasoning],
  ];
  if (state.includeCache) {
    s.push(['cacheRead', 'Cache Read', bucket.cacheRead, COLORS.cacheRead]);
    s.push(['cacheWrite', 'Cache Write', bucket.cacheWrite, COLORS.cacheWrite]);
  }
  return s;
}

function sumRange(days, dates) {
  const set = new Set(dates);
  const acc = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, requests: 0 };
  for (const d of days) {
    if (!set.has(d.date)) continue;
    for (const k of ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'total']) acc[k] += d[k];
    acc.requests += d.requests;
  }
  return acc;
}

const dayKeyOffset = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return dateKey(d);
};

// ---------- render ----------
function renderCards() {
  const { days, totals } = state.usage;
  const today = sumRange(days, [dayKeyOffset(0)]);
  const yesterday = sumRange(days, [dayKeyOffset(-1)]);

  const weekDates = [];
  for (let i = 0; i < 7; i++) weekDates.push(dayKeyOffset(-i));
  const week = sumRange(days, weekDates);

  const monthDates = [];
  for (let i = 0; i < 30; i++) monthDates.push(dayKeyOffset(-i));
  const month = sumRange(days, monthDates);

  const cards = [
    ['오늘', today],
    ['어제', yesterday],
    ['최근 7일', week],
    ['최근 30일', month],
    ['전체', totals],
  ];

  document.getElementById('cards').innerHTML = cards
    .map(([label, b]) => {
      const core = b.input + b.output + b.reasoning;
      return `
      <div class="card">
        <div class="label">${label}</div>
        <div class="value">${fmtCompact(core)}</div>
        <div class="sub">${fmt(b.requests)} 요청 · cache ${fmtCompact(b.cacheRead)}</div>
      </div>`;
    })
    .join('');
}

function fillDays(days, count) {
  if (!days.length) return [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out = [];
  const last = new Date(days[days.length - 1].date + 'T00:00:00');
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(last);
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    out.push(byDate.get(key) ?? { date: key, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, requests: 0 });
  }
  return out;
}

function renderDailyChart() {
  const days = fillDays(state.usage.days, 30);
  const ctx = document.getElementById('daily-chart');

  const datasets = seriesFor({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }).map(([key, label, , color]) => ({
    label,
    backgroundColor: color,
    stack: 'tokens',
    data: days.map((d) => d[key]),
  }));

  if (state.dailyChart) state.dailyChart.destroy();
  state.dailyChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: days.map((d) => d.date.slice(5)), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (_, elements) => {
        if (!elements.length) return;
        const idx = elements[0].index;
        setSelectedDate(days[idx].date);
      },
      scales: {
        x: { stacked: true, grid: { color: '#262b38' }, ticks: { color: '#8b93a7', maxRotation: 45 } },
        y: { stacked: true, grid: { color: '#262b38' }, ticks: { color: '#8b93a7', callback: fmtCompact } },
      },
      plugins: {
        legend: { labels: { color: '#e5e9f0' } },
        tooltip: {
          callbacks: {
            footer: (items) => {
              const d = days[items[0].dataIndex];
              return `요청 ${fmt(d.requests)}회 · 합계 ${fmt(d.total)}`;
            },
          },
        },
      },
    },
  });
}

function renderHourlyChart() {
  const date = state.selectedDate;
  const day = state.usage.days.find((d) => d.date === date);
  const empty = Array.from({ length: 24 }, () => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }));
  const hours = day ? day.byHour : empty;

  document.getElementById('hourly-date-label').textContent = date ?? '-';
  document.getElementById('hourly-date').value = date ?? '';

  const datasets = seriesFor(hours[0]).map(([key, label, , color]) => ({
    label,
    backgroundColor: color,
    stack: 'tokens',
    data: hours.map((h) => h[key]),
  }));

  if (state.hourlyChart) state.hourlyChart.destroy();
  state.hourlyChart = new Chart(document.getElementById('hourly-chart'), {
    type: 'bar',
    data: { labels: hours.map((_, i) => `${String(i).padStart(2, '0')}시`), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { color: '#262b38' }, ticks: { color: '#8b93a7' } },
        y: { stacked: true, grid: { color: '#262b38' }, ticks: { color: '#8b93a7', callback: fmtCompact } },
      },
      plugins: {
        legend: { labels: { color: '#e5e9f0' } },
        tooltip: {
          callbacks: {
            footer: (items) => {
              const h = hours[items[0].dataIndex];
              return `요청 ${fmt(h.requests)}회`;
            },
          },
        },
      },
    },
  });
}

function renderModelChart() {
  const models = state.usage.models;
  const ctx = document.getElementById('model-chart');
  if (state.modelChart) state.modelChart.destroy();
  state.modelChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: models.map((m) => m.model),
      datasets: [{
        data: models.map((m) => m.input + m.output + m.reasoning),
        backgroundColor: ['#6366f1', '#22c55e', '#f59e0b', '#94a3b8', '#ec4899', '#06b6d4', '#a855f7'],
        borderColor: '#171a23',
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#e5e9f0' } },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt(c.parsed)}` } },
      },
    },
  });
}

function renderSourceChart() {
  const t = state.usage.totals.bySource;
  const ctx = document.getElementById('source-chart');
  if (state.sourceChart) state.sourceChart.destroy();
  state.sourceChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['opencode', 'pi'],
      datasets: [{ data: [t.opencode ?? 0, t.pi ?? 0], backgroundColor: ['#6366f1', '#22c55e'], borderColor: '#171a23', borderWidth: 2 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { color: '#e5e9f0' } },
        tooltip: { callbacks: { label: (c) => ` ${c.label}: ${fmt(c.parsed)}` } },
      },
    },
  });
}

function renderTable() {
  const total = state.usage.totals.total || 1;
  const rows = state.usage.models
    .map((m) => {
      const pct = ((m.total / total) * 100).toFixed(1);
      const sources = Object.entries(m.bySource)
        .filter(([, n]) => n > 0)
        .map(([s]) => `<span class="badge ${s}">${s}</span>`)
        .join('');
      return `<tr>
        <td>${m.model}</td><td>${fmt(m.requests)}</td>
        <td>${fmt(m.input)}</td><td>${fmt(m.output)}</td><td>${fmt(m.reasoning)}</td>
        <td>${fmt(m.cacheRead)}</td><td>${fmt(m.cacheWrite)}</td>
        <td><strong>${fmt(m.total)}</strong></td><td>${pct}%</td><td>${sources}</td>
      </tr>`;
    })
    .join('');
  document.querySelector('#detail-table tbody').innerHTML = rows;
}

function renderAll() {
  renderCards();
  renderDailyChart();
  renderHourlyChart();
  renderModelChart();
  renderSourceChart();
  renderTable();
  document.getElementById('last-collected').textContent =
    `마지막 수집: ${new Date(state.usage.generatedAt).toLocaleString('ko-KR')}`;
}

function setSelectedDate(date) {
  state.selectedDate = date;
  renderHourlyChart();
}

// ---------- data ----------
async function load({ refresh = false } = {}) {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = '⏳ 수집 중...';
  try {
    const res = await fetch(`/api/usage${refresh ? '?refresh=1' : ''}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.usage = await res.json();
    if (!state.selectedDate && state.usage.days.length) {
      state.selectedDate = state.usage.days[state.usage.days.length - 1].date;
    }
    renderAll();
  } catch (err) {
    document.getElementById('last-collected').textContent = `오류: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 새로고침';
  }
}

// ---------- events ----------
document.getElementById('refresh-btn').addEventListener('click', () => load({ refresh: true }));
document.getElementById('include-cache').addEventListener('change', (e) => {
  state.includeCache = e.target.checked;
  if (state.usage) {
    renderDailyChart();
    renderHourlyChart();
  }
});
document.getElementById('hourly-date').addEventListener('change', (e) => {
  if (e.target.value && e.target.value !== state.selectedDate) setSelectedDate(e.target.value);
});

load();
setInterval(() => load({ refresh: true }), 5 * 60 * 1000);
