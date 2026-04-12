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
- [x] `acorn dev sync` — Windows/Mac 환경 동기화 (dotori 전용)
- [x] gstack setup 자동화 (머신별 1회, setup-mac.sh 포함)

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
| **플래닝** | `ralplan` (인터뷰+실행 통합) | `office-hours → plan-ceo-review → plan-eng-review` 파이프라인 | architect agent | **gstack** | 스킬 간 아웃풋 체이닝 구조가 가장 체계적 |
| **코드 리뷰** | `/review` (일반) | `/review` (production bug 탐지) | 언어별 전문 리뷰어 (10개 언어) | **ECC** | 언어별 세분화 수준 압도적 |
| **QA** | `/ultraqa` (자율 루프) | `/qa` (real Chromium) | QA agents | **gstack** | 유일한 실브라우저 QA |
| **병렬 실행** | autopilot/ralph/ultrawork/team | Conductor | parallel workers | **OMC** | 스마트 모델 라우팅, 토큰 30~50% 절감 |
| **보안 감사** | `/security-review` | `/cso` | AgentShield | **ECC** | CVE 대응, 샌드박싱, 공격 벡터 분석 |
| **문서화** | 없음 | `/document-release` | doc 스킬 | **gstack** | `/ship` 시 자동 최신화 |
| **배포** | 기본 | `/ship`, `/land-and-deploy`, `/canary` | deployment skills | **gstack** | canary 배포, 검증 파이프라인화 |

### 🟡 가드레일 — 레이어가 달라 공존

| 툴 | 레이어 | 역할 |
|---|---|---|
| **gstack** `/careful`, `/freeze`, `/guard` | 런타임 인터랙티브 | 위험 커맨드 실행 전 사용자 확인 |
| **ECC** TypeScript guardrail engine (R01~R13) | 컴파일 타임 규칙 | 훅 레벨에서 정적 규칙 강제 |

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

### 실제 디렉토리 구조 (검증 완료)

#### Windows (집)
```
C:\Users\SMILE\.claude\          → D:\.claude\  (심링크)
D:\.claude\
├── skills/
│   ├── harness/                 → D:\dotoricode\dotfiles\claude\harness\  (심링크)
│   │   ├── vendors/             ← 로컬 전용 (gitignore)
│   │   │   ├── gstack/          ← gstack 실제 파일 (SHA: c6e6a21)
│   │   │   ├── omc/             ← OMC 실제 파일 (SHA: 04655ee)
│   │   │   └── ecc/             ← ECC 실제 파일 (SHA: 125d5e6)
│   │   ├── backup/              ← 로컬 전용 (gitignore)
│   │   ├── harness.lock         ← dotfiles 레포로 동기화
│   │   ├── registry.json        ← dotfiles 레포로 동기화
│   │   └── hooks/
│   │       └── guard-check.sh   ← dotfiles 레포로 동기화
│   ├── gstack/                  → D:\.claude\skills\harness\vendors\gstack  (심링크)
│   ├── office-hours/            ← gstack setup이 생성한 스킬 심링크들
│   ├── qa/
│   ├── ship/
│   └── ... (37개 gstack 스킬)
└── settings.json                ← guard 훅 등록, 환경변수 설정

D:\dotoricode\
├── acorn\                       ← 개발 코드 (github.com/dotoricode/acorn)
│   ├── docs\
│   │   └── acorn-v1-plan.md
│   └── src\
└── dotfiles\                    ← 설정 동기화 (github.com/dotoricode/dotfiles)
    └── claude\
        └── harness\             ← 실제 파일 위치 (심링크 대상)
            ├── harness.lock
            ├── registry.json
            └── hooks\
                └── guard-check.sh
```

#### Mac (회사)
```
~/.claude/                       ← Claude Code 기본 경로
├── skills/
│   ├── harness/                 → ~/dotoricode/dotfiles/claude/harness/  (심링크)
│   │   ├── vendors/             ← 로컬 전용 (gitignore)
│   │   │   ├── gstack/
│   │   │   ├── omc/
│   │   │   └── ecc/
│   │   ├── backup/
│   │   ├── harness.lock
│   │   ├── registry.json
│   │   └── hooks/
│   │       └── guard-check.sh
│   └── gstack/                  → ~/.claude/skills/harness/vendors/gstack  (심링크)
└── settings.json

~/dotoricode/
├── acorn/
└── dotfiles/
    └── claude/
        └── harness/
```

