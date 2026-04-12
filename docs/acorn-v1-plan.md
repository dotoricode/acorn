# acorn v1.0.0 기획안

> Claude Code 하네스 엔지니어링 툴(OMC, gstack, ECC)의 설치·구성·활성화를 통합 관리하는 CLI  
> 패키지명: `@dotoricode/acorn`

---

## 1. 프로젝트 개요

### 한 줄 정의

> "세 툴을 격리 설치하고, 충돌을 해소한 최적 조합을 고정 버전으로 활성화하는 CLI"

### 배경

Claude Code 하네스 생태계에는 세 가지 주요 툴이 존재한다:

| 툴 | 포지셔닝 | 라이선스 |
|---|---|---|
| **oh-my-claudecode (OMC)** | 멀티에이전트 오케스트레이션 | MIT |
| **gstack** | 역할 기반 개발 워크플로우 | MIT |
| **everything-claude-code (ECC)** | 하네스 엔지니어링 최적화 시스템 | MIT |

세 툴 모두 MIT 라이선스로, fork / clone / 재배포 모두 허용. 저작권 고지 유지 의무.

각 툴은 강력하지만 **세 가지 구조적 문제**를 공유한다:

1. 설치 경험이 개발자 전제 — 비개발자/주니어는 첫 단계에서 이탈
2. 스킬 네임스페이스 충돌 — 동시 사용 시 덮어쓰기 발생
3. 관리 불가능한 블랙박스 — "어디에 뭐가 설치됐는지 모르는" 상태

---

## 2. 핵심 원칙

- **설치·구성·활성화 레이어** — 각 툴과 경쟁하지 않고 보완 관계
- **격리 우선** — 단일 관리 위치로 신뢰의 기반 확보
- **버전 고정** — dotori가 검증한 커밋 SHA만 사용자에게 배포
- **단일 책임** — 메인 CLI와 업데이트 매니저(`acorn dev`) 분리
- **비파괴적** — 기존 설정 절대 덮어쓰지 않음, 충돌 시 백업 후 복원 보장
- **fail-close** — 파싱/실행 실패 시 허용이 아닌 차단이 기본

---

## 3. 스코프 (v1.0.0)

### In Scope

- [x] 세 툴 격리 설치 (`~/.claude/skills/harness/vendors/` 하위)
- [x] gstack 디렉토리 심링크 처리 (하드코딩 경로 대응)
- [x] OMC / ECC 환경변수 주입 (shell profile 기반)
- [x] 충돌 스킬 자동 해소 (우선순위 테이블 기반, 심링크 방식)
- [x] `harness.lock` 버전 고정 (커밋 SHA 기반)
- [x] 전역 / 레포 단위 적용 분리
- [x] guard 블로킹 강도 설정 (`mode` + `patterns`)
- [x] guard 훅 스크립트 크로스 플랫폼 구현 (`fd 0` + fail-close)
- [x] 업스트림 변경 알림 (`acorn dev check` — dotori 전용)
- [x] 사용자 전용 / dotori 전용 커맨드 분리

### Out of Scope (v1.1.0+)

- [ ] GUI / TUI
- [ ] 프로파일 시스템 (온오프 토글)
- [ ] 자동 업데이트 실행 (사용자 측)
- [ ] 토큰 비용 예측 연동 (gk 연동)
- [ ] Diff-aware 자동 활성화
- [ ] CLAUDE.md 컴포지터
- [ ] LLM 기반 스킬 diff 요약
- [ ] omc-learned / learned/ 경로 격리 (현재 환경 미존재 확인, 불필요)

---

## 4. 충돌 해소 우선순위 테이블

### 🔴 충돌 영역 — 승자 단일 지정

