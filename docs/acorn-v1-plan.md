# acorn v0.1.0 기획안 (Radical MVP)

> Claude Code 하네스 엔지니어링 툴(OMC, gstack, ECC)의 설치·구성·활성화를 통합 관리하는 CLI  
> 패키지명: `@dotoricode/acorn` (v1.0.0부터 npm 배포, v0.1.0은 git 태그 기반)

**Status: APPROVED (2026-04-13)**  
*Design Doc: `~/.gstack/projects/dotoricode-acorn/youngsang.kwon-main-design-20260413-154802.md`*

---

## 1. 핵심 재정의

> "세 툴을 격리 설치하고, 충돌을 해소한 최적 조합을 고정 버전으로 활성화하는 CLI"

이것은 "3-툴 통합 CLI"가 아니다. **dotori의 curator 판단을 직렬화한 개인용 Claude Code distro**다.  
진짜 상품은 dotori가 "이 SHA 조합은 검증되었다"고 보증하는 판단력 그 자체.  
CLI는 그 판단을 재현 가능하게 만드는 얇은 쉘.

### 배경

Claude Code 하네스 생태계에는 세 가지 주요 툴이 존재한다:

| 툴 | 포지셔닝 | 라이선스 |
|---|---|---|
| **oh-my-claudecode (OMC)** | 멀티에이전트 오케스트레이션 | MIT |
| **gstack** | 역할 기반 개발 워크플로우 | MIT |
| **everything-claude-code (ECC)** | 하네스 엔지니어링 최적화 시스템 | MIT |

각 툴이 공유하는 구조적 문제: (1) 설치 경험이 개발자 전제, (2) 스킬 네임스페이스 충돌, (3) 블랙박스 상태

---

## 2. 핵심 원칙

- **설치·구성·활성화 레이어** — 각 툴과 경쟁하지 않고 보완 관계
- **격리 우선** — 단일 관리 위치로 신뢰의 기반 확보
- **버전 고정** — dotori가 검증한 커밋 SHA만, 분기별 1회 갱신
- **fail-close** — 파싱/실행 실패 시 허용이 아닌 차단이 기본
- **비파괴적** — settings.json 멱등 머지, 기존 키 충돌 시 에러+중단
- **dogfooding** — acorn 완성 후 acorn 자체로 환경 구축하여 차기 개발

---

## 3. 확정된 전제 (P1~P9)

### P1. 솔로 퍼스트 → 검증 후 확장
- v0.x: dotori만 사용
- v1.0+: 팀(수 명)
- v2.0+: 외부 공개
- 영향: 인터랙티브 확인(Y/n/타이핑)·`--yes` 플래그는 v0.1.0 제외. 기본이 yes, 의문이 있으면 에러.

### P2. "세 툴 동시 사용" 수요는 가설 상태
- v0.1.0 착수와 병렬로 실사용 측정 (14일)
- 측정: Claude Code 세션 로그에서 각 툴 커맨드 사용 빈도 집계
- 결과에 따라 v0.2.0 시점에 scope 재조정

### P3. SHA 고정은 분기별 1회 갱신
- 자동 drift 감지·승자 판정 모두 v0.1.0 제외
- `acorn dev check/lock`은 v1.1+로 연기
- 분기별 검토 시 고통이 생긴 것만 갱신

### P4+P7. guard 위협 모델: "AI 실수 방지" + bypass env
- bash glob 패턴 유지, arg 분해 안 함
- `ACORN_GUARD_BYPASS=1` env로 세션 단위 우회
- bypass 활성 시 stderr 경고 매번 출력 (silent fail-open 방지)
- 우선순위: env > harness.lock 2단

### P5. TypeScript + npm 유지
- v0.1.0: git 태그 기반 사설 배포
- v1.0.0부터 npm publish
- tsx dev + tsc build로 로컬 실행

### P6. settings.json 멱등 머지 (ADR-012 supersede)
- `acorn install`이 env 섹션 3개 키만 머지
- 키 없음 → 추가 / 같은 값 → no-op / 다른 값 → 에러+중단
- 원자적 쓰기: temp file → `fs.renameSync`
- 백업: `~/.claude/skills/harness/backup/{ISO8601}/settings.json.bak`