### 툴별 경로 처리 방식 ✅ 테스트 검증 완료

| 툴 | 판정 | 본체 경로 참조 방식 | acorn 처리 |
|---|---|---|---|
| **gstack** | ⚠️ | `~/.claude/skills/gstack/` 하드코딩 다수 | 디렉토리 심링크 필수 |
| **OMC** | ✅ | `${CLAUDE_PLUGIN_ROOT}` 환경변수 기반 | 환경변수 주입만으로 해결 |
| **ECC** | ✅ | `CLAUDE_PLUGIN_ROOT` → `ECC_ROOT` → auto-discover 3단 폴백 | 환경변수 주입만으로 해결 |

### 환경변수 설정 (settings.json)

```json
{
  "env": {
    "CLAUDE_PLUGIN_ROOT": "<harness_root>/vendors/omc",
    "OMC_PLUGIN_ROOT": "<harness_root>/vendors/omc",
    "ECC_ROOT": "<harness_root>/vendors/ecc"
  }
}
```

Windows 실제값: `D:\\.claude\\skills\\harness\\vendors\\omc`  
Mac 실제값: `~/.claude/skills/harness/vendors/omc`

### gstack 설치 방식 (머신별 1회)

```bash
# setup 실행 (Git Bash / Mac Terminal)
bash ~/.claude/skills/gstack/setup
# → 스킬 naming: short names 선택 (1)
# → telemetry: off 선택 (2)
# → 37개 스킬 ~/.claude/skills/ 에 심링크 생성
```

### harness.lock (현재 고정 버전)

```json
{
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

Claude Code `PreToolUse` 훅으로 Bash 툴 실행을 인터셉트한다.

**✅ 검증**: OMC autopilot 서브에이전트(executor)까지 발화 확인.  
**✅ 검증**: 최신 Claude Code는 stdin으로 JSON 페이로드 전달 (환경변수 아님).  
**✅ 검증**: `readFileSync(0, 'utf8')` (fd 0) 방식이 Windows/Linux/macOS 모두 정상 작동.  
**⚠️ 교훈**: `/dev/stdin` 하드코딩은 Windows Git Bash에서 fail-open 발생 → fd 0로 확정.

### settings.json hooks 설정

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "D:/.claude/skills/harness/hooks/guard-check.sh"
          }
        ]
      }
    ]
  }
}
```

Mac에서는 경로를 `~/.claude/skills/harness/hooks/guard-check.sh`로 변경.

### 훅 스크립트 최종본

```bash
#!/bin/bash
# hooks/guard-check.sh
# 크로스 플랫폼: Windows(Git Bash) / macOS / Linux
# 원칙: 파싱 실패 시 fail-close (BLOCKED)

parse_command() {
  if command -v jq &> /dev/null; then
    jq -r '.tool_input.command // empty'
  else
    node -e "
      try {
        const d = require('fs').readFileSync(0, 'utf8');
        console.log(JSON.parse(d).tool_input?.command || '');
      } catch(e) {
        process.stderr.write('[acorn-guard] parse error: ' + e.message + '\n');
        process.exit(1);
      }
    "
  fi
}

COMMAND=$(parse_command)
PARSE_EXIT=$?

if [ $PARSE_EXIT -ne 0 ]; then
  echo "[acorn-guard] ⚠️  페이로드 파싱 실패 — 안전을 위해 차단합니다." >&2
  exit 1
fi

[ -z "$COMMAND" ] && exit 0

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
| `block` | 감지 시 실행 중단 (기본값) |
| `warn` | 경고 표시 후 실행 계속 |
| `log` | 로그만 기록 |

| patterns | 차단 대상 |
|---|---|
| `strict` | `rm -rf`, `DROP TABLE`, `force-push`, `git reset --hard`, `chmod 777` |
| `moderate` | strict에서 `git reset --hard`, `chmod` 제외 |
| `minimal` | `rm -rf`, `DROP TABLE`만 |

---

## 8. CLI 인터페이스

### 사용자 전용 커맨드

```bash
acorn install
acorn install --repo .
acorn status
acorn list
acorn config guard.mode <block|warn|log>
acorn config guard.patterns <strict|moderate|minimal>
acorn uninstall
acorn uninstall --tool <name>
```

### 인터랙티브 확인 등급

| 등급 | 조건 | 방식 |
|---|---|---|
| 1 | 읽기 전용 | 확인 없음 |
| 2 | 쓰기, 가역적 | Y/n |
| 3 | 비가역적 | 텍스트 타이핑 |

`--yes` 플래그로 CI/숙련 사용자 스킵 가능.

### acorn status 출력

```
┌─────────────────────────────────────────────┐
│ acorn v1.0.0  •  global                     │
├─────────────────────────────────────────────┤
│ OMC      04655ee  ✅  locked                │
│ gstack   c6e6a21  ✅  locked  (symlinked)   │
│ ECC      125d5e6  ✅  locked                │
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
acorn dev check                  # upstream diff 확인
acorn dev check --tool gstack    # 특정 툴만
acorn dev diff /review           # 특정 스킬 변경 상세
acorn dev lock                   # harness.lock SHA 업데이트
acorn dev validate               # 충돌 테이블 일관성 검사
acorn dev release                # npm 배포 준비
acorn dev sync --push            # 퇴근 전: 코드 + 설정 push
acorn dev sync --pull            # 출근 후: 코드 + 설정 pull
```

### acorn dev sync 상세

```bash
# --push (퇴근 전 실행)
cd <acorn_root> && git push
cd <dotfiles_root> && git push