| 기능 영역 | OMC | gstack | ECC | 승자 | 근거 |
|---|---|---|---|---|---|
| **플래닝** | `ralplan` (인터뷰+실행 통합) | `office-hours → plan-ceo-review → plan-eng-review` 파이프라인 | architect agent | **gstack** | 스킬 간 아웃풋 체이닝 구조가 가장 체계적. OMC는 플래닝/실행 분리 불가 |
| **코드 리뷰** | `/review` (일반) | `/review` (production bug 탐지) | 언어별 전문 리뷰어 (10개 언어) | **ECC** | 언어별 세분화 수준 압도적 |
| **QA** | `/ultraqa` (자율 루프) | `/qa` (real Chromium) | QA agents | **gstack** | 유일한 실브라우저 QA. UI/E2E 테스트 커버 가능 |
| **병렬 실행** | autopilot/ralph/ultrawork/team | Conductor | parallel workers | **OMC** | 스마트 모델 라우팅(Haiku/Opus), 토큰 30~50% 절감 |
| **보안 감사** | `/security-review` | `/cso` | AgentShield | **ECC** | CVE 대응, 샌드박싱, 공격 벡터 분석 포함 |
| **문서화** | 없음 | `/document-release` | doc 스킬 | **gstack** | `/ship` 실행 시 README/ARCHITECTURE/CLAUDE.md 자동 최신화 |
| **배포** | 기본 | `/ship`, `/land-and-deploy`, `/canary` | deployment skills | **gstack** | canary 배포, 배포 후 검증 파이프라인화 |

### 🟡 가드레일 — 레이어가 달라 공존

| 툴 | 레이어 | 역할 |
|---|---|---|
| **gstack** `/careful`, `/freeze`, `/guard` | 런타임 인터랙티브 | 위험 커맨드 실행 전 사용자 확인 |
| **ECC** TypeScript guardrail engine (R01~R13) | 컴파일 타임 규칙 | 훅 레벨에서 정적 규칙 강제 |

두 레이어 병행 활성화. 충돌 없음.

### 🟢 고유 영역 — 충돌 없이 그대로 탑재

| 기능 영역 | 담당 툴 |
|---|---|
| 자율 실행 루프 (sisyphus 패턴) | OMC |
| 실브라우저 자동화 (GStack Browser) | gstack |
| 크로스 하네스 (Codex/Cursor/OpenCode) | ECC |
| 팀 retro | gstack |
| 세션 복구 (`omc wait`) | OMC |
| HUD / 실시간 관측성 | OMC |
| 위키/지식 축적 (`/wiki`) | OMC |
| 디자인 시스템 (`/design-consultation`) | gstack |
| 비용 감사 (`ecc-tools-cost-audit`) | ECC |

---

## 5. 갭 분석 — acorn이 메꾸는 영역

| 갭 | 발생 툴 | acorn 해결 방식 |
|---|---|---|
| 설치 직후 진입점 불명확 | ECC | 첫 실행 시 `gstack /office-hours`로 자동 안내 |
| 자율 실행 중 가드레일 없음 | OMC autopilot | OMC 실행 전 gstack `/guard` 훅 자동 활성화 |
| 플래닝과 실행 분리 안 됨 | OMC ralplan | gstack plan → OMC execute 핸드오프 파이프라인 |
| 업데이트 후 충돌 감지 없음 | 세 툴 공통 | dotori가 `acorn dev check`로 매일 점검 후 검증 배포 |

---

## 6. 아키텍처 개요

### 디렉토리 구조

```
~/.claude/
├── skills/
│   ├── harness/                    ← acorn 전용 네임스페이스
│   │   ├── vendors/
│   │   │   ├── gstack/             ← gstack 실제 파일 위치
│   │   │   ├── omc/                ← OMC 실제 파일 위치
│   │   │   └── ecc/                ← ECC 실제 파일 위치
│   │   ├── backup/
│   │   │   └── gstack-<timestamp>/ ← 기존 gstack 설치본 백업
│   │   ├── harness.lock
│   │   ├── registry.json
│   │   └── hooks/
│   │       └── guard-check.sh      ← 크로스 플랫폼, fail-close
│   └── gstack/                     → harness/vendors/gstack (디렉토리 심링크)
└── commands/                       ← 충돌 해소 후 활성화된 스킬만 심링크

[레포 단위 오버라이드]
my-project/
└── .claude/
    └── commands/
```

### 툴별 경로 처리 방식 ✅ 테스트 검증 완료