### P8. 테스트 + 롤백은 v0.1.0 필수
- `acorn doctor` 신설 — 실 FS 재검증 리포트 (`--json` 지원)
- 통일 백업: `~/.claude/skills/harness/backup/{ISO8601}/`
  - `settings.json.bak`
  - `symlinks/{path}.info`
  - `tx.log` (JSONL 트랜잭션 로그)
- CI: v0.1.1로 연기, placeholder만 v0.1.0에 커밋

### P9. 업스트림 breaking rename 합성 전략
- **gstack → (a) Hard fork**: `vendors/gstack`을 dotfiles에 커밋. 업스트림은 의식적으로만 흡수.
- **OMC → (b) lock 갱신**: 분기별 upstream 따라감.
- **ECC → (c) selective drop**: v0.2.0+에서 필요한 언어별 리뷰어 agent만 선별 심링크.

---

## 4. 스코프 (v0.1.0)

### In Scope (10 스프린트)

| Sprint | 파일 | 예상 |
|---|---|---|
| 0 | pre-work (TS 체크, 측정) | blocking/deferred 분리 |
| 1 | `hooks/guard-check.sh` | 하루 |
| 2 | `src/core/lock.ts` | 하루 |
| 3 | `src/core/env.ts` | 반일 |
| 4 | `src/core/settings.ts` | 하루 |
| 5 | `src/core/symlink.ts` | 하루 |
| 6 | `src/commands/install.ts` | 3~4일 |
| 6.5 | 안정화 (3/10+6/10 회고) | 0.5일 |
| 7 | `src/commands/status.ts` | 반일 |
| 8 | `src/commands/doctor.ts` | 1~2일 |
| 9 | `src/index.ts` | 반일 |
| 10 | docs 정비 | 반일 |

총 예산: 10~12일 / 솔로 야간 기준 2~3주

### Sprint 0 — pre-work (blocking/deferred 분리)

**즉시 (hard-blocking, Sprint 1 전 필수)**
- TypeScript 6.0.2 안정성 확인 (`npm run build` 클린 빌드)
  - 이슈 시 `typescript@^5.5.0` 다운그레이드
- Node 24 LTS 전환 (.nvmrc, package.json engines)

**병행 수집 (deferred)**
- P2: 지난 14일 Claude Code 세션 커맨드 사용 빈도 측정
- P9: gstack vendors `.git` 제외 실 용량 측정 (hard fork 방향 확정용)

### Out of Scope (v0.2.0 / v1.1+)

- `src/core/registry.ts` (충돌 해소 자동화) — v1.1+
- `src/commands/list.ts` — v0.2.0
- `src/commands/uninstall.ts`, `config.ts` — v0.2.0
- `src/dev/*` 전체 (`check`, `diff`, `lock`, `sync` 등) — v1.1+
- 인터랙티브 확인 등급 — v2.0+
- GitHub Actions 실제 파이프라인 — v0.1.1
- backup 로테이션 — v0.2.0
- `acorn doctor --fix` — v0.2.0+
- ECC selective drop 구현 — v0.2.0+

---

## 5. 충돌 해소 우선순위 테이블

### 🔴 충돌 영역 — 승자 단일 지정

| 기능 영역 | 승자 | 근거 |
|---|---|---|
| **플래닝** | gstack | `office-hours → plan-ceo-review → plan-eng-review` 파이프라인 |
| **코드 리뷰** | ECC | 언어별 전문 리뷰어 세분화 |
| **QA** | gstack | 유일한 실브라우저 QA |
| **병렬 실행** | OMC | 스마트 모델 라우팅, 토큰 30~50% 절감 |
| **보안 감사** | ECC | AgentShield, CVE 대응 |
| **문서화** | gstack | `/ship` 시 자동 최신화 |
| **배포** | gstack | canary 배포, 검증 파이프라인 |

### 🟡 가드레일 — 레이어가 달라 공존

| 툴 | 레이어 | 역할 |
|---|---|---|
| gstack `/guard` | 런타임 인터랙티브 | 위험 커맨드 실행 전 사용자 확인 |
| ECC guardrail engine | 컴파일 타임 규칙 | 훅 레벨 정적 규칙 강제 |

### 🟢 고유 영역

