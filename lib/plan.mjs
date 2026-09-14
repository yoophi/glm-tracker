import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const API_BASE = 'https://api.z.ai/api/monitor/usage';
const BEIJING = '+08:00'; // 서버(x_time) 기준 시간대

// API 키: env 우선, 없으면 opencode 자격증명에서 zai-coding-plan 키 사용
export function findApiKey() {
  if (process.env.GLM_TRACKER_ZAI_KEY) return process.env.GLM_TRACKER_ZAI_KEY;
  try {
    const auth = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), '.local/share/opencode/auth.json'), 'utf8')
    );
    const key = auth?.['zai-coding-plan']?.key;
    if (typeof key === 'string' && key.length > 10) return key;
  } catch {
    /* 없으면 계속 */
  }
  return null;
}

// UTC 밀리초 → "yyyy-MM-dd HH:mm:ss"(베이징) 문자열
function fmtBeijing(ms) {
  const d = new Date(ms + 8 * 3600e3);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// "yyyy-MM-dd HH:mm"(베이징) → 로컬 UTC 밀리초
function parseBucket(s) {
  return new Date(`${s}:00${BEIJING}`).getTime();
}

async function getJson(url, key) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}`, 'Accept-Language': 'en-US,en' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.code !== 200) throw new Error(body.msg || `code ${body.code}`);
  return body.data;
}

/**
 * 계정 기반 사용량 조회 (모든 머신·클라이언트 합산, 비공식 API)
 * - quota/limit: 5시간 토큰 윈도우 백분율 등
 * - model-usage: 최근 N일의 시간별 토큰/호출 수 (범위와 무관하게 항상 시간별)
 */
export async function fetchPlanUsage({ days = 7 } = {}) {
  const key = findApiKey();
  if (!key) {
    return { available: false, reason: 'API 키 없음 (GLM_TRACKER_ZAI_KEY 또는 opencode auth.json)' };
  }

  const now = Date.now();
  const start = now - days * 86400e3;
  const q = encodeURIComponent;

  const [quota, model] = await Promise.all([
    getJson(`${API_BASE}/quota/limit`, key),
    getJson(
      `${API_BASE}/model-usage?startTime=${q(fmtBeijing(start))}&endTime=${q(fmtBeijing(now))}`,
      key
    ),
  ]);

  const tokensLimit = quota?.limits?.find((l) => l.type === 'TOKENS_LIMIT') ?? null;
  const timeLimit = quota?.limits?.find((l) => l.type === 'TIME_LIMIT') ?? null;

  const buckets = (model?.x_time ?? []).map((t, i) => ({
    ts: parseBucket(t),
    tokens: model.tokensUsage?.[i] ?? 0,
    calls: model.modelCallCount?.[i] ?? 0,
  }));

  return {
    available: true,
    generatedAt: new Date(now).toISOString(),
    source: 'Z.ai monitor API (비공식) · 전체 머신 합산',
    quota: {
      planLevel: quota?.level ?? null,
      tokensPercentage: tokensLimit?.percentage ?? null,
      tokensResetAt: tokensLimit?.nextResetTime ?? null, // ms epoch
      timePercentage: timeLimit?.percentage ?? null,
      timeResetAt: timeLimit?.nextResetTime ?? null,
    },
    totals: {
      tokens: model?.totalUsage?.totalTokensUsage ?? 0,
      calls: model?.totalUsage?.totalModelCallCount ?? 0,
      models: model?.totalUsage?.modelSummaryList ?? [],
    },
    days,
    buckets,
  };
}

// CLI 직접 실행: 요약 출력
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  fetchPlanUsage()
    .then((p) => {
      if (!p.available) {
        console.log(`사용 불가: ${p.reason}`);
        return;
      }
      console.log(`플랜: ${p.quota.planLevel} | 5h 윈도우 ${p.quota.tokensPercentage}% | 리셋 ${new Date(p.quota.tokensResetAt).toLocaleString('ko-KR')}`);
      console.log(`최근 ${p.days}일: ${p.totals.tokens.toLocaleString()} 토큰 / ${p.totals.calls} 호출`);
      const byDate = new Map();
      for (const b of p.buckets) {
        const d = new Date(b.ts);
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        byDate.set(k, (byDate.get(k) ?? 0) + b.tokens);
      }
      for (const [d, t] of byDate) console.log(`  ${d}: ${t.toLocaleString()}`);
    })
    .catch((e) => console.error(`오류: ${e.message}`));
}
