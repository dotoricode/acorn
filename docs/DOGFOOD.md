# Dogfooding acorn v0.1.0

> 실사용 관찰 로그. v0.1.1 / v0.2.0 우선순위 결정의 근거가 된다.
> 1~2주 간 실 2머신에서 굴리며 감각을 수집한다.

---

## Round 2 기록 (종료 2026-04-17, Windows 집 머신)

**환경**: Windows 10, `D:\.claude\skills\harness\`, Git Bash, acorn v0.1.1, jq 설치됨
**결과**: v0.1.0 설계가 Windows 실환경에서 **blocker 없이 전면 작동**. v0.1.2 hotfix 감 없음. v0.2.0 큐는 5건으로 확정 (이 라운드 신규 발견 2건 포함).
**종료 기준 충족**: 메모 11건 (10건+ 기준선 통과)
**dreport 최종 (2026-04-17 13:38)**: 실행 38회 · exit=0 19 / exit=1 18 / exit=78 1 · 메모 11건 (bug 3, ux 5, idea 3)

### 시나리오 결과

| 단계 | 결과 | 비고 |
|---|---|---|
| D-0 status/doctor | ✅ | locked 3, env match 3. gstack `.agents/` 외 SKILL.md 등 dirty warning 계속 노출 (Round 1부터 이어진 상태) |
| D-1 install 멱등성 | ✅ | vendors noop × 3, 심링크 noop, settings noop |
| D-2 심링크 수동 파괴 → 재install | ✅ | `rm /d/.claude/skills/gstack` 후 status 에 `gstack link ⚠️ absent`, install 로 `created:` 재생성. **Windows junction 재생성 실증** |
| D-3 settings 충돌 | ✅ | `CLAUDE_PLUGIN_ROOT` 값을 `...\vendors\omc` 로 변조 → exit=78 CONFLICT, 파일 무변경, 메시지에 `현재=/기대=` 양값 정확 표기 |
| D-4 tx.log IN_PROGRESS (SIGINT) | ❌ 재현 실패 | 네트워크 없는 멱등 install 은 <300ms 에 완료되어 `sleep 0.3 && kill -INT`가 닿기 전에 프로세스 종료. 통합 테스트(`tx.test.ts`)로 동작 검증됨 — 실사용 환경에서 재현 불가 = 사실상 안전 |
| S3 심링크 파괴 → `doctor --json` | ✅ | `issues[0]: {area:"symlink", severity:"critical", message:"심링크 부재", hint:"acorn install 재실행"}` 완벽 구조화. `gstackSymlink.status="absent"` + `currentLink:null`. install 1회로 복구 |
| S4 vendor drift | ✅ (기능) / 🟡 (UX) | lock SHA 한 글자 변조 → `state="drift"`, `ok=false` 정확 감지. dirty 없는 omc 에서 checkout 실패 시 git 에러 메시지 펼쳐줌 양호. **but**: ① short SHA 7자만 보여줘 `lock=<sha>/실제=<sha>` 가 같아 보이는 착시 ② checkout 실패 hint 가 `git fsck` 제안하는데 실 원인은 보통 fetch 누락/SHA 오타 (v0.2.0 큐로) |
| S9 CI 게이트 (`jq -e '.ok'`) | ✅ | `doctor --json \| jq -e '.ok'` 로 exit gate OK. severity-aware 필터도 `jq '[.issues[] \| select(.severity=="critical")] \| length'` 한 줄. 실 CI 패턴 바로 붙여쓰기 가능 |
| S7 Guard 훅 실전 (Claude Code UI) | ⏸ 별도 세션 | PreToolUse 훅을 Claude Code UI 에서 관찰하는 시나리오라 bash tool 범위 밖. 아래 "§ S7 recipe" 로 이관, 자연 사용 중 한 번 돌리고 `dn` 메모 1줄 남기면 됨 |

### 긍정 관찰 (Windows 실증)

- ✅ **Windows junction 수동 삭제 후 자동 복구** — `symlink.ts` 의 junction 분기가 실전에서도 동작. Round 1 (Mac symlink) 과 동등한 UX
- ✅ **SETTINGS_CONFLICT 메시지 품질** — 현재값/기대값을 양쪽 다 찍어줘서 사용자가 diff 바로 판단 가능
- ✅ **비파괴 preflight** — D-3, S4 모두 acorn 중단 후 대상 파일 timestamp/내용 보존
- ✅ **`doctor --json` 스키마가 CI 바로 붙여쓰기 가능** — `.ok` / `.issues[].severity` / `.issues[].hint` / `.gstackSymlink.status` / `.tools.<name>.state` 모두 jq 필터 한 줄로 소비됨 (S3/S9/S4)
- ✅ **dirty tree 보호가 drift checkout 앞에 선다** — S4 에서 gstack (dirty) drift 시 checkout 거부. 데이터 손실 방지 설계가 실제로 블록
- ✅ **adog/dn/dreport 파이프라인** — Windows Git Bash 에서 Mac 과 동일하게 작동, 로그 위치 `/c/Users/SMILE/acorn-dogfood.log`

### 후속 미니 수정 (Round 2 도중 발견 · 같은 세션에서 조치)

1. **`src/index.ts` VERSION 동기화 누락** — `package.json` 은 `b3c7668` 에서 0.1.1 로 올렸는데 `src/index.ts` 의 `VERSION` 상수와 `package-lock.json` 이 0.1.0 으로 남아있었음. *(본 세션 커밋 `625fefd`)*
2. **ESM `isMain` 감지가 Windows npm link 환경에서 실패 가능** — 기존 문자열 비교 → `realpathSync` + `pathToFileURL` 정규화로 교체. *(본 세션 커밋 `625fefd`)*

### v0.1.2-hotfix 큐

- **없음** — Round 2 전 시나리오 blocker 없이 통과. hotfix 감이면 즉시 고쳤을 건데 아무것도 안 걸림. 이 자체가 v0.1.0/0.1.1 설계·구현 검증됐다는 긍정 신호.

### v0.2.0 큐 최종 우선순위 (Round 2 종료 시점)

| # | 항목 | 크기 | 근거 |
|---|---|---|---|
| **S1** | `doctor --json` severity summary 필드 (`.summary: {critical, warning, info}` + `.okCritical`) | 소 | S9 실증에서 즉각 CI 가치. schema 확장만, 1-2h. **v0.2.0 warm-up.** |
| S2 | drift/SHA 표시 개선 (short SHA 충돌 시 차이 나는 위치까지 확장 + checkout 실패 hint cause 별 분기) | 소 | S4 실증. 단순 UX 개선이라 독립 commit 적합 |
| S3 | `acorn config` (`env.reset`, `guard.mode` 조작 helper) | 중 | Round 1 "jq 저글링 대신" 실증, 일상 편의성 |
| S4 | `acorn install --adopt` (기존 수동 설치 흡수) | 대 | Round 1 `NOT_A_REPO` 심링크 보호 맥락. **비파괴 원칙 설계 pressure 있음 — 별도 설계 문서 필요** |
| S5 | `acorn lock` (init/validate/bump helper) | 중 | Round 1 "수동 편집 위험" (`acorn_version: "0.0.0-dev"` 사고 방지) |
| S6 | Windows `npm link` 대체 shim helper (`scripts/windows-install-shim.bat` or npm postinstall hook) + README 안내 | 소 | Round 2 실증. **다른 Windows 머신에서 재현 확인 후 우선순위 재평가** |
| S7 | `install` 출력의 `[6/7] setup 콜백 미제공` 라인 멱등 실행 시 축약 | 소 | Round 1~2 계속 거슬림, 사소함 |
| S8 | README/HANDOVER 부트스트랩 섹션에 `jq` 설치 안내 1줄 | 극소 | Round 2 실증, docs-only |

### § S7 recipe (별도 세션 — 자연 사용 중 1회)

Claude Code UI 에서 **실제로** PreToolUse 훅이 발화하는지 확인. bash tool 로는 관찰 불가.

```jsonc
// ~/.claude-personal/settings.json 또는 $CLAUDE_CONFIG_DIR/settings.json 의 hooks 섹션
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "D:/.claude/skills/harness/hooks/guard-check.sh" }
        ]
      }
    ]
  }
}
```

관찰 포인트 (각 1줄 `dn` 메모):
- `rm -rf /tmp/foo` 시도 → Claude Code UI 에 block 메시지 표시되는가
- `git push --force-with-lease origin main` → 통과하는가 (strict 패턴에서 `--force-with-lease` 는 허용되어야 함)
- `DROP TABLE foo;` 같은 SQL → 차단되는가
- 차단 메시지에 bypass 방법이 보이는가
- **false positive**: 평소 치는 무해한 커맨드 중 차단되는 게 있는가

### 미해결 파편 (2026-04-17 종료 시점)

- **gstack vendors dirty** (`SKILL.md`, `autoplan/SKILL.md` 등) — Round 1부터 이어진 상태. `EXPECTED_DIRTY_PATHS` 가 `.agents/` 만 허용. 실 편집 여부 확인 후 원복 or 허용 경로 확장 결정 필요. **현재는 doctor warning 으로만 노출 (블록 아님)** 이라 감내 가능
- **D-4 SIGINT 재현 방법** — 네트워크 없는 install 이 너무 빠르므로 재현 불가. `tx.test.ts` 통합 테스트로 검증된 상태 → v0.2.0 이후 실패 주입 훅 도입 시 재테스트
- **Windows Junction traversal 불가** (v0.1.x 범위 밖) — Node 24.14.0 이 동일 드라이브 Junction 까지 lstat `UNKNOWN`. 원인 미확인 (libuv 버그? Windows 설정?). **현 머신 한정 이슈일 가능성** → Round 3 시 다른 Windows 머신에서 재검증

---

## Round 1 기록 — 2026-04-15 (Mac personal, ~40분)

**환경**: macOS, `CLAUDE_CONFIG_DIR=~/.claude-personal`, direnv, npm link 로 전역 acorn
**시나리오 진행**: Fresh install → SETTINGS 충돌 해소 → NOT_A_REPO 해소 → 전 녹색 → gstack `./setup` 실행
**dreport 요약**: 실행 12회 · exit=0 5회(42%) · exit=78 3회 · exit=1 4회 · 메모 3건

### v0.1.1 hotfix 큐 (실사용으로 실증된 것)

1. ~~**lock.ts BOM 처리**~~ ✅ — Windows 에디터로 lock 저장 시 UTF-8 BOM 이 `JSON.parse` 터뜨림. `parseLock` 진입부에서 `\uFEFF` 1바이트 제거 + 테스트 2건 추가 *(v0.1.1-hotfix)*
2. ~~**schema_version 필드 누락 메시지**~~ ✅ — 현재 `"기대 1, 실제 undefined"` 가 혼란. `in` 연산자로 누락을 먼저 감지해 "schema_version 필드 누락" 메시지 분리 + 테스트 1건 추가 *(v0.1.1-hotfix)*
3. ~~**SETTINGS_CONFLICT / NOT_A_REPO hint 일관성**~~ ✅ — `InstallError` 에 `hint?: string` 추가, `IN_PROGRESS` / `SETTINGS_CONFLICT` / `SETTINGS_WRITE` + vendor cause 기반 (`NOT_A_REPO`/`LOCAL_CHANGES`/`CLONE`/`CHECKOUT`/`REV_PARSE`) 별 hint 부여, `formatError` 는 `→` 로 출력, 테스트 3건 업데이트/추가 *(v0.1.1-hotfix)*
4. ~~**CLI `--run-gstack-setup` 플래그**~~ ✅ — `defaultGstackSetup` 함수 추가 (`<source>/setup --host auto` spawn, Windows 는 shell:true), `--run-gstack-setup` CLI 플래그 + `--skip-gstack-setup` 상호배타 검증, 스모크 테스트 1건 *(v0.1.1-hotfix)*
5. ~~**vendors/gstack dirty 처리**~~ ✅ — `GitRunner.getDirtyPaths` 추가 (fallback: isDirty), 툴별 `EXPECTED_DIRTY_PATHS` 상수 (`gstack: ['.agents/']`), `unexpectedDirtyPaths` prefix 필터로 install 의 LOCAL_CHANGES 판정과 doctor 의 dirty warning 동일 규칙 적용, 테스트 5건 추가 *(v0.1.1-hotfix)*

### v0.2.0 후보 (재확인된 것)

1. **기존 수동 설치 편입** — `acorn install --adopt` 로 현 env/심링크/vendors 상태를 lock 기준으로 흡수. SETTINGS_CONFLICT / NOT_A_REPO 를 파괴적 대응 없이 처리
2. **`acorn config`** — jq/zsh 저글링 대신 `acorn config env.reset` 류 helper. 사용자 수술 불필요
3. **`acorn lock` 도구** — init / validate / bump-acorn-version. 현재 lock 직접 편집 필수라 v0.1.0 도 `acorn_version: "0.0.0-dev"` 같은 사고 방지 못함
4. **partial 설치 지원** — `tools.<name>.external_path` 또는 `exclude` 로 일부 툴은 사용자 개발 레포 그대로 유지 (실제 ECC 를 `~/01_private/everything-claude-code` 로 개발 중)
5. **doctor hint 구조화** — `hint` 가 현재 평문 한 줄. `actions: [{cmd, description}]` 배열로 구조화하면 프론트엔드 자동화 가능

### 긍정 관찰 (v0.1.0 설계가 실증된 것)

- ✅ **preflight 가 실 사고 방지** — SETTINGS_CONFLICT 3회 발생, 전부 파일 무변경으로 중단
- ✅ **NOT_A_REPO 가 사용자 심링크 보호** — `vendors/ecc/everything-claude-code` (개발 레포 심링크) 를 acorn 이 함부로 덮어쓰지 않음
- ✅ **tx.log 흐름 정상** — begin/phase/abort 가 실패 시 자동 기록, 최종 pendingTx null 유지
- ✅ **doctor 가 dirty 정확 감지** — gstack `.agents/` 생성 즉시 warning
- ✅ **status --json 이 jq 로 잘 읽힘** — 실 CI 파이프라인 그대로 사용 가능
- ✅ **npm link + adog wrapper 가 자연스럽게 통합** — 평소처럼 치되 로깅은 자동

### 오답·함정 (세션 중 실수 기록)

- `{setup,install}*.sh` glob 으로 gstack setup 못 찾고 "실존 안 함" 오판정 → README 확인 후 `./setup` (확장자 없음) 발견 → 정정
- `--host claude-code` 추천은 틀림. 정답은 `--host claude` 또는 default `auto` (이미 자동감지 성공)
- `"$SETTINGS.fixed"` zsh 파라미터 확장에서 엉킴 → `${SETTINGS}.fixed` 또는 tempfile 로 회피

### 다음 라운드 준비

- Round 2 시작 조건: Round 1 로부터 3일 이상 + 자연스럽게 acorn 을 쓴 실행 로그 5건 이상 누적
- 또는: Windows (집) 머신에서 같은 시나리오 돌리기 (2머신 drift 실전)
- 가져와야 할 것: `dreport` 최신 + `git status --short` (`vendors/*` 모두) + 새로 쌓인 `dn` 메모

### 미해결 파편 (세션 종료 시점)

- `~/.claude-personal/skills/harness/vendors/gstack` 에 `connect-chrome` 파일 `D` (삭제) 상태 — gstack `./setup` 이 삭제. 원인 미조사
- gstack dirty (`.agents/*` untracked) — 현재 상태 유지, doctor 가 warning 으로 계속 표시할 것

---

## 관찰 원칙

- **상상하지 말고 쓴다** — 기능 검토가 아니라 실제 작업 흐름에서 acorn 을 꺼내 쓴다
- **정량 데이터는 자동** — 실행 기록·exit code·stderr 는 wrapper 가 알아서 저장. 아래 "자동 로거" 참고
- **정성 관찰은 수동** — "불편하다", "이상하다" 감각은 `dn` 으로 1줄 메모 (사람 판단 필요)
- **수정하지 않는다** — 버그 발견해도 v0.1.0 코드는 **건드리지 않음**. 쌓이면 v0.1.1 로 한 번에 처리
- **유일한 예외**: 실제로 하루 작업을 막는 블로커는 hotfix 브랜치에서 즉시 수정

---

## 자동 로거 (정량 수집) — 1회 셋업

`scripts/dogfood/` 에 wrapper 3종이 있다. 한 번만 alias 등록하면 이후 자동 로깅.

### Mac (zsh)

```bash
# ~/.zshrc 에 추가
export ACORN_REPO=~/01_private/acorn
alias adog="$ACORN_REPO/scripts/dogfood/wrap.sh"
alias dn="$ACORN_REPO/scripts/dogfood/note.sh"
alias dreport="$ACORN_REPO/scripts/dogfood/report.sh"
# (선택) 로그 위치 커스터마이즈
# export ACORN_DOGFOOD_LOG=~/acorn-dogfood.log
```

### Windows (Git Bash, `~/.bashrc`)

```bash
export ACORN_REPO=/d/dotoricode/acorn
alias adog="$ACORN_REPO/scripts/dogfood/wrap.sh"
alias dn="$ACORN_REPO/scripts/dogfood/note.sh"
alias dreport="$ACORN_REPO/scripts/dogfood/report.sh"
```

재로그인 또는 `source ~/.zshrc`.

### 사용법

```bash
# acorn 대신 adog 로 호출 — 실행결과는 동일, 백그라운드에서 로깅됨
adog install
adog status --json | jq .
adog doctor --force

# 이상한 걸 발견하면 1줄 메모 (라벨 선택: bug ux idea question blocker)
dn ux "status 출력에 personal/work 구분이 없어 헷갈림"
dn bug "doctor --json 의 hint 에서 줄바꿈이 리터럴 \\n 으로 찍힘"
dn idea "acorn sync 한 커맨드로 drift 수복되면 매일 씀"

# 누적 요약 — 언제든
dreport
```

출력 예 (`dreport`):
```
=== acorn 도그푸딩 요약 ===
로그: /Users/.../acorn-dogfood.log  (47 줄)
기간: 2026-04-16T09:12:03+09:00 → 2026-04-19T18:04:11+09:00
실행: 18 회,  메모: 7 건

--- 서브커맨드 실행 분포 ---
   9 status
   5 install
   3 doctor
   1 --version

--- exit code 분포 ---
  15 exit=0
   2 exit=1
   1 exit=64

--- 라벨별 메모 ---
  bug: 2
  ux: 3
  idea: 2
```

로그는 **로컬 파일**이며 레포에 커밋되지 않는다 (`~/acorn-dogfood.log` 기본값).

### 자동으로 수집되는 것

- 타임스탬프 (ISO8601)
- 호스트명 (Mac/Windows 구분용)
- 작업 디렉토리
- 전체 커맨드 + 인자
- exit code
- 소요 시간 (초)
- 실패 시 stderr 마지막 5줄

### 여전히 수동으로 필요한 것

- UX 불편함 ("이 화면 오래 봐야 이해됨")
- 기능 제안 ("이런 게 있으면 좋겠다")
- false positive / true positive 판단
- v0.1.1 / v0.2.0 / v0.3.0 분류 (도그푸딩 종료 시)

**자동으로 못 잡는 부분이 오히려 가치 있는 데이터**다. 한 줄씩 남겨라.

---

---

## 사전 준비 (한 번만)

### 양쪽 머신 공통

```bash
# 1. 최신 main
cd ~/01_private/acorn    # Mac, 또는 D:\dotoricode\acorn (Windows)
git pull origin main
git checkout v0.1.0      # 태그 기준으로 고정 (도그푸딩 중 main drift 차단)

# 2. 빌드
nvm use 24
npm install
npm run build

# 3. 전역 링크
npm link
which acorn              # dist/index.js 가리켜야 함
acorn --version          # 0.1.0

# 4. 관찰 로그 파일 생성
cp docs/DOGFOOD.md ~/acorn-dogfood.md     # 템플릿 복사, 개인 로그는 레포 밖에
```

### harness.lock 준비

`acorn install` 이 실행되려면 `harness.lock` 이 필요하다.
아직 dotfiles 레포에 실물 lock 이 없다면 최소 샘플을 만든다:

```bash
mkdir -p ~/.claude-personal/skills/harness   # 또는 $CLAUDE_CONFIG_DIR/skills/harness
cat > ~/.claude-personal/skills/harness/harness.lock <<'EOF'
{
  "schema_version": 1,
  "acorn_version": "0.1.0",
  "tools": {
    "omc": {
      "repo": "affaan-m/oh-my-claudecode",
      "commit": "0000000000000000000000000000000000000001",
      "verified_at": "2026-04-15"
    },
    "gstack": {
      "repo": "aj-geddes/gstack",
      "commit": "0000000000000000000000000000000000000002",
      "verified_at": "2026-04-15"
    },
    "ecc": {
      "repo": "aj-geddes/everything-claude-code",
      "commit": "0000000000000000000000000000000000000003",
      "verified_at": "2026-04-15"
    }
  },
  "guard": { "mode": "block", "patterns": "strict" }
}
EOF
```

**주의**: `commit` SHA 는 실제 값으로 교체. 샘플 SHA 는 clone 실패함.
*`acorn dev lock` 이 v1.1+ 예정이므로 v0.1.0 단계에서는 수동 편집.*

---

## 시나리오 (순서대로)

### S1. Fresh install — "새 머신에 처음 깔 때"
**목적**: 설치 파이프라인이 진짜로 도는가.

```bash
acorn status            # 아직 vendors 없음 → 3개 모두 missing 뜨는지
acorn doctor            # critical 3개 (vendor) + env 3개 (missing) 뜨는지
acorn install           # 7단계 로그가 순서대로 찍히는지
acorn status            # 이번엔 ✅ locked 3개
acorn doctor            # 이슈 없음 메시지
```

**관찰 포인트**:
- 7단계 로그 순서가 `[1/7]` → `[7/7]` 순서인가
- `settings.json` 에 env 3키가 **추가**됐는가 (기존 키 보존?)
- `~/.claude/skills/harness/backup/` 에 백업이 있는가
- `tx.log` 에 `begin` → `phase`... → `commit` 순서로 기록됐는가

---

### S2. 재실행 멱등성 — "두 번째 install"
**목적**: 멱등성 설계가 말로만인지 실제로인지.

```bash
acorn install           # 직전 성공 상태에서 한 번 더
```

**관찰 포인트**:
- vendors 3개 모두 `noop` 인가 (로그 확인)
- gstack 심링크 `noop`
- settings `action=noop`
- `backup/` 에 새 폴더가 생겼는가 (생겼다면 불필요 백업 = v0.2.0 GC 근거)

---

### S3. 심링크 수동 파괴 — "doctor 가 정확히 집는가"
**목적**: Done Definition `심링크 수동 삭제 후 acorn doctor 가 정확 지적` 실환경 확인.

```bash
rm ~/.claude-personal/skills/gstack      # 링크 제거
acorn status
acorn doctor --json | jq '.issues[] | select(.area=="symlink")'
acorn install           # 자동 복구?
```

**관찰 포인트**:
- status / doctor 출력이 실제로 사람이 읽기 쉬운가
- JSON 포맷이 `jq` 파이프로 바로 쓸만한가 (**가장 중요한 관찰 포인트**)
- `acorn install` 이 복구 가능했는가, 아니면 `doctor --fix` 가 필요하다고 느꼈는가

---

### S4. Vendor drift — "harness.lock 은 바꼈는데 vendor 가 구버전"
**목적**: drift 감지가 실제로 유용한가.

```bash
# lock 만 수정 (commit SHA 1글자 바꿔서 다른 SHA 로 만듦)
vim ~/.claude-personal/skills/harness/harness.lock
acorn status            # omc drift 로 뜨는지
acorn doctor            # warning + 힌트
acorn install           # 실 SHA 가 아니라 clone 실패할 것 — 에러 메시지 품질 확인
```

**관찰 포인트**:
- drift 감지됐을 때 **실제로 어떤 행동**을 하고 싶어지는가 (install? 아니면 lock 되돌리기?)
- 에러 메시지가 fix 로 연결되는가, 아니면 docs 를 뒤져야 하는가

---

### S5. Settings 충돌 — "수동으로 env 넣어놨는데 값이 다르면"
**목적**: 비파괴 원칙 확인.

```bash
# settings.json 에 이미 다른 값으로 env 키 넣기
vim ~/.claude-personal/settings.json
# "env": { "CLAUDE_PLUGIN_ROOT": "/other/path", ... }

acorn install           # preflight 에서 CONFLICT 로 막혀야 함
# 파일 변경 없이 중단됐는지 확인 (timestamp)
```

**관찰 포인트**:
- 에러 메시지가 "어느 키가 충돌, 현재값 vs 기대값" 을 명확히 보여주는가
- 사용자가 **다음에 뭘 해야 하는지** 알 수 있는가

---

### S6. Ctrl-C 시뮬레이션 — "설치 중 중단했을 때"
**목적**: tx.log 가 실제로 복구에 도움이 되는가.

```bash
acorn install &          # 백그라운드로
sleep 0.3; kill -INT $!  # 중간에 인터럽트
acorn install            # 재실행 → IN_PROGRESS 에러 떠야 함
cat ~/.claude-personal/skills/harness/tx.log | tail
acorn install --force    # 우회
```

**관찰 포인트**:
- `IN_PROGRESS` 에러 메시지가 `--force` 를 안내하는가
- tx.log 가 사람이 읽을 만한가 (phase 이름이 직관적?)
- 중단된 상태의 vendors 가 일관된가 (partial clone 정리됐나)

---

### S7. Guard 훅 실전 — "진짜로 위험 커맨드 막는가"
**목적**: PreToolUse 훅이 Claude Code 환경에서 발화하는지.

```bash
# Claude Code 에 훅 등록
# ~/.claude-personal/settings.json 에 hooks.PreToolUse 추가:
#   "matcher": "Bash",
#   "command": "/absolute/path/to/acorn/hooks/guard-check.sh"

# Claude Code 세션에서 위험 커맨드 시도
# - rm -rf /tmp/foo → 차단
# - git push --force-with-lease → 통과
# - DROP TABLE foo → 차단
```

**관찰 포인트**:
- 차단 메시지가 bypass 방법을 안내하는가
- Claude Code UI 에서 에러 메시지가 읽히는가
- false positive 는? (일상 커맨드 중 막히면 안 되는 것이 막혔는가)

---

### S8. 2머신 동기화 — "아침 회사 Mac 에서 이어 받기"
**목적**: 실제 워크플로우에 acorn 이 녹는가.

```bash
# Mac 회사
cd ~/01_private/dotfiles
git pull                 # 집에서 lock 갱신된 커밋 받음
cd ~/01_private/acorn
acorn status             # lock SHA 와 실 vendor SHA 차이?
acorn install            # 갱신된 SHA 로 재checkout
acorn status             # 다시 locked
```

**관찰 포인트**:
- **이 루프가 매일 돌만큼 가볍고 믿을만한가**
- 어느 단계에서 "이걸 한 커맨드로" 하고 싶어지는가 → `acorn sync` 필요성 근거
- status 출력이 한눈에 읽히는가

---

### S9. CI 게이트 흉내 — "CI 에서 설치 건강도 체크"
**목적**: JSON 출력이 외부 도구에 실용적인가.

```bash
# 임시 스크립트
if acorn doctor --json | jq -e '.ok' > /dev/null; then
  echo "healthy"
else
  acorn doctor --json | jq -r '.issues[] | "[\(.severity)] \(.area)/\(.subject): \(.message)"'
  exit 1
fi
```

**관찰 포인트**:
- JSON 스키마가 실제로 쓸만한가 (필드 이름, severity 체계)
- exit code 로 게이트 걸기 편한가

---

## 관찰 로그 (자동 + 수동 합쳐 한 파일)

모든 기록은 `$ACORN_DOGFOOD_LOG` (기본 `~/acorn-dogfood.log`) 에 append 된다.
실행 기록은 wrapper 가, 메모는 `dn` 이 같은 파일에 쓴다.

필요하면 같은 디렉토리에 별도 `~/acorn-dogfood.md` 를 만들어
주간 요약·회고를 써도 되지만 **필수 아님**. `dreport` 출력을 그대로 다음 세션에 가져와도 충분.

### Raw 로그 vs 정제 요약 — git 추적 정책

| 항목 | 위치 | git 추적 |
|---|---|---|
| Raw 로그 (`acorn-dogfood.log`) | `~/` (홈, 레포 외부) | ❌ `.gitignore` 명시 제외 |
| Round N 요약 | `docs/DOGFOOD.md` § Round N | ✅ commit |

**Raw 로그 미추적 이유**:
- 절대경로·호스트명·stderr 등이 포함되어 공개 레포에 누적 시 위생 안 좋음
- 매 호출당 6~10줄, 한 달이면 수천 줄 — 레포 사이즈에 의미 없는 부담
- 2머신 (Mac/Windows) 환경에서 각자 append → 머지 분쟁 구조적 발생

**정제 요약은 추적**: 진짜 가치는 사람이 정리한 패턴·우선순위. raw 는 요약 만들 때 한 번 보고 버린다.

> **워크플로우**: 라운드 종료 시 `dreport` → 본인이 선별·문장화 → `docs/DOGFOOD.md` § Round N append → commit. raw 로그는 그대로 두거나 삭제.

---

## 분류 기준

| 라벨 | 기준 |
|---|---|
| **v0.1.1-hotfix** | 크래시, 데이터 손실, 실제로 하루 작업을 막는 것 |
| **v0.2.0-candidate** | "없어서 불편하다" 를 주 1회 이상 체감, 설계 영향 있음 |
| **v0.3.0+** / dropped | 써보니 "있으면 좋겠다" 수준, 실빈도 낮음, YAGNI |

---

## 도그푸딩 종료 기준

다음 중 **하나라도** 충족하면 종료:
- 불편 로그 10건 이상 쌓임 (데이터 충분)
- 2주 경과 (달력 기준)
- 명백한 v0.1.1 블로커 1건 발견 (즉시 대응)
- 로그가 3일간 업데이트 없음 (= acorn 을 실제로 안 씀 = 기능이 데일리 루프에 안 녹은 것. **그 자체가 최대 가치의 관찰**)

---

## 종료 후 다음 세션 브리핑 재료

1. `dreport` 출력 (정량 전부 — 실행 횟수, 실패 분포, 메모 전량)
2. v0.1.1 / v0.2.0 분류 요약 (사람 판단)
3. 가장 의외였던 발견 3개 (사람 판단)
4. **실제로 얼마나 썼나 솔직히** — `dreport` 의 "실행 N 회" 가 숫자로 말해줌. 안 쓴 날은 왜?

이 네 가지 들고 와서 v0.1.1 착수 세션 시작.