| 기능 | 툴 |
|---|---|
| 자율 실행 루프 | OMC |
| 실브라우저 자동화 | gstack |
| 크로스 하네스 | ECC |
| 세션 복구 (`omc wait`) | OMC |
| HUD / 관측성 | OMC |

---

## 6. 아키텍처 개요

### 실제 디렉토리 구조 (검증 완료)

#### Windows (집)
```
C:\Users\SMILE\.claude\          → D:\.claude\  (심링크)
D:\.claude\
├── skills/
│   ├── harness/                 → D:\dotoricode\dotfiles\claude\harness\  (심링크)
│   │   ├── vendors/             ← 로컬 전용 (gitignore)
│   │   │   ├── gstack/          ← SHA: c6e6a21 (hard fork 예정)
│   │   │   ├── omc/
│   │   │   └── ecc/
│   │   ├── backup/              ← 통일 백업 경로
│   │   ├── harness.lock
│   │   └── hooks/
│   │       └── guard-check.sh
│   └── gstack/                  → harness/vendors/gstack  (심링크)
└── settings.json

D:\dotoricode\
├── acorn\                       ← 개발 코드
│   └── docs\
│       └── acorn-v1-plan.md     ← 현재 문서
└── dotfiles\
    └── claude\
        └── harness\             ← 심링크 대상 (실제 파일)
```

#### Mac (회사)
```
~/01_private/acorn/              ← 개발 코드
~/.claude-personal/              ← personal 계정 (direnv)
~/.claude-work/                  ← work 계정 (direnv)

# personal 환경
~/.claude-personal/skills/
├── harness/  → ~/01_private/dotfiles/claude/harness/
├── gstack/   → harness/vendors/gstack/
└── (37개 gstack 스킬)           ← gstack setup 실행으로 생성

# direnv 설정
~/01_private/.envrc: export CLAUDE_CONFIG_DIR=/Users/youngsang.kwon/.claude-personal
```

### 툴별 경로 처리 방식 ✅ 검증 완료

| 툴 | 처리 방식 |
|---|---|
| **gstack** | 디렉토리 심링크 (`~/.claude/skills/gstack/ → vendors/gstack/`) |
| **OMC** | 환경변수 주입 (`CLAUDE_PLUGIN_ROOT`, `OMC_PLUGIN_ROOT`) |
| **ECC** | 환경변수 주입 (`CLAUDE_PLUGIN_ROOT`, `ECC_ROOT`) |

### harness.lock (현재 고정 버전)

```json
{
  "schema_version": 1,
  "acorn_version": "0.0.0-dev",
  "tools": {
    "omc": {
      "repo": "Yeachan-Heo/oh-my-claudecode",
      "commit": "04655ee24207f367fee785b5eb33b21234d9e0e3",
      "verified_at": "2026-04-13"
    },
    "gstack": {
      "repo": "garrytan/gstack",
      "commit": "c6e6a21d1a9a58e771403260ff6a134898f2dd02",
      "verified_at": "2026-04-13"
    },
    "ecc": {
      "repo": "affaan-m/everything-claude-code",
      "commit": "125d5e619905d97b519a887d5bc7332dcc448a52",
      "verified_at": "2026-04-13"
    }
  },
  "guard": {
    "mode": "block",
    "patterns": "strict"
  }
}
```

---

## 7. guard 시스템

### 작동 원리

Claude Code `PreToolUse` 훅으로 Bash 툴 실행을 인터셉트.

**✅ 검증 완료**
- OMC autopilot 서브에이전트까지 발화 확인
- stdin JSON 페이로드 (환경변수 아님)
- `readFileSync(0, 'utf8')` (fd 0) 크로스 플랫폼 정상 작동
- `/dev/stdin`은 Windows Git Bash에서 fail-open 발생 → fd 0 확정

### guard-check.sh 명세 (Sprint 1)