| 툴 | 판정 | 본체 경로 참조 방식 | acorn 처리 |
|---|---|---|---|
| **gstack** | ⚠️ | `~/.claude/skills/gstack/` 하드코딩 다수 | 디렉토리 심링크 필수 |
| **OMC** | ✅ | `${CLAUDE_PLUGIN_ROOT}` 환경변수 기반 | 환경변수 주입만으로 해결 |
| **ECC** | ✅ | `CLAUDE_PLUGIN_ROOT` → `ECC_ROOT` → auto-discover 3단 폴백 | 환경변수 주입만으로 해결 |

### 환경변수 주입 (acorn install 시 shell profile에 추가)

```bash
# ~/.zshrc 또는 ~/.bashrc (감지된 shell 기준)
export CLAUDE_PLUGIN_ROOT=~/.claude/skills/harness/vendors/omc
export OMC_PLUGIN_ROOT=~/.claude/skills/harness/vendors/omc
export ECC_ROOT=~/.claude/skills/harness/vendors/ecc
```

`acorn uninstall` 시 주입 라인 정확히 제거 보장.

### gstack 설치/제거 흐름

```
[acorn install]
1. ~/.claude/skills/gstack/ 존재 여부 확인
2. 존재하면 → backup/gstack-<timestamp>/ 백업
3. vendors/gstack/ 에 실제 설치 (@ harness.lock SHA)
4. ~/.claude/skills/gstack → vendors/gstack 디렉토리 심링크 생성

[acorn uninstall --tool gstack]
1. 심링크 제거
2. vendors/gstack/ 삭제
3. 백업본 존재 시 복원 여부 확인 (등급 2)
```

### 버전 고정 구조

```
[업스트림 원본 레포]        [dotori]                   [사용자]
OMC / gstack / ECC  →   dotoricode/omc-watch        @dotoricode/acorn
                         dotoricode/gstack-watch     (npm 배포판)
                         dotoricode/ecc-watch
                         (upstream 추적용 fork)
                                ↓
                         acorn dev check 매일 실행
                         검증 후 harness.lock SHA 업데이트
                         npm 배포
                                ↓
                         acorn install 시
                         원본 레포 @ 고정 SHA 직접 clone
```

### harness.lock 구조

```json
{
  "acorn_version": "1.0.0",
  "tools": {
    "omc": {
      "repo": "Yeachan-Heo/oh-my-claudecode",
      "commit": "abc1234",
      "verified_at": "2026-04-13"
    },
    "gstack": {
      "repo": "garrytan/gstack",
      "commit": "def5678",
      "verified_at": "2026-04-13"
    },
    "ecc": {
      "repo": "affaan-m/everything-claude-code",
      "commit": "ghi9012",
      "verified_at": "2026-04-13"
    }
  },
  "guard": {
    "mode": "block",
    "patterns": "strict"
  }
}
```

### registry.json 구조

```json
{
  "skills": {
    "/plan": {
      "winner": "gstack",
      "losers": ["omc", "ecc"],
      "reason": "pipeline_structure",
      "locked_at": "2026-04-13"
    },
    "/review": {
      "winner": "ecc",
      "losers": ["gstack", "omc"],
      "reason": "language_coverage",
      "locked_at": "2026-04-13"
    }
  },
  "uncontested": [
    { "name": "/wiki",        "owner": "omc"    },
    { "name": "/guard",       "owner": "gstack" },
    { "name": "/agentshield", "owner": "ecc"    }
  ]
}
```

---

## 7. guard 시스템

### 작동 원리

Claude Code `PreToolUse` 훅으로 Bash 툴 실행을 인터셉트한다.

**✅ 검증**: OMC autopilot 서브에이전트(executor)까지 발화 확인.
**✅ 검증**: 최신 Claude Code는 stdin으로 JSON 페이로드 전달 (환경변수 아님).
**✅ 검증**: `readFileSync(0, 'utf8')` (fd 0) 방식이 Windows/Linux/macOS 모두 정상 작동.
**⚠️ 교훈**: `/dev/stdin` 하드코딩은 Windows Git Bash에서 path translation으로 깨짐 → fail-open 발생. 프로덕션 guard로서 치명적 결함. fd 0 방식으로 확정.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/skills/harness/hooks/guard-check.sh"
          }
        ]
      }
    ]
  }
}
```

### 훅 스크립트 최종본 (크로스 플랫폼 + fail-close)

```bash
#!/bin/bash
# ~/.claude/skills/harness/hooks/guard-check.sh
# 크로스 플랫폼: Windows(Git Bash) / macOS / Linux
# 원칙: 파싱 실패 시 fail-close (BLOCKED)

