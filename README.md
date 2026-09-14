# GLM Token Tracker

opencode와 pi coding agent에서 사용하는 GLM 모델의 토큰 사용량을 수집·시각화하는 로컬 대시보드입니다.

## 데이터 소스

| 도구 | 위치 | 형식 |
|---|---|---|
| opencode | `~/.local/share/opencode/opencode.db` | SQLite `message` 테이블 |
| pi coding agent | `~/.pi/agent/sessions/**/*.jsonl` | JSONL (assistant 메시지 `usage`) |

- 모델명이 `glm*`인 assistant 메시지의 input / output / reasoning / cache 토큰을 수집합니다.
- 수집 결과는 `data/messages.jsonl`에 원본으로 누적되어, 원본 세션이 삭제돼도 히스토리가 유지됩니다.

## 실행

```bash
cd glm-tracker
npm start          # http://localhost:3450
```

수집만 수행 (대시보드 없이):

```bash
npm run collect
```

포트 변경: `PORT=4000 npm start`

## 기능

- 일별 토큰 사용량 (최근 30일, 스택 바 차트) — 막대 클릭 시 해당일 시간별 그래프로 전환
- 시간별 사용량 (0~23시)
- 모델별 / 소스별(opencode vs pi) 사용량
- "캐시 토큰 포함" 토글로 cache read/write 표시 전환
- 5분마다 자동 재수집
