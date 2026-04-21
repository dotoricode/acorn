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
7. hooks 배포 (guard-check.sh)         ← v0.1.2 신설 (ADR-017)
8. settings.json 원자적 쓰기            ← 마지막
```

Ctrl-C 중단 처리: 재실행 시 `in_progress` tx.log 감지 → 즉시 실패 + 수동 검사 안내

**[7] hooks 배포 단계 명세 (ADR-017)**
- 소스: 패키지 내장 `hooks/guard-check.sh` (npm 배포 시 동봉)
- 대상: `<harnessRoot>/hooks/guard-check.sh`
- 백업: 기존 파일이 있고 내용이 다르면 `<harnessRoot>/backup/{ISO8601}/hooks/guard-check.sh.bak`
- 실행권: `chmod 0o755` (Windows 무시)
- 멱등: 내용·mode 모두 동일하면 noop
- tx.log phase 이름: `hooks`

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
        ├── registry.json           ← §15 M1: v1.1+ 연기. 현재 acorn 은 read/write 안 함
        └── hooks/
            └── guard-check.sh      ← install 이 자동 배포 (§15 C2 / ADR-017, v0.1.2+)
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

### ADR-017: hooks 배포 단계 신설 (v0.1.2)
**결정**: `runInstall` 파이프라인에 `[7] hooks` phase 추가. settings.json 이 참조하는 `hooks/guard-check.sh` 를 패키지 동봉본에서 `<harnessRoot>/hooks/` 로 비파괴적 복사.

**배경**: v0.1.1 까지 `settings.json` 의 PreToolUse 훅은 `<harnessRoot>/hooks/guard-check.sh` 를 참조하지만 install 파이프라인이 해당 파일을 배포하지 않았다. 사용자는 매 `acorn install` 후 수동으로 파일을 복사해야 했고, 미복사 시 모든 Bash 툴 호출이 `No such file or directory` 로 차단되었다.

**원칙**: settings.json 이 약속한 artifact 는 install 이 디스크에 만든다. "약속 ↔ 배달" 갭은 fail-close 와 동급의 1순위 신뢰 침해.

**위치**: gstack-setup 직후, settings-write 직전. 이유:
- settings-write 가 마지막이라는 기존 불변식 유지
- hooks 파일이 없는 상태로 settings.json 만 먼저 써지는 윈도우 제거
- gstack setup 이후로 두는 이유: hooks 도 일종의 "외부 artifact" 라서 vendors 와 동선 일치

**멱등**: 내용 hash + 파일 mode 동일 → noop. 다르면 timestamped backup → 원자 쓰기.

---

### ADR-018: `--adopt` — "lock 은 진실, 현실은 이름 바꿔 보존" (v0.3.0)

**결정**: `acorn install --adopt` 는 기존 수동 설치 상태 (`NOT_A_REPO` vendor, settings.json env 충돌) 를 파괴 없이 흡수한다. 삭제는 일절 없음 — 항상 `<path>.pre-adopt-<ISO8601>/` 또는 `env.<key>.pre-adopt-<ISO8601>` 로 이동 후 lock 기준값을 덮어쓴다.

**배경**: Round 1 도그푸딩에서 Mac personal 머신이 수동 설치된 vendors/OMC, gstack 을 가지고 있던 탓에 `acorn install` 이 `NOT_A_REPO` 로 막혔다. 사용자 조치는 `rm -rf` 또는 수동 mv — acorn 의 "비파괴" 원칙과 맞지 않는 외부 지시였다.

**원칙**:
1. Lock 은 진실의 단일 소스. 현실이 lock 과 다르면 **현실을 바꾼다**, 단 파괴 없이
2. `.pre-adopt-<ts>` 접미어 디스크/JSON 이동만 사용 — 복구 가능
3. 사용자 후처리: 이동된 디렉토리/키는 직접 확인·머지·폐기 (acorn 은 재접근 안 함)

**범위 (v0.3.0)**:
- vendor 경로가 non-git 디렉토리 → `preAdoptMove` 후 clone + checkout
- settings.json env 충돌 → 충돌 키 이름 바꾸기 + 기대값 덮어쓰기
- vendor 경로가 파일 (ENOTDIR) → `IO` 에러 (§15 H4) 유지, adopt 도 거부 (이동 안 됨)

**비범위**:
- 심링크 vendor — ADR-019 참조
- `tx.log`/`harness.lock` 자체 adopt — 이미 다른 메커니즘으로 커버 (C1 seed, H3 corrupt)

### ADR-019: 심링크 vendor 는 "dev 레포" 로 간주, 기본 preserve (v0.3.0)

**결정**: `vendors/<tool>` 이 심링크면 adopt 대상에서 기본 제외. `--follow-symlink` 를 명시적으로 지정하면 target 의 HEAD 를 revParse 로 읽어 lock SHA 와 비교만 한다. 어떤 경우에도 심링크 target 자체는 acorn 이 수정하지 않는다.

**배경**: Round 1 실환경에서 `vendors/ecc` 가 사용자의 개발 레포 (`~/01_private/everything-claude-code`) 를 가리키는 심링크였다. 여기에 acorn 이 checkout 을 강요하면 사용자 작업 브랜치가 망가진다. 심링크는 "이 경로는 내 작업공간" 이라는 사용자 의도의 표식으로 해석.

**동작**:
- 기본: `action='preserved'`, `previousCommit=null`, lock 변경 없음
- `--follow-symlink`: `revParse(target)` 로 HEAD 확인. 일치하면 `adopted`, 불일치면 `preserved` + `previousCommit` 채워서 상위가 판단 (자동 lock 갱신 안 함)

**상위 판단 (install 출력)**:
- `preserved` + follow-symlink → 로그에 "symlink target HEAD 확인됨" 표기
- drift 감지되면 사용자가 `acorn config ... lock` 으로 직접 갱신 (v0.3 범위 밖, v0.4+ `acorn lock bump`)

**v0.3.4 H-3 개정**: `--follow-symlink` 성공 경로를 엄격화. revParse throw 흡수 제거.
`target 이 git 저장소 아님 → NOT_A_REPO` / `revParse 실행 실패 → REV_PARSE` /
`HEAD ≠ lock SHA → SHA_MISMATCH` (drift 확정, 조치 안내) / `HEAD == lock SHA → adopted`.
`'preserved'` action 은 현재 어느 경로도 emit 하지 않으며 VendorAction union 에만 남아 있다.

### ADR-020: 공급망 무결성 (v0.4.0)

**결정**: 공격 표면을 3조각으로 분해하고, 각각에 대해 구현 vs 연기 판정.

**(1) `harness.lock.tools.*.repo` allowlist — 구현**

현재 `parseLock` 은 `/^[\w.-]+\/[\w.-]+$/` 형식만 확인해 어떤 GitHub 저장소든 허용. 악성 lock 파일 (dotfiles 리포 탈취 등) 이 `omc.repo` 를 공격자 리포로 교체하면 다음 `acorn install` 이 그대로 clone. v0.4.0 은 `ALLOWED_REPOS` 를 hardcode 하고 lock 파싱 단계에서 검증:

- `omc: Yeachan-Heo/oh-my-claudecode`
- `gstack: garrytan/gstack`
- `ecc: affaan-m/everything-claude-code`

Escape hatch: `ACORN_ALLOW_ANY_REPO=1` 환경변수 — fork 시험, 내부 미러, 로컬 dev 용.
Doctor 가 lock 의 repo 가 allowlist 에서 벗어났는데 override 도 없으면 critical.

Breaking 가능성이 있으므로 v0.3.x patch 가 아닌 v0.4.0 minor bump 로 ship.

**(2) npm `--provenance` CI workflow — 구현**

GitHub Actions 에서 tag `v*.*.*` push 시 OIDC 로 `npm publish --provenance` 수행. sigstore 가 "이 tarball 은 이 repo 의 이 commit 에서 빌드됨" 을 서명한 attestation 을 npm 에 함께 업로드. 사용자는 `npm audit signatures` 또는 `npm view @dotoricode/acorn --provenance` 로 확인 가능.

방어 대상: npm 계정 탈취 → 무작위 tarball 업로드. 탈취자가 GitHub Actions workflow 도 통과시키려면 repo commit 권한까지 필요 (2-hop), 훨씬 비싼 공격으로 격상.

수동 `npm publish` 는 실수 방지를 위해 README/CONTRIBUTING 에 금지 명기.

**(3) shipped 파일 sha256 pinning — v0.5+ 연기**

Critic 제안: `<harnessRoot>/hooks/guard-check.sh` 를 bundled 원본과 sha256 비교해 tampering 감지. 분석 후 연기:

- 공격 모델이 narrow: bundled 원본(`node_modules/`) 은 trusted 로 가정하고 deployed 만 의심 — global npm 설치 + user-owned harness root 인 경우에만 유효. `npm link` / dev 환경에선 둘 다 user-writable 이라 의미 없음.
- 구현 비용이 moderate: build 타임 sha256 계산 + install-time 비교 + doctor advisory 로직 + 사용자 custom 수정 허용할지 정책 결정 (strict vs advisory).
- (1)+(2) 가 이미 유의미한 방어. (3) 은 "정교한 FS-only 공격자" 대비 한 층 더.

v0.5+ 에서 재평가 — integration test (ARCH-R1) 가 먼저 와야 pinning 회귀 잡을 수 있다.

**기타**: `npm pack files 화이트리스트 (v0.3.1 CRIT-1)` 는 이미 v0.3.x 에서 완료. ADR 수준의 명문화는 필요 없음 (CLAUDE.md "npm pack 화이트리스트" 섹션 + CHANGELOG [0.3.1] 에 기록).

### ADR-021 (예정): tx.log transaction ID (v0.5+)

**배경**: v0.4.1 codex review (2026-04-18) §6 지적. 현재 `lastInProgress` 는
`readEvents` 가 **모든** 라인을 순회하며 corrupt 를 OR-accumulate → 한 라인이
JSON 파싱 실패하면 영구히 IN_PROGRESS 로 굳어버린다 (`--force` 로만 우회).
v0.1.3 §15 H3 의 명시적 trade-off 였으나, (a) tx 당 고유 id 가 없어 interleaved
install (에지 케이스) 를 구분 불가, (b) orphan corrupt 가 운영 중 누적되면
UX 퇴화가 심각해진다는 피드백.

**잠정 방향 (v0.5+ 확정 예정)**:
- `TxEvent.id: string` (uuid/ulid) 필드 추가 — `begin` 이벤트가 생성,
  `phase`/`commit`/`abort` 가 동일 id 로 associate.
- `lastInProgress` 는 **id 기준** 으로 open(begin 있음 + commit/abort 없음) 인
  id 만 in_progress 로 보고. orphan corrupt 는 warning 레벨로 강등, 기본 차단
  하지 않고 doctor 가 사용자 정리 유도.
- Strict 모드 (`ACORN_TX_STRICT=1`) 로 기존 v0.1.3 H3 동작 (fail-close) 보존.
- 회귀 테스트: 동시 `runInstall` 두 번 + corrupt injection + `--force` 효과 확인.

v0.5.0 에서 integration test (ARCH-R1) 와 같은 window 에 묶어 release.

### ADR (v0.4.1 — codex review P0 5건 hotfix)

**배경**: v0.4.0 직후 외부 검토 10건 중 즉시 가치 있는 P0 5건을 patch 단일
릴리스로 묶음. 테마 "fail-close 복원 + silent-lie 제거" 가 v0.3.x 와 동일.
분할하지 않은 이유: 5건 모두 격리된 작은 diff, 다음 작업 (Round 3 도그푸딩)
신뢰도의 전제조건이라 먼저 처리.

**반영 항목**:

- **#3 env.ts empty-string guard**: `??` → `envOrDefault` (nullish + empty-
  string 둘 다 처리). `CLAUDE_CONFIG_DIR=''` / `ACORN_HARNESS_ROOT=''` 가
  CWD 상대 경로로 새는 silent 오염 차단.
- **#2 settings / config malformed env fail-close**: `getEnvSection` 이
  non-object 를 빈 섹션으로 코어스하던 silent overwrite 를 `SettingsError
  (PARSE)` / `ConfigError(SCHEMA)` throw 로 교정. absent (undefined) 만
  기존대로 빈 섹션.
- **#4 settings.ts BOM strip**: `parseLock` 에만 있던 BOM 처리를
  `readSettings` 에도 적용. `src/core/bom.ts` 신규 헬퍼로 lock/config/
  settings 3곳 single source.
- **#5 status.ts diffEnv self-compare 제거**: `runtimeEnv` 미지정 시
  `diffEnv(desired, desired)` fake-match → 빈 배열 반환. 라이브러리
  호출자 계약 정직화. CLI 경로는 이미 `process.env` 명시 주입이라 영향 없음.
- **#9 config.ts TOCTOU SyntaxError 번역**: 두 번째 `readFileSync + JSON.
  parse` 를 `try/catch` 로 감싸 `ConfigError(SCHEMA)` 로 변환. exit-code
  매핑 (`CONFIG=2`) 우회 차단. `parseLock` 재검증 경로의 `LockError` 도 동일.

**연기 (v0.4.2)**: #1 `installVendor` path traversal guard, #7 Windows
`shell: true` 제거. 단독 Sprint — 둘 다 인터페이스/의존성 변경 포함.

**연기 (v0.5+)**: #6 tx ID (ADR-021 위), #10 junction test helper.

**부채 기록만 (조치 없음)**: #8 `verifyGstackSetupArtifacts` 의 `SKILL.md`
하드코드 — SHA 락 전제상 silent false-negative 경로가 구조적으로 존재하지
않음 (upstream rename 은 lock bump 단계에서 감지).

### ADR-022: Phase 시스템 도입 (v0.7.0)

**결정**: `<harnessRoot>/phase.txt` 단일 텍스트 파일을 단일 진실 소스로 하고,
`acorn phase <value>` 커맨드로 전환. `hooks/guard-check.sh` 가 매 Bash 호출마다
읽어 강제 수준을 결정. CLAUDE.md 에 마커 블록으로 phase 지침 주입.

**매핑**: `prototype → minimal`, `dev → moderate`, `production → strict`.

**대안 비교**:
- (a) `harness.lock.phase` 필드 통합 → reject. lock 은 "SHA snapshot" 의미론. phase 는 "런타임 상태". 훅이 매 호출마다 lock 전체를 jq/node 로 파싱 — phase.txt single-line read 대비 10-100x 느림.
- (b) 별도 `phase.txt` → accept. single-line read, atomic write, gstack-marker 선례 존재.

**우선순위**: `ACORN_GUARD_BYPASS` > `ACORN_PHASE_OVERRIDE` > `ACORN_GUARD_PATTERNS` > `phase.txt` > `harness.lock.guard.patterns` > 기본 `strict`.

### ADR-023: CLAUDE.md 관리 모듈 (v0.7.0)

**결정**: 신규 모듈 `src/core/claude-md.ts` 로 `<!-- ACORN:PHASE:START -->` /
`<!-- ACORN:PHASE:END -->` 마커 기반 비파괴 주입. settings.ts 의 plan/apply 패턴 미러.
atomic write (tmp+rename) + `<harnessRoot>/backup/<ts>/claude-md/CLAUDE.md.bak`.

**이유**: OMC 가 이미 `<!-- OMC:START -->` 마커로 CLAUDE.md 를 관리한다.
네임스페이스를 `ACORN:PHASE:` 로 구분해 OMC 블록과 충돌 없이 병렬 주입.

**corrupt 대응**: START 만 있고 END 없는 경우 → `ClaudeMdError('MARKER_CORRUPT')` fail-close. 자동 복구 없음.

### ADR-024: harness.lock schema v1 유지 (v0.7.0)

**결정**: phase 시스템 때문에 `schema_version` 을 2 로 bump **하지 않는다**.
`TOOL_NAMES` 도 `['omc', 'gstack', 'ecc']` 3개 유지.

**이유**: (1) phase 는 `phase.txt` 로 격리되므로 스키마 변경 불필요.
(2) 한 릴리스에 한 이슈 원칙 (ADR-021) — phase 도입 + tool 확장 동시 진행 시 회귀 bisect 비용 ↑.
(3) `TOOL_NAMES` 확장은 optional tool 지원 설계(ADR-025)와 묶어야 함.

### ADR-025: harness.lock schema v2 + optional_tools (v0.8.0)

**결정**: `schema_version` 을 1 → 2 로 bump 하고 `optional_tools` 필드를 추가.
코어 3종(`omc`, `gstack`, `ecc`)은 기존 `tools` 에 유지.
`superpowers`, `claude-mem` 등 third-party 는 `optional_tools` 에 기재.

**설계**:
- `OPTIONAL_TOOL_NAMES = ['superpowers', 'claude-mem'] as const`
- `HarnessLock.optional_tools: Partial<Record<OptionalToolName, ToolEntry>>`
- v1 lock 은 `parseLock` 이 in-memory v2 로 투명 마이그레이션 (디스크 변경 없음)
- 알 수 없는 optional tool key → `SCHEMA` 에러 (fail-close 원칙)
- allowlist 없음: optional tool 은 third-party repo 허용 (ACORN_ALLOW_ANY_REPO 불요)

**이유**: (1) 사용자 생태계 확장 요구 수용. (2) 코어 툴 allowlist 분리로 보안 경계 유지.
(3) v1 파일 보존 (비파괴) — `acorn install` 없이도 기존 설치 그대로 동작.

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
- [x] `acorn install` CLI 래퍼 (`src/index.ts` 라우팅) *(Sprint 9)*
- [ ] fresh macOS 실환경 검증 (실 git clone 포함)
- [x] `acorn status` 오케스트레이션 (`collectStatus` + `renderStatus` + `summarize`) — 3개 툴 + guard + env 3키 + gstack 심링크 *(Sprint 7)*
- [x] `acorn status` CLI 래퍼 + `--json` *(Sprint 9)*
- [x] `acorn doctor` 오케스트레이션 (`runDoctor`) — 정상 상태에서 zero-issue *(Sprint 8)*
- [x] 심링크 수동 삭제 후 `runDoctor` 가 critical 로 정확 지적 *(Sprint 8, 테스트 포함)*
- [x] `renderDoctorJson` 머신 판독 가능 구조 `{ok, issues[], tools, env, ...}` *(Sprint 8)*
- [x] `acorn doctor` CLI 래퍼 + `--json` 플래그 *(Sprint 9)*
- [x] settings.json 기존 내용 보존 + env 3키만 추가 + backup 존재 *(Sprint 4 — settings.ts)*
- [x] 기존 env 키 충돌 시 에러+중단 (비파괴) *(Sprint 4 — SettingsError CONFLICT)*
- [x] preflight 단계에서 settings 충돌 감지 시 vendors 변경 없이 중단 *(Sprint 6)*
- [x] tx.log 트랜잭션 — 중단된 이전 설치 감지 시 IN_PROGRESS 에러 *(Sprint 6.5)*
- [x] vendor partial clone 정리 + dirty tree 감지(LOCAL_CHANGES) + git timeout *(Sprint 6.5)*
- [x] gstack 심링크 원자 교체(rename) + inspectGstackSymlink *(Sprint 6.5)*
- [x] defaultHarnessRoot 단일화 + CLAUDE_CONFIG_DIR 존중 *(Sprint 6.5)*
- [x] `acorn uninstall [--yes]` — install 역순 7단계 파이프라인 *(v0.9.0)*
  - vendors 디렉토리, gstack 심링크, hooks/guard-check.sh, .gstack-setup.sha, phase.txt,
    settings.json ENV_KEYS, CLAUDE.md ACORN:PHASE 마커 제거. harness.lock/tx.log/backup 보존.
  - corrupt CLAUDE.md 마커 → fail-soft (제거 건너뜀, 전체 언인스톨 계속)
  - 비심링크 디렉토리 보호 (not_a_symlink — 건드리지 않음)
  - non-TTY + `--yes` 없음 → USAGE 차단 (등급-3 확인 게이트)

### guard 동작
- [x] `rm -rf /tmp/foo` → 차단 *(Sprint 1)*
- [x] `ACORN_GUARD_BYPASS=1` → 허용 + stderr 경고 *(Sprint 1)*
- [x] 파싱 실패 → fail-close *(Sprint 1)*
- [x] `acorn install` 이 `<harnessRoot>/hooks/guard-check.sh` 자동 배포 *(v0.1.2 — ADR-017 / §15 C2 구현 완료)*
- [x] `harness.lock.guard.patterns` 가 실제 차단 패턴에 영향 *(v0.2.0 — §15 H1 구현 완료: strict/moderate/minimal 3단계 dispatch)*

### 개발 품질
- [x] `npm run build` 성공 *(Sprint 0)*
- [x] `npm test` 통과 (S2~S9 — 110개 테스트)
- [x] README 3절 (설치·사용·트러블슈팅) *(초안, Sprint 1 기준)*
- [x] `.github/workflows/ci.yml` placeholder 커밋 *(Sprint 10, workflow_dispatch 만 활성)*
- [x] CHANGELOG.md 초안 *(Sprint 10)*
- [x] package.json version 0.0.1 → 0.1.0 *(Sprint 10)*
- [x] README 빠른 시작 · Exit code 규약 섹션 재편 *(Sprint 10)*

---

## 15. v0.1.x 알려진 갭 (2026-04-17 audit)

3개 독립 critic 에이전트(coverage / idempotency / cross-platform)가 병렬 검토한 결과.
"settings.json 이 참조하지만 install 이 배달 안 함" (guard-check.sh 누락) 발견을 계기로 같은 클래스 버그를 추적했다.

### 🔴 CRITICAL — 매 fresh install 또는 silent success-lie

| ID | 증상 | 증거 | 도그푸딩 포착 (Round 2, `DOGFOOD.md`) |
|---|---|---|---|
| C1 | `acorn install` 가 빈 harness root 에서 즉시 `LOCK_NOT_FOUND` 로 실패. install 이 `harness.lock` 을 부트스트랩하지 않음 | `src/commands/install.ts:186-188` → `src/core/lock.ts:153` | ❌ — 이미 lock 있는 상태에서만 테스트 |
| C2 | `settings.json` 이 참조하는 `hooks/guard-check.sh` 가 install 로 배포되지 않음 (ADR-017 로 수습) | 본 문서 §11 ADR-017 | ⚠️ — 본 라운드 S7 을 별도 세션으로 deferred. Session-A 의 PreToolUse 훅 설정 시도에서 확인됨 |
| C3 | 두 번째 `runInstall()` 호출 시 `gstack ./setup --host auto` 가 무조건 재실행. "두 번째 호출은 모든 단계 noop" 불변식 위반 | `src/commands/install.ts:259-283` | ❌ — D-1 에서 vendor noop 만 확인, gstack setup 재실행 여부는 관찰 안 함 |
| C4 | gstack 심링크 `wrong_target` 분기에서 `unlinkSync` 전 백업 없음. "비파괴" 원칙 위반 | `src/core/symlink.ts:111-131` | ❌ — D-2 는 `absent` 분기만 탐. `wrong_target` 분기 미경험 |
| C5 | `defaultGstackSetup` 가 spawn exit=0 만 보고 성공 보고. gstack artifact (`.claude/skills/gstack/SKILL.md` 등) 실존 검증 없음 — 셸 파싱 에러 흡수 시 install 이 ✅ 로 끝남 | `src/commands/install.ts:78` | ❌ — spawn exit 만 보면 늘 통과. artifact 검증 자체가 기능 부재 |
| C6 | `runDoctor` 가 `isDirty` 실패를 try-catch 로 흡수 → dirty vendor 를 ✅ 로 보고. install 은 거부, doctor 는 통과: 검증 표면이 거짓말 | `src/commands/doctor.ts:101-103` | ⚠️ — D-0/S3 에서 gstack dirty 가 정상 감지된 건 catch 안 들어간 운 좋은 케이스. isDirty 실패 경로 (권한·손상) 를 타야 silent-lie 발화 |

### 🟠 HIGH — 신뢰 체인 / fail-close 위반

| ID | 증상 | 증거 |
|---|---|---|
| H1 | `harness.lock.guard.patterns` 가 dead config. 스키마/status/README 모두 노출하지만 hook 은 `.guard.mode` 만 읽음. `strict→minimal` 변경해도 차단 동작 무변화 | `hooks/guard-check.sh:25,30,104-113` vs `src/core/lock.ts:12-13` |
| H2 | "버전 고정: harness.lock SHA 기준" 신뢰 체인이 first install 에서 강제 불가 (C1 의 결과) — 사용자가 손편집한 lock 을 install 이 그대로 신뢰 | CLAUDE.md L10 vs C1 |
| H3 | `tx.log` 마지막 줄 corrupt 시 `JSON.parse` catch 로 skip. 이전 줄이 `commit` 이면 `lastInProgress` 가 `null` 반환 → fail-open. partial-write crash 시나리오 | `src/core/tx.ts:42` |
| H4 | `isEmptyDir` 가 `readdirSync` 예외를 흡수하고 `false` 반환. EACCES 같은 권한 에러가 `NOT_A_REPO` 로 둔갑하면서 `rm -rf` 힌트 제공 — 잘못된 조치 유도 | `src/core/vendors.ts:174-181` (이후 `:200-211` rm 경로) |

### 🟡 MEDIUM — 문서/스펙 drift, 부분 검증 표면

| ID | 증상 | 증거 |
|---|---|---|
| M1 | `registry.json` 이 CLAUDE.md L54·plan §9 에 명시되지만 `src/` 어디서도 read/write 안 함 (registry.ts 는 v1.1+ 연기) | `Grep registry.json src/` → 0 hit |
| M2 | 백업 스코프 P8 명세보다 축소: `symlinks/{path}.info` 미생성, `tx.log` 가 timestamped backup 디렉토리 밖 | `src/core/settings.ts:144-157`, `src/core/tx.ts:20` |
| M3 | status/doctor 의 env diff 가 settings.json 파일만 읽음. "settings 는 정확하지만 Claude Code 가 reload 안 한 상태" 검출 불가 | `src/commands/status.ts:100-106` |
| M4 | Windows 케이스-비민감 FS 에서 symlink 비교가 strict string equality. `D:\dotori\` vs `D:\Dotori\` 가 false `wrong_target` 으로 보고됨 | `src/core/symlink.ts:60-61` |
| M5 | CLAUDE.md L17 가 존재하지 않는 `core/registry`, `core/guard` 모듈 언급. L31 `--force` 는 "노출 예정"이지만 이미 구현(`src/index.ts:139`) | CLAUDE.md vs `src/core/` 실 디렉토리 |

### ⚪ LOW — 코스메틱 / 미래 정리

- L1. CRLF 처리 누락 (`vendors.ts:124`, `git status --porcelain` Windows), `\\?\` UNC prefix 비교 불일치 (`symlink.ts:62`)
- L2. `tx.log` 무한 append, 회전 없음
- L3. `runDoctor.ok` 의 `severity !== 'info'` carve-out 은 dead code (info-severity 발생 코드 없음)

### 처리 계획

| 버킷 | 대상 | 시점 |
|---|---|---|
| **v0.1.2 (긴급)** | C1, C2, C5, C6 | hooks-write phase + gstack artifact verify + doctor isDirty 노출 + lock 부트스트랩 (에러 메시지 + 패키지 동봉본 시드) |
| **v0.1.3** | C3, C4, H3, H4 | gstack-setup SHA marker 멱등화 + symlink backup 추가 + tx.log corrupt fail-close + isEmptyDir 에러 propagate |
| **v0.2.0** | H1, M1~M5 | guard.patterns 실연결 또는 스키마 제거, registry.json 결정, backup 스코프 복원, env runtime check, Windows 케이스 비교, CLAUDE.md 문서 정합화 |
| **백로그** | L1~L3 | 발견 시점 기준 12개월 내 |

각 항목은 별도 PR. 같은 PR 에 묶지 말 것 — 회귀 시 bisect 비용.

---

## 16. 구현 시작 프롬프트

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