parse_command() {
  if command -v jq &> /dev/null; then
    jq -r '.tool_input.command // empty'
  else
    # fd 0 직접 지정 — /dev/stdin 대신 사용 (Windows 호환)
    node -e "
      try {
        const d = require('fs').readFileSync(0, 'utf8');
        console.log(JSON.parse(d).tool_input?.command || '');
      } catch(e) {
        process.stderr.write('[acorn-guard] parse error: ' + e.message + '\n');
        process.exit(1);  // fail-close
      }
    "
  fi
}

COMMAND=$(parse_command)
PARSE_EXIT=$?

# 파싱 자체가 실패하면 차단 (fail-close)
if [ $PARSE_EXIT -ne 0 ]; then
  echo "[acorn-guard] ⚠️  페이로드 파싱 실패 — 안전을 위해 차단합니다." >&2
  exit 1
fi

# 빈 커맨드는 통과
[ -z "$COMMAND" ] && exit 0

# 패턴 매칭 (harness.lock의 guard.patterns 기준)
case "$COMMAND" in
  *"rm -rf"*|*"DROP TABLE"*|*"force-push"*|*"reset --hard"*|*"chmod 777"*)
    echo "[acorn-guard] ⚠️  위험 커맨드 차단: $COMMAND" >&2
    exit 1
    ;;
esac

exit 0
```

### 블로킹 강도 레벨

| mode | 동작 |
|---|---|
| `block` | 감지 시 실행 중단 + 사용자 확인 요청 (기본값) |
| `warn` | 경고 표시 후 실행 계속 |
| `log` | 로그만 기록, 실행 무관 |

| patterns | 차단 대상 |
|---|---|
| `strict` | `rm -rf`, `DROP TABLE`, `force-push`, `git reset --hard`, `chmod 777` |
| `moderate` | strict에서 `git reset --hard`, `chmod` 제외 |
| `minimal` | `rm -rf`, `DROP TABLE`만 |

시작값: `block + strict`. 코드 수정 없이 설정 변경만으로 완화 가능.

---

## 8. CLI 인터페이스

### 사용자 전용 커맨드

```bash
# 설치
acorn install              # 전역 설치 (기본)
acorn install --repo .     # 현재 레포에만

# 상태
acorn status               # 현재 상태 요약
acorn list                 # 활성 스킬 전체 목록

# guard 설정
acorn config guard.mode block      # block | warn | log
acorn config guard.patterns strict # strict | moderate | minimal

# 제거
acorn uninstall                    # 전체 제거
acorn uninstall --tool gstack      # 특정 툴만
```

### 인터랙티브 확인 등급

**등급 1 — 확인 불필요** (읽기 전용)
```
acorn status / acorn list
```

**등급 2 — 컨텍스트 요약 후 Y/n** (쓰기, 가역적)
```bash
acorn install --repo .

📁 적용 대상: /Users/dotori/my-project (이 레포만)
   전역 설정은 변경되지 않습니다.

   설치될 툴:
   - oh-my-claudecode @ abc1234
   - gstack           @ def5678
   - everything-claude-code @ ghi9012

   환경변수 추가 예정 (~/.zshrc):
   - CLAUDE_PLUGIN_ROOT, OMC_PLUGIN_ROOT, ECC_ROOT

계속할까요? (Y/n) ›
```

**등급 3 — 내용 명시 + 타이핑 확인** (비가역적)
```bash
acorn uninstall --tool gstack

⚠️  gstack을 제거합니다.

   삭제될 항목:
   - ~/.claude/skills/gstack (심링크)
   - ~/.claude/skills/harness/vendors/gstack/

   ⚡ 영향: /plan, /qa, /ship, /document-release 비활성화
      대체 툴 없음.

   백업본 발견: harness/backup/gstack-20260412/
   (제거 후 복원 여부를 별도로 묻습니다)