```bash
#!/bin/bash
# 1. Bypass check (최우선)
if [ "${ACORN_GUARD_BYPASS:-0}" = "1" ]; then
  echo "[acorn-guard] ⚠️ BYPASS ACTIVE — 위험 커맨드가 차단되지 않습니다" >&2
  exit 0
fi

# 2. Mode 결정 (env > harness.lock)
parse_mode() { ... }  # jq 우선, Node.js 폴백
GUARD_MODE=$(parse_mode 2>/dev/null || echo "block")

# 3. stdin JSON 파싱 (fd 0, fail-close)
parse_command() { ... }
COMMAND=$(parse_command)
PARSE_EXIT=$?
[ $PARSE_EXIT -ne 0 ] && { echo "[acorn-guard] 파싱 실패 — 차단" >&2; exit 1; }
[ -z "$COMMAND" ] && exit 0

# 4. 패턴 매칭 + mode 분기
case "$COMMAND" in
  *"rm -rf"*|*"DROP TABLE"*|*"force-push"*|*"reset --hard"*|*"chmod 777"*)
    case "$GUARD_MODE" in
      "block") echo "[acorn-guard] 차단: $COMMAND" >&2; exit 1 ;;
      "warn")  echo "[acorn-guard] 경고: $COMMAND" >&2; exit 0 ;;
      "log")   echo "[acorn-guard] 로그: $COMMAND" >&2; exit 0 ;;
    esac ;;
esac
exit 0
```

---

## 8. CLI 인터페이스 (v0.1.0)

```bash
acorn install    # 설치 (preflight → clone → 심링크 → gstack setup → settings 머지)
acorn status     # harness.lock + settings.json 직독 요약
acorn doctor     # 실 FS 재검증 리포트 (--json 지원)
```

v0.1.0에서 제외: `uninstall`, `config`, `list`, `acorn dev *`, 인터랙티브 확인

### acorn install 실행 순서 (preflight 우선)

```
1. lock.ts 파싱
2. env.ts 경로 계산
3. settings.json 충돌 체크 (읽기 전용)  ← 조기 실패 감지
4. vendors clone
5. 심링크 생성
6. gstack setup 실행
7. settings.json 원자적 쓰기  ← 마지막
```

Ctrl-C 중단 처리: 재실행 시 `in_progress` tx.log 감지 → 즉시 실패 + 수동 검사 안내

### acorn status 출력 (v0.1.0)

```
┌─────────────────────────────────────────────┐
│ acorn v0.1.0  •  global                     │
├─────────────────────────────────────────────┤
│ OMC      04655ee  ✅  locked                │
│ gstack   c6e6a21  ✅  locked  (symlinked)   │
│ ECC      125d5e6  ✅  locked                │
├─────────────────────────────────────────────┤
│ guard    block                              │
│ env: CLAUDE_PLUGIN_ROOT ✅                  │
│      OMC_PLUGIN_ROOT    ✅                  │
│      ECC_ROOT           ✅                  │
└─────────────────────────────────────────────┘
```

*v0.1.0: "conflicts resolved" 라인 없음 (registry.ts 미구현)*

---

## 9. Windows / Mac 환경 동기화

### 동기화 대상 / 비대상

| 항목 | 동기화 | 방법 |
|---|---|---|
| acorn 소스 코드 | ✅ | git (dotoricode/acorn) |
| harness.lock | ✅ | git (dotoricode/dotfiles) |
| guard-check.sh | ✅ | git (dotoricode/dotfiles) |
| vendors/ (툴 파일) | ❌ (gstack 제외) | 머신별 acorn install |
| vendors/gstack | ✅ (P9 hard fork) | dotfiles 커밋 예정 |
| gstack 스킬 심링크 | ❌ | 머신별 gstack setup |
| settings.json | ❌ | acorn install이 멱등 머지 |

### dotfiles 레포 구조

```
dotoricode/dotfiles/
└── claude/
    └── harness/
        ├── harness.lock
        ├── registry.json
        └── hooks/
            └── guard-check.sh  ← Sprint 1 결과물로 커밋
```

### setup-mac.sh (bootstrap-only)

```bash
#!/bin/bash
# Bootstrap만 담당. 실제 설치는 acorn install이 처리.
mkdir -p ~/01_private
cd ~/01_private
[ -d "acorn" ] || git clone https://github.com/dotoricode/acorn
[ -d "dotfiles" ] || git clone https://github.com/dotoricode/dotfiles
cd acorn && npm install
echo ""
echo "✅ Bootstrap 완료!"
echo "다음: acorn install 실행"
```

---

## 10. 기술 스택