# --pull (출근 후 실행)
cd <acorn_root> && git pull
cd <dotfiles_root> && git pull
# harness 심링크로 자동 반영됨
# vendors 변경 있으면 acorn install 안내
```

---

## 10. Windows / Mac 환경 동기화

### 개발 환경 구성

```
집 (Windows)   : 퇴근 후 ~ 출근 전
회사 (Mac)     : 출근 ~ 퇴근
```

### 동기화 흐름

```
[퇴근 전 — Mac]
acorn dev sync --push
  └── acorn git push
  └── dotfiles git push

[집에서 — Windows]
acorn dev sync --pull
  └── acorn git pull
  └── dotfiles git pull (harness 심링크로 자동 반영)
... 작업 ...
acorn dev sync --push

[출근 후 — Mac]
acorn dev sync --pull
  └── acorn git pull
  └── dotfiles git pull
```

### 동기화 대상 / 비대상

| 항목 | 동기화 | 방법 |
|---|---|---|
| acorn 소스 코드 | ✅ | git (dotoricode/acorn) |
| harness.lock | ✅ | git (dotoricode/dotfiles) |
| registry.json | ✅ | git (dotoricode/dotfiles) |
| guard-check.sh | ✅ | git (dotoricode/dotfiles) |
| vendors/ (툴 파일) | ❌ | 머신별 acorn install |
| backup/ | ❌ | 로컬 전용 |
| gstack 스킬 심링크 | ❌ | 머신별 gstack setup |
| settings.json | ❌ | 머신별 수동 (경로가 OS별로 다름) |

### Mac 초기 세팅 (setup-mac.sh)

```bash
#!/bin/bash
set -e

echo "🌰 acorn 개발 환경 세팅 시작..."

# 1. 레포 클론
mkdir -p ~/dotoricode
cd ~/dotoricode
[ -d "acorn" ] || git clone https://github.com/dotoricode/acorn
[ -d "dotfiles" ] || git clone https://github.com/dotoricode/dotfiles

# 2. harness 심링크 연결
mkdir -p ~/.claude/skills
if [ -L ~/.claude/skills/harness ]; then
    echo "   harness 이미 연결됨, 스킵"
elif [ -d ~/.claude/skills/harness ]; then
    mv ~/.claude/skills/harness ~/.claude/skills/harness-backup
    ln -s ~/dotoricode/dotfiles/claude/harness ~/.claude/skills/harness
else
    ln -s ~/dotoricode/dotfiles/claude/harness ~/.claude/skills/harness
fi

# 3. vendors 디렉토리 생성
mkdir -p ~/dotoricode/dotfiles/claude/harness/vendors/gstack
mkdir -p ~/dotoricode/dotfiles/claude/harness/vendors/omc
mkdir -p ~/dotoricode/dotfiles/claude/harness/vendors/ecc
mkdir -p ~/dotoricode/dotfiles/claude/harness/backup

