import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const HOME = os.homedir();
const OPENCODE_DB = path.join(HOME, '.local/share/opencode/opencode.db');
const PI_SESSIONS_DIR = path.join(HOME, '.pi/agent/sessions');
const DATA_DIR = path.join(import.meta.dirname, '..', 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.jsonl');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');

const pad = (n) => String(n).padStart(2, '0');
const localDateKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ---------- opencode ----------
function collectOpencode() {
  if (!fs.existsSync(OPENCODE_DB)) return [];
  const db = new DatabaseSync(OPENCODE_DB, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `SELECT id,
                session_id,
                json_extract(data, '$.modelID')          AS model,
                json_extract(data, '$.time.created')      AS time,
                json_extract(data, '$.tokens.input')      AS input,
                json_extract(data, '$.tokens.output')     AS output,
                json_extract(data, '$.tokens.reasoning')  AS reasoning,
                json_extract(data, '$.tokens.cache.read') AS cacheRead,
                json_extract(data, '$.tokens.cache.write') AS cacheWrite
         FROM message
         WHERE json_extract(data, '$.role') = 'assistant'
           AND lower(json_extract(data, '$.modelID')) LIKE 'glm%'`
      )
      .all();
    return rows
      .filter((r) => r.time && r.model)
      .map((r) => ({
        id: `oc:${r.session_id}:${r.id}`,
        source: 'opencode',
        model: r.model,
        ts: Number(r.time),
        input: r.input ?? 0,
        output: r.output ?? 0,
        reasoning: r.reasoning ?? 0,
        cacheRead: r.cacheRead ?? 0,
        cacheWrite: r.cacheWrite ?? 0,
      }));
  } finally {
    db.close();
  }
}

// ---------- pi coding agent ----------
function collectPi() {
  if (!fs.existsSync(PI_SESSIONS_DIR)) return [];
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) files.push(p);
    }
  };
  walk(PI_SESSIONS_DIR);

  const out = [];
  for (const file of files) {
    let sessionId = '';
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === 'session') {
        sessionId = ev.id;
        continue;
      }
      const msg = ev.message;
      if (
        ev.type === 'message' &&
        msg?.role === 'assistant' &&
        msg?.usage &&
        /^glm/i.test(msg.model || '')
      ) {
        const u = msg.usage;
        const ts = msg.timestamp ?? Date.parse(ev.timestamp);
        if (!ts) continue;
        out.push({
          id: `pi:${sessionId}:${ev.id}`,
          source: 'pi',
          model: msg.model,
          ts: Number(ts),
          input: u.input ?? 0,
          output: u.output ?? 0,
          reasoning: u.reasoning ?? 0,
          cacheRead: u.cacheRead ?? 0,
          cacheWrite: u.cacheWrite ?? 0,
        });
      }
    }
  }
  return out;
}

// ---------- aggregate ----------
function emptyBucket() {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    requests: 0,
    byModel: {},
    bySource: { opencode: 0, pi: 0 },
    byHour: Array.from({ length: 24 }, () => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, requests: 0 })),
  };
}

function addTo(bucket, r) {
  const core = r.input + r.output + r.reasoning;
  const total = core + r.cacheRead + r.cacheWrite;
  bucket.input += r.input;
  bucket.output += r.output;
  bucket.reasoning += r.reasoning;
  bucket.cacheRead += r.cacheRead;
  bucket.cacheWrite += r.cacheWrite;
  bucket.total += total;
  bucket.requests += 1;
  bucket.byModel[r.model] = (bucket.byModel[r.model] ?? 0) + total;
  bucket.bySource[r.source] = (bucket.bySource[r.source] ?? 0) + total;
  const h = bucket.byHour[new Date(r.ts).getHours()];
  h.input += r.input;
  h.output += r.output;
  h.reasoning += r.reasoning;
  h.cacheRead += r.cacheRead;
  h.cacheWrite += r.cacheWrite;
  h.total += total;
  h.requests += 1;
}

function aggregate(records) {
  const totals = emptyBucket();
  const days = new Map();
  for (const r of records) {
    const key = localDateKey(r.ts);
    if (!days.has(key)) days.set(key, emptyBucket());
    const d = days.get(key);
    addTo(d, r);
    addTo(totals, r);
    // totals에 day별 모델/소스 중복 방지: totals.byModel/bySource는 addTo에서 합산됨
  }

  const models = new Map();
  for (const r of records) {
    const m = models.get(r.model) ?? { model: r.model, requests: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, bySource: { opencode: 0, pi: 0 } };
    m.requests += 1;
    m.input += r.input;
    m.output += r.output;
    m.reasoning += r.reasoning;
    m.cacheRead += r.cacheRead;
    m.cacheWrite += r.cacheWrite;
    m.total += r.input + r.output + r.reasoning + r.cacheRead + r.cacheWrite;
    m.bySource[r.source] = (m.bySource[r.source] ?? 0) + 1;
    models.set(r.model, m);
  }

  return {
    generatedAt: new Date().toISOString(),
    messageCount: records.length,
    firstTs: records.length ? Math.min(...records.map((r) => r.ts)) : null,
    lastTs: records.length ? Math.max(...records.map((r) => r.ts)) : null,
    totals,
    models: [...models.values()].sort((a, b) => b.total - a.total),
    days: [...days.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, b]) => ({ date, ...b })),
  };
}

// ---------- main ----------
export function collect({ persist = true } = {}) {
  const records = new Map();

  // 기존 기록 로드 (세션이 삭제돼도 히스토리 유지)
  if (fs.existsSync(MESSAGES_FILE)) {
    for (const line of fs.readFileSync(MESSAGES_FILE, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (r.id && r.ts) records.set(r.id, r);
      } catch {
        /* skip broken line */
      }
    }
  }

  const before = records.size;
  for (const r of [...collectOpencode(), ...collectPi()]) records.set(r.id, r);
  const all = [...records.values()].sort((a, b) => a.ts - b.ts);

  if (persist) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MESSAGES_FILE, all.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }

  const usage = aggregate(all);
  usage.newRecords = all.length - before;
  if (persist) fs.writeFileSync(USAGE_FILE, JSON.stringify(usage));
  return usage;
}

// CLI로 직접 실행 시
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const usage = collect();
  const lastDay = usage.days.at(-1);
  console.log(`수집 완료: 메시지 ${usage.messageCount}건 (신규 +${usage.newRecords})`);
  console.log(`총 토큰: ${usage.totals.total.toLocaleString()} (input ${usage.totals.input.toLocaleString()} / output ${usage.totals.output.toLocaleString()} / reasoning ${usage.totals.reasoning.toLocaleString()} / cache ${usage.totals.cacheRead.toLocaleString()})`);
  if (lastDay) console.log(`최근 사용일 ${lastDay.date}: ${lastDay.total.toLocaleString()} tokens, ${lastDay.requests} requests`);
}