```
CLI 코어          → TypeScript + Node.js 24 LTS
훅 스크립트       → bash + jq (미설치 시 Node.js fd 0 폴백)
스키마 검증       → Zod (lock.ts)
배포 (v0.1.0)    → git 태그 기반 사설
배포 (v1.0.0+)   → npm (@dotoricode/acorn)
```

---

## 11. ADR (Architecture Decision Records)

### ADR-001: 격리 위치
**결정**: `~/.claude/skills/harness/vendors/` 하위

### ADR-002: 업데이트 매니저 분리
**결정**: `acorn dev` 서브커맨드, v1.1+에서 구현

### ADR-003: 툴별 경로 처리 ✅ 검증 완료
- gstack → 디렉토리 심링크
- OMC, ECC → 환경변수 주입

### ADR-004: guard 블로킹 강도
**결정**: `mode` × `patterns`, 시작값 `block + strict`

### ADR-005: 기술 스택
**결정**: TypeScript + Node.js 24 LTS + bash  
**주의**: TS 6.0.2 안정성 Sprint 0에서 검증 (이슈 시 5.5로 다운그레이드)

### ADR-006: 사용자 / dotori 커맨드 분리
**결정**: `acorn dev` v1.1+로 연기, v0.1.0은 수동 harness.lock 편집

### ADR-007: 배포 방식
**결정**: 원본 레포 @ 고정 SHA 직접 clone  
**라이선스**: OMC(MIT) ✅ / gstack(MIT) ✅ / ECC(MIT) ✅

### ADR-008: 훅 스크립트 stdin 파싱 ✅ 검증 완료
**결정**: fd 0 방식, fail-close, bypass stderr 경고 매번 출력

### ADR-009: 환경변수 설정 위치
**결정**: settings.json `env` 섹션 (머신별 acorn install이 멱등 머지)

### ADR-010: omc-learned / learned/ 격리
**결정**: v1.0.0 무시 (미존재 확인)

### ADR-011: dotfiles 레포 분리
**결정**: `dotoricode/dotfiles` 별도 레포

### ADR-012: settings.json 멱등 머지 (ADR-009 보완, ADR-012 이전 결정 supersede)
**결정**: acorn install이 멱등 머지. 키 충돌 시 에러+중단. 원자적 쓰기.

### ADR-013: gstack을 acorn 개발 도구로 선택
**결정**: acorn v0.1.0 개발에 gstack 단독 사용  
acorn 완성 후: acorn 자체로 환경 구축하여 차기 개발 진행

### ADR-014: P1 솔로 퍼스트
**결정**: v0.x는 dotori만. 인터랙티브 확인·--yes 플래그 v2.0+로 연기.

### ADR-015: P9 합성 전략
**결정**: gstack=(a)hard fork / OMC=(b)lock 갱신 / ECC=(c)selective drop(v0.2.0+)

### ADR-016: Approach B (Radical MVP) 채택
**결정**: 13 스프린트 → 10 스프린트. 솔로 퍼스트 노선과 정합.  
반려 이유 A: 솔로 1인 스코프 초과. 반려 이유 C: 두 번 만드는 비용.

---

## 12. 검증 현황

| 항목 | 상태 | 결과 |
|---|---|---|
| hooks API 서브에이전트 발화 | ✅ | 발화 확인 |
| 훅 페이로드 전달 방식 | ✅ | stdin JSON |
| gstack 절대경로 하드코딩 | ✅ | 다수 확인, 디렉토리 심링크 필요 |
| OMC 경로 참조 방식 | ✅ | 환경변수 기반 |
| ECC 경로 참조 방식 | ✅ | 환경변수 기반 |
| jq 미설치 Node.js 폴백 | ✅ | fd 0 방식 크로스 플랫폼 확인 |
| /dev/stdin Windows 호환성 | ✅ | 비호환 → fd 0 확정 |
| Windows 환경 구축 | ✅ | 완료 |
| Mac 환경 구축 (personal) | ✅ | 완료 |
| TS 6.0.2 안정성 | 🔲 | Sprint 0 blocking |
| Node 24 LTS 전환 | 🔲 | Sprint 0 blocking |
| P2 사용 빈도 측정 | 🔲 | Sprint 0 deferred (14일 병행) |
| P9 gstack 용량 측정 | 🔲 | Sprint 0 deferred |