확인하려면 'gstack' 을 입력하세요 ›
```

숙련 사용자 / CI: `--yes` 플래그로 확인 스킵.

### acorn status 출력 예시

```
┌─────────────────────────────────────────────┐
│ acorn v1.0.0  •  global                     │
├─────────────────────────────────────────────┤
│ OMC      abc1234  ✅  locked                │
│ gstack   def5678  ✅  locked  (symlinked)   │
│ ECC      ghi9012  ✅  locked                │
├─────────────────────────────────────────────┤
│ guard    block + strict  ✅                 │
│ conflicts resolved: 7 skills                │
│ env: CLAUDE_PLUGIN_ROOT ✅                  │
│      OMC_PLUGIN_ROOT    ✅                  │
│      ECC_ROOT           ✅                  │
└─────────────────────────────────────────────┘
```

---

## 9. dotori 전용 커맨드 (`acorn dev`)

빌드 타임에 배포판에서 제거. dotori 개발 레포에서만 접근 가능.

```bash
acorn dev check                  # 세 툴 upstream diff 전체 확인
acorn dev check --tool gstack    # 특정 툴만
acorn dev diff /review           # 특정 스킬 변경 내용 상세
acorn dev lock                   # 현재 fork 커밋으로 harness.lock 업데이트
acorn dev validate               # 충돌 테이블 일관성 검사
acorn dev release                # npm 배포 준비 (changelog 자동 생성)
```

### dotori 매일 워크플로우

```
Claude Code 실행
    ↓
"오늘 업데이트 해야할 부분이 있는지 확인해줘"
    ↓
acorn dev check 자동 실행 → upstream diff 리포트
    ↓
dotori 검토 및 판단
    ↓
acorn dev lock → harness.lock SHA 업데이트
    ↓
acorn dev release → npm 배포
    ↓