# 4. harness.lock SHA로 gstack 설치
GSTACK_SHA=$(python3 -c "import sys,json; print(json.load(open('$HOME/dotoricode/dotfiles/claude/harness/harness.lock'))['tools']['gstack']['commit'])")
if [ -z "$(ls -A ~/dotoricode/dotfiles/claude/harness/vendors/gstack)" ]; then
    git clone https://github.com/garrytan/gstack /tmp/gstack-tmp
    cd /tmp/gstack-tmp && git checkout $GSTACK_SHA
    cp -r /tmp/gstack-tmp/. ~/dotoricode/dotfiles/claude/harness/vendors/gstack/
    rm -rf /tmp/gstack-tmp
    echo "   gstack @ $GSTACK_SHA 설치 완료"
fi

# 5. gstack 심링크
[ -L ~/.claude/skills/gstack ] || \
    ln -s ~/dotoricode/dotfiles/claude/harness/vendors/gstack ~/.claude/skills/gstack

# 6. gstack setup 실행
bash ~/.claude/skills/gstack/setup

# 7. acorn 의존성 설치
cd ~/dotoricode/acorn && npm install

# 8. settings.json 생성 안내
echo ""
echo "⚠️  settings.json 수동 설정 필요:"
echo "   ~/.claude/settings.json 에 아래 내용 추가:"
echo '   "env": {'
echo '     "CLAUDE_PLUGIN_ROOT": "'"$HOME"'/.claude/skills/harness/vendors/omc",'
echo '     "OMC_PLUGIN_ROOT": "'"$HOME"'/.claude/skills/harness/vendors/omc",'
echo '     "ECC_ROOT": "'"$HOME"'/.claude/skills/harness/vendors/ecc"'
echo '   }'