---

## 13. 환경 구축 현황

### Windows (집) ✅ 완료
```
C:\Users\SMILE\.claude\  →  D:\.claude\
D:\.claude\skills\harness\  →  D:\dotoricode\dotfiles\claude\harness\
D:\.claude\skills\gstack\   →  vendors\gstack\
gstack setup 완료
```

### Mac (회사) ✅ 완료
```
~/.claude-personal/skills/harness/  →  ~/01_private/dotfiles/claude/harness/
~/.claude-personal/skills/gstack/   →  vendors/gstack/
~/.claude-work/skills/harness/      →  ~/01_private/dotfiles/claude/harness/
~/.claude-work/skills/gstack/       →  vendors/gstack/
gstack setup 완료 (personal + work)
direnv 설정 완료
```

---

## 14. v0.1.0 Done Definition

### 기능
- [x] `acorn install` 오케스트레이터 (`runInstall`) — 7단계 preflight-우선 파이프라인 *(Sprint 6)*
- [x] vendor clone + SHA 핀 (`core/vendors.ts`, `GitRunner` 주입) *(Sprint 6)*
- [x] 설치 멱등성: 두 번째 runInstall 은 모든 단계 noop *(Sprint 6)*
- [ ] `acorn install` CLI 래퍼 (Sprint 9에서 `src/index.ts` 라우팅)
- [ ] fresh macOS 실환경 검증 (실 git clone 포함)
- [ ] `acorn status` — 3개 툴 ✅ + guard ✅ + env 3키 ✅
- [ ] `acorn doctor` — 정상 상태에서 zero-issue
- [ ] 심링크 하나 수동 삭제 후 `acorn doctor`가 정확 지적
- [ ] `acorn doctor --json` 머신 판독 가능 구조
- [x] settings.json 기존 내용 보존 + env 3키만 추가 + backup 존재 *(Sprint 4 — settings.ts)*
- [x] 기존 env 키 충돌 시 에러+중단 (비파괴) *(Sprint 4 — SettingsError CONFLICT)*
- [x] preflight 단계에서 settings 충돌 감지 시 vendors 변경 없이 중단 *(Sprint 6)*
- [x] tx.log 트랜잭션 — 중단된 이전 설치 감지 시 IN_PROGRESS 에러 *(Sprint 6.5)*
- [x] vendor partial clone 정리 + dirty tree 감지(LOCAL_CHANGES) + git timeout *(Sprint 6.5)*
- [x] gstack 심링크 원자 교체(rename) + inspectGstackSymlink *(Sprint 6.5)*
- [x] defaultHarnessRoot 단일화 + CLAUDE_CONFIG_DIR 존중 *(Sprint 6.5)*

### guard 동작
- [x] `rm -rf /tmp/foo` → 차단 *(Sprint 1)*
- [x] `ACORN_GUARD_BYPASS=1` → 허용 + stderr 경고 *(Sprint 1)*
- [x] 파싱 실패 → fail-close *(Sprint 1)*

### 개발 품질
- [x] `npm run build` 성공 *(Sprint 0)*
- [x] `npm test` 통과 (S2~S6.5 — 86개 테스트)
- [x] README 3절 (설치·사용·트러블슈팅) *(초안, Sprint 1 기준)*
- [ ] `.github/workflows/ci.yml` placeholder 커밋

---

## 15. 구현 시작 프롬프트

```
docs/acorn-v1-plan.md 를 읽어줘.

Sprint 0 blocking부터 시작해줘:
1. npm run build 가 현재 상태에서 클린하게 돌지 확인
2. 이슈 있으면 typescript@^5.5.0 으로 다운그레이드
3. .nvmrc 에 '24' 추가, package.json engines 에 "node": ">=24.0.0 <25.0.0" 추가

완료 후 /review → /ship
이후 Sprint 1 (hooks/guard-check.sh) 착수 준비 완료 상태로 만들어줘.
```

---

*최종 업데이트: 2026-04-13*  
*상태: ✅ 설계 완료 — Sprint 0 착수 가능*  
*Design Doc: `~/.gstack/projects/dotoricode-acorn/youngsang.kwon-main-design-20260413-154802.md`*