사용자: npm update @dotoricode/acorn
```

---

## 10. 스킬 레지스트리 diff 알고리즘

```bash
git diff <locked_commit>..<upstream/HEAD> -- skills/*/SKILL.md
```

| 버킷 | 정의 | 처리 |
|---|---|---|
| **ADDED** | 새 스킬 | 동일 이름 없으면 uncontested 후보 / 있으면 dotori 판단 |
| **MODIFIED** | 기존 스킬 변경 | uncontested면 자동 반영 후보 / contested면 dotori 재검토 |
| **DELETED** | 스킬 제거 | 즉시 경고, 대체 툴 없으면 공백 발생 안내 |

v1.0.0에서 자동 승자 판정 없음. 신규 충돌은 항상 dotori가 직접 결정.

---

## 11. 기술 스택

```
CLI 코어 로직          → TypeScript + Node.js LTS
훅 스크립트            → bash + fd 0 방식 Node.js (jq 있으면 우선)
lock file / 레지스트리 → JSON
패키지 배포            → npm (@dotoricode/acorn)
```

`npx @dotoricode/acorn install` 단일 명령 설치 지원.
단일 바이너리 필요 시 CLI 레이어만 Go로 교체하는 옵션 열어둠.

---

## 12. ADR (Architecture Decision Records)

### ADR-001: 격리 위치 선택
**결정**: `~/.claude/skills/harness/vendors/` 하위에 실제 파일 설치  
**이유**: Claude Code 기존 구조 활용, 업데이트 충돌 최소화

### ADR-002: 업데이트 매니저 분리
**결정**: `acorn dev` 서브커맨드, 빌드 타임에 배포판에서 제거  
**이유**: 단일 책임 — 복구하는 것과 보호하는 것을 분리

### ADR-003: 툴별 경로 처리 방식 ✅ 검증 완료
- **gstack** → 디렉토리 심링크 (`~/.claude/skills/gstack/ → vendors/gstack/`)
- **OMC** → 환경변수 주입 (`CLAUDE_PLUGIN_ROOT`, `OMC_PLUGIN_ROOT`)
- **ECC** → 환경변수 주입 (`CLAUDE_PLUGIN_ROOT`, `ECC_ROOT`)

### ADR-004: guard 블로킹 강도 설계
**결정**: `mode` × `patterns` 조합, 시작값 `block + strict`  
**조정**: 설정 변경만으로 완화, 코드 수정 불필요

### ADR-005: 기술 스택
**결정**: TypeScript + Node.js LTS (CLI 코어) + bash (훅 스크립트)  
**제외**: Bun (인수 후 불확실성), Deno (사용자 기반 낮음)

### ADR-006: 사용자 / dotori 커맨드 분리
**결정**: `acorn dev` 빌드 타임 제거, 사용자는 `npm update`로만 최신판 수령

### ADR-007: 배포 방식
**결정**: 원본 레포 @ 고정 SHA 직접 clone  
**라이선스**: OMC(MIT) ✅ / gstack(MIT) ✅ / ECC(MIT) ✅

### ADR-008: 훅 스크립트 stdin 파싱 ✅ 검증 완료
**결정**: stdin JSON 파싱, `readFileSync(0, 'utf8')` (fd 0) 방식  
**원칙**: fail-close — 파싱 실패 시 BLOCKED  
**교훈**: `/dev/stdin` 하드코딩은 Windows Git Bash에서 fail-open 발생 확인 → fd 0로 확정  
**jq**: 설치 시 우선 사용, 미설치 시 Node.js 폴백 (fd 0 방식)

### ADR-009: 환경변수 shell profile 주입
**결정**: 감지된 shell profile에 추가, uninstall 시 정확히 제거  
**안전장치**: 등급 2 확인 후 진행

### ADR-010: omc-learned / learned/ 격리 정책
**결정**: v1.0.0에서 완전히 건드리지 않음  
**근거**: dotori 환경에 해당 디렉토리 미존재 확인. 사용자 환경에 존재하더라도  
acorn은 해당 경로를 읽거나 수정하지 않는다. 필요 시 v1.1.0에서 정책 결정.

---

## 13. 검증 현황

| 항목 | 상태 | 결과 |
|---|---|---|
| hooks API 서브에이전트 발화 여부 | ✅ 완료 | 서브에이전트까지 발화 확인 |
| 훅 페이로드 전달 방식 | ✅ 완료 | stdin JSON (환경변수 아님) |
| gstack 절대경로 하드코딩 | ✅ 완료 | 다수 확인, 디렉토리 심링크 필요 |
| OMC 경로 참조 방식 | ✅ 완료 | 환경변수 기반, 심링크 불필요 |
| ECC 경로 참조 방식 | ✅ 완료 | 환경변수 기반, 심링크 불필요 |
| jq 미설치 Node.js 폴백 | ✅ 완료 | fd 0 방식으로 크로스 플랫폼 정상 작동 확인 |
| /dev/stdin Windows 호환성 | ✅ 완료 | 비호환 확인 → fd 0 방식으로 확정 |
| omc-learned / learned/ 존재 여부 | ✅ 완료 | 미존재 확인, v1.0.0 무시 확정 |

**미결 사항: 없음**

---

## 14. 다음 단계

모든 미결 질문이 해소됐습니다. 설계 단계에서 구현 단계로 진입 가능합니다.

권장 구현 순서:

1. **프로젝트 초기화** — `@dotoricode/acorn` npm 패키지, TypeScript + Node.js LTS 세팅
2. **guard-check.sh 구현** — 설계 확정된 훅 스크립트부터 시작 (가장 작고 명확)
3. **acorn install 핵심 플로우** — harness.lock 파싱 → clone → gstack 심링크 → 환경변수 주입
4. **acorn status / list** — 현재 상태 파악 커맨드
5. **acorn uninstall** — 심링크 제거 + 환경변수 정리 + 백업 복원
6. **acorn dev check** — dotori 전용, upstream diff 리포트
7. **빌드 분리** — acorn dev를 배포판에서 제거하는 빌드 파이프라인

---

*최종 업데이트: 2026-04-13*  
*상태: ✅ 설계 완료 — 구현 착수 가능*