echo ""
echo "✅ 세팅 완료! Claude Code를 ~/dotoricode/acorn 에서 실행하세요."
```

---

## 11. 스킬 레지스트리 diff 알고리즘

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

## 12. 기술 스택

```
CLI 코어 로직          → TypeScript + Node.js LTS
훅 스크립트            → bash + fd 0 방식 Node.js (jq 있으면 우선)
lock file / 레지스트리 → JSON
패키지 배포            → npm (@dotoricode/acorn)
```

---

## 13. ADR (Architecture Decision Records)

### ADR-001: 격리 위치
**결정**: `~/.claude/skills/harness/vendors/` 하위  
**이유**: Claude Code 기존 구조 활용, 업데이트 충돌 최소화

### ADR-002: 업데이트 매니저 분리
**결정**: `acorn dev` 서브커맨드, 빌드 타임 배포판 제거  
**이유**: 단일 책임 원칙

### ADR-003: 툴별 경로 처리 ✅ 검증 완료
- **gstack** → 디렉토리 심링크 (절대경로 하드코딩 대응)
- **OMC** → 환경변수 주입
- **ECC** → 환경변수 주입

### ADR-004: guard 블로킹 강도
**결정**: `mode` × `patterns` 조합, 시작값 `block + strict`

### ADR-005: 기술 스택
**결정**: TypeScript + Node.js LTS + bash  
**제외**: Bun (인수 후 불확실성), Deno (사용자 기반 낮음)

### ADR-006: 사용자 / dotori 커맨드 분리
**결정**: `acorn dev` 빌드 타임 제거

### ADR-007: 배포 방식
**결정**: 원본 레포 @ 고정 SHA 직접 clone  
**라이선스**: OMC(MIT) ✅ / gstack(MIT) ✅ / ECC(MIT) ✅

### ADR-008: 훅 스크립트 stdin 파싱 ✅ 검증 완료
**결정**: fd 0 방식, fail-close 원칙  
**교훈**: `/dev/stdin`은 Windows Git Bash에서 fail-open 발생

### ADR-009: 환경변수 설정 위치
**결정**: settings.json `env` 섹션 (shell profile 아님)  
**이유**: OS별 경로가 달라 머신별 수동 설정이 현실적. shell profile 자동화는 v1.1.0.

### ADR-010: omc-learned / learned/ 격리
**결정**: v1.0.0 무시  
**근거**: dotori 환경 미존재 확인

### ADR-011: dotfiles 레포 분리
**결정**: `dotoricode/dotfiles` 별도 레포로 harness 설정 관리  
**이유**: acorn 코드와 설정 파일 성격이 달라 분리 관리

### ADR-012: settings.json 동기화 제외
**결정**: settings.json은 dotfiles 동기화 대상에서 제외, 머신별 수동 설정  
**이유**: Windows/Mac 경로 형식이 달라 동일 파일 사용 불가  
**향후**: v1.1.0에서 OS 감지 후 자동 생성 기능 추가 검토

### ADR-013: gstack을 acorn 개발 도구로 선택
**결정**: acorn v1.0.0 개발에 gstack 단독 사용  
**이유**: 파일시스템 조작이 많은 특성 → `/guard`, `/freeze` 필수. 단독 개발자 → OMC 멀티에이전트 오버킬. 기획안 → 코드 전환에 `office-hours → plan-eng-review` 파이프라인 최적.  
**acorn 완성 후**: acorn 자체로 환경 구축하여 차기 개발 진행

---

## 14. 검증 현황

| 항목 | 상태 | 결과 |
|---|---|---|
| hooks API 서브에이전트 발화 여부 | ✅ 완료 | 서브에이전트까지 발화 확인 |
| 훅 페이로드 전달 방식 | ✅ 완료 | stdin JSON (환경변수 아님) |
| gstack 절대경로 하드코딩 | ✅ 완료 | 다수 확인, 디렉토리 심링크 필요 |
| OMC 경로 참조 방식 | ✅ 완료 | 환경변수 기반 |
| ECC 경로 참조 방식 | ✅ 완료 | 환경변수 기반 |
| jq 미설치 Node.js 폴백 | ✅ 완료 | fd 0 방식 크로스 플랫폼 확인 |
| /dev/stdin Windows 호환성 | ✅ 완료 | 비호환 → fd 0 확정 |
| omc-learned / learned/ 존재 여부 | ✅ 완료 | 미존재 확인 |
| Windows 환경 구축 | ✅ 완료 | 심링크, harness, gstack setup 완료 |
| Mac 환경 구축 | 🔲 미완료 | 내일 출근 후 setup-mac.sh 실행 |

**미결 사항: 없음**

---

## 15. 환경 구축 현황

### Windows (집) ✅ 완료

```
C:\Users\SMILE\.claude\  →  D:\.claude\  (심링크)
D:\.claude\skills\harness\  →  D:\dotoricode\dotfiles\claude\harness\  (심링크)
D:\.claude\skills\gstack\   →  vendors\gstack\  (심링크)
gstack setup 완료 (short names, telemetry off)
harness.lock SHA 고정 완료
```

### Mac (회사) 🔲 내일 실행

```bash
bash ~/dotoricode/dotfiles/setup-mac.sh
```

---

## 16. 구현 순서 (Claude Code + gstack)

### 개발 도구

acorn v1.0.0 개발은 **gstack** 기반으로 진행한다.

```
/guard      위험 작업 전 활성화
/freeze     src/ 외 수정 방지
/checkpoint 진행 상황 저장
/review     코드 리뷰
/ship       커밋
```

### 스프린트 단위 구현 순서

각 스프린트는 파일 1~2개. 컨텍스트 70% 시 /checkpoint.

```
Sprint 1: hooks/guard-check.sh
Sprint 2: src/core/lock.ts
Sprint 3: src/core/registry.ts
Sprint 4: src/core/symlink.ts
Sprint 5: src/core/env.ts
Sprint 6: src/commands/install.ts
Sprint 7: src/commands/status.ts + src/commands/list.ts
Sprint 8: src/commands/uninstall.ts
Sprint 9: src/commands/config.ts
Sprint 10: src/dev/check.ts
Sprint 11: src/dev/sync.ts
Sprint 12: src/index.ts (CLI 진입점 연결)
Sprint 13: tsconfig.build.json (acorn dev 빌드 분리)
```

### 첫 시작 프롬프트 (Claude Code에서)

```
docs/acorn-v1-plan.md 를 읽어줘.

오늘 밤 목표는 하나야: hooks/guard-check.sh 완성.

/guard 활성화해줘.

docs/acorn-v1-plan.md 의 섹션 7 기준으로 구현해줘:
- stdin JSON 파싱 (readFileSync fd 0, /dev/stdin 절대 금지)
- jq 우선, 미설치 시 Node.js 폴백
- fail-close 원칙
- block + strict 기본값
- 크로스 플랫폼 필수

완성 후: /review → /ship → /checkpoint
컨텍스트 70% 넘으면 즉시 /checkpoint 저장 후 멈춰줘.
```

---

*최종 업데이트: 2026-04-13*  
*상태: ✅ 환경 구축 완료 (Windows) — 구현 착수 가능*
