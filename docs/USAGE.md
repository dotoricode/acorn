# acorn 사용법

일상적으로 acorn 을 어떻게 꺼내 쓰는지 정리한 치트시트. (v0.9.0+ capability 모델)

> **큰 그림**
> acorn 은 "capability orchestrator". 실제 Claude Code 세션에서 provider
> (gstack / superpowers / gsd / claudekit / 사용자 정의) 기능을 **사용하는 것**
> 은 Claude Code 자체이지 acorn 이 아니다.
> acorn 은 **선언된 capability ↔ 검증된 provider 매핑** 을 lock 으로 고정하고,
> drift 가 생겼을 때 꺼내 쓰는 계측·복구 장비다.
> 하루 5분도 안 쓰는 게 정상이다.

**용어 빠른 정리**
- **capability**: 원하는 기능 (`hooks`, `planning`, `tdd`, `review`, `qa_ui`, `qa_headless`, `memory`)
- **provider**: 그 기능을 제공하는 도구 (gstack, superpowers, gsd, claudekit ...)
- **preset**: capability 묶음 (starter / builder / frontend / backend)
  - legacy `prototype/dev/production` phase 는 alias 로 자동 매핑됨

---

## 전제 — 셋업이 끝난 상태

npm 배포판(`npm i -g @dotoricode/acorn`) 이나 로컬 `npm link` 로
`acorn` 이 전역 호출 가능한 상태.

> **도그푸딩 개발자 전용 (npm 배포판 사용자는 무시)**
>
> 레포를 직접 체크아웃해 도그푸딩할 때는 `scripts/dogfood/` 하에
> `adog` (wrap), `dn` (note), `dreport` (report) alias 를 쓸 수 있다.
> npm 배포판에는 포함되지 않는다 (v0.3.1+ `files` 화이트리스트).
> ```bash
> export ACORN_REPO=~/01_private/acorn
> alias adog="$ACORN_REPO/scripts/dogfood/wrap.sh"
> alias dn="$ACORN_REPO/scripts/dogfood/note.sh"
> alias dreport="$ACORN_REPO/scripts/dogfood/report.sh"
> ```
> 이 문서의 예시는 `acorn` 기준으로 읽으면 된다. 도그푸딩 모드에선
> `acorn` 을 `adog` 로 바꿔도 동일하게 동작 + 자동 로깅.

---

## 🟢 거의 매일 쓰는 것 (30초)

### 1. 상태 확인 — 뭔가 이상한 감이 있을 때

```bash
acorn status
```

3툴 전부 ✅ 뜨면 끝.

```
acorn v0.6.0  •  ~/.claude/skills/harness
────────────────────────────────────────────────────────────
  omc     04655ee  ✅  locked
  gstack  c6e6a21  ✅  locked  (symlinked)
  ecc     125d5e6  ✅  locked
────────────────────────────────────────────────────────────
  guard    block / strict
  env:
    CLAUDE_PLUGIN_ROOT   ✅  match
    OMC_PLUGIN_ROOT      ✅  match
    ECC_ROOT             ✅  match
  gstack link   ✅  correct
```

### 1-B. tool 목록만 간결 확인 (v0.6.0+)

`status` 보다 단순 — 환경변수/심링크/guard 안 보고 **tool SHA 만**.

```bash
acorn list
```

```
acorn v0.6.0  •  ~/.claude/skills/harness
────────────────────────────────────────────────────────────────────────
  TOOL     SHA        STATE    REPO
  omc      04655ee    ✅ locked Yeachan-Heo/oh-my-claudecode
  gstack   c6e6a21    ✅ locked garrytan/gstack
  ecc      125d5e6    ✅ locked affaan-m/everything-claude-code
```

CI 한 줄 게이트:
```bash
# 모든 tool 이 locked 이 아니면 exit 1
acorn list --json | jq -e '.tools | map(select(.state != "locked")) | length == 0'
```

### 2. 설정 요약 — 현재 guard 모드 / 패턴 한눈에 (v0.3.0+)

```bash
acorn config
```

```
guard.mode:     block
guard.patterns: strict
```

### 3. 메모 (도그푸딩 모드 전용) — 1줄, 생각나는 즉시

```bash
dn ux "status 가 해석에 시간 걸림"
dn idea "lock 바뀐 거 세션 시작할 때 알려줬으면"
dn bug "install 로그 줄바꿈 이상"
```

라벨 (선택): `bug` / `ux` / `idea` / `question` / `blocker`
(배포판 사용자는 이 스킬을 쓰지 않는다.)

---

## 🟡 상황별로 가끔 (주 1~2회 예상)

### 머신 바꾸러 왔을 때 (집 → 회사, 회사 → 집)

```bash
cd ~/01_private/dotfiles && git pull origin main    # lock 받기
acorn status                                         # drift 있나 확인
acorn install                                        # drift 있으면 재설치
```

`status` 가 다 ✅ 면 `install` 건너뛰어도 된다. 대부분 noop.

### "뭔가 이상한데" 싶을 때

```bash
acorn doctor
```

출력 예:

```
⚠️  [vendor] gstack
   vendor 에 로컬 변경이 있음
   → git -C <path> status 로 확인 후 커밋·스태시·버림 중 선택
```

힌트 그대로 따라가면 된다.

### lock 파일 검증만 하고 싶을 때 (CI 친화, v0.2.0+)

```bash
acorn lock validate                 # defaultLockPath
acorn lock validate ./harness.lock  # 명시 경로
```

```
✅ harness.lock OK  (schema_version=1, acorn_version=0.3.2, tools=3, guard=block/strict)
```

실패 시 exit 78 + `[lock/SCHEMA] ...`. CI pipeline 한 줄 gate 로 꽂기 좋음.

### 기존 수동 설치를 acorn 관리로 옮길 때 (v0.3.0+ `--adopt`)

lock 기준으로 새로 clone 하되, 기존 수동 설치물은 `.pre-adopt-<ts>/`
접미어로 **비파괴 보존**. ADR-018 원칙상 삭제는 없다.

```bash
acorn install --adopt             # TTY 에서 Y/n 확인 (v0.3.1+ B3)
acorn install --adopt --yes       # CI / 비대화형 환경
```

동작:

- vendor 경로가 non-git 디렉토리 → `<path>.pre-adopt-<ISO8601>/` 로 이름
  변경 후 lock SHA 로 clone → `action=adopted`
- settings.json 의 env 키 충돌 → `env.<key>.pre-adopt-<ISO8601>` 로 키 이름
  변경 후 기대값 덮어쓰기

> **주의**: v0.3.1 부터 `--adopt` 는 destructive rename 으로 분류되어
> non-TTY + `--yes` 미지정이면 `[install/ARGS]` USAGE 에러로 차단된다.

### vendor 가 심링크인 환경 (dev 레포 직링크, v0.3.0+ `--follow-symlink`)

```bash
acorn install --follow-symlink    # target HEAD 를 lock SHA 와 비교
```

- `--follow-symlink` 없이 심링크를 만나면 **NOT_A_REPO 로 fail-close**
  (v0.3.1 B1 이후). 이전 v0.3.0 의 silent preserve 는 제거됨.
- `--follow-symlink` 지정 시 target 의 HEAD 를 `git rev-parse HEAD` 로
  읽어 lock 과 비교. 일치하면 `adopted`, 불일치면 `preserved` + drift 경고.

### dotfiles 의 harness.lock 이 바뀐 뒤

```bash
acorn install
```

출력 `[4/8]` 줄에서 각 툴 상태 확인:

- `cloned` — 처음 설치
- `checked_out` — SHA 변경으로 재체크아웃
- `noop` — 이미 lock 과 일치
- `adopted` — `--adopt` 로 기존 수동 설치 흡수 (v0.3.0+)
- `preserved` — 심링크 dev 레포 그대로 유지 (v0.3.0+)

### install 이 중간에 중단됐을 때 (Ctrl-C 등)

```bash
acorn install             # → [install/IN_PROGRESS] 에러
acorn install --force     # 우회
```

`--force` 는 이전 트랜잭션이 `commit` / `abort` 로 마감 안 된 경우만 필요.

---

## 🔴 가끔만 (월 1~2회)

### JSON 자동화 — CI / 스크립트 / Claude Code hook

```bash
acorn status --json | jq .ok                            # true/false 로 게이트
acorn doctor --json | jq '.okCritical'                  # critical 만 gate (v0.1.2+)
acorn doctor --json | jq '.summary'                     # {critical, warning, info} 카운트
acorn doctor --json | jq '.issues[].hint'               # 이슈 힌트만
acorn status --json > /tmp/acorn-report.json            # 저장
acorn lock validate && echo ok                          # v0.2.0+ lock schema gate
```

`status` / `doctor` / `lock validate` 모두 exit code 로 CI 분기 가능
— 아래 Exit code 표 참조.

### phase 전환 — 작업 단계에 맞게 guard 강도 동기화 (v0.7.0+)

작업 성격이 바뀔 때 `acorn phase` 한 줄로 guard 강도 + CLAUDE.md 지침을 함께 변경.

```bash
acorn phase                       # 현재 phase 확인 (get)
acorn phase prototype --yes       # 탐색 단계 — guard minimal, fail-fast 완화
acorn phase dev --yes             # 기본 개발 (기본값)
acorn phase production --yes      # 운영 안정 — guard strict, 파괴적 조치 명시 승인 필요
```

| phase | guard.patterns | 설명 |
|---|---|---|
| `prototype` | `minimal` | 빠른 탐색, 진행 우선 |
| `dev` | `moderate` | 표준 개발 (기본값, install 시 seed) |
| `production` | `strict` | 안정 운영, 파괴적 조치는 명시적 승인 |

`acorn phase` 는 `<harnessRoot>/phase.txt` 를 업데이트하고, `CLAUDE.md` 의
`<!-- ACORN:PHASE:START -->` … `<!-- ACORN:PHASE:END -->` 마커 블록도 자동 갱신.
마커 밖 CLAUDE.md 내용은 byte-by-byte 보존된다.

**환경변수 우선순위** (guard-check.sh 결정 체계):

| 우선순위 | 환경변수 / 소스 | 설명 |
|---|---|---|
| 1 (최고) | `ACORN_GUARD_BYPASS=1` | 모든 guard 완전 비활성화 |
| 2 | `ACORN_PHASE_OVERRIDE=<phase>` | phase.txt 무시, 지정 phase 강제 |
| 3 | `ACORN_GUARD_PATTERNS=<level>` | patterns 직접 지정 (phase 보다 우선) |
| 4 | `<harnessRoot>/phase.txt` | acorn phase 가 관리하는 파일 |
| 5 | `harness.lock .guard.patterns` | v0.6.x 이하 fallback |
| 6 (기본) | `strict` | phase.txt / lock 모두 없는 경우 |

### guard 모드 / 패턴 전환 (v0.3.0+)

개발 중 위험 커맨드 차단을 잠시 완화하거나 다시 잠글 때.
phase 와 별개로 patterns 만 일시 변경하고 싶을 때 사용.

```bash
acorn config guard.mode warn --yes           # block → warn (차단 대신 경고만)
acorn config guard.patterns minimal --yes    # strict → minimal (catastrophic 만)
acorn config guard.mode block --yes          # 복귀
```

모든 쓰기는 preflight 검증 → backup → atomic write → parseLock 재검증 4단계.
`tx.log` 에 `phase=config-guard.mode` 등으로 기록 (v0.3.1+ B2).

### env 3키 초기화 (v0.3.0+)

`CLAUDE_PLUGIN_ROOT` / `OMC_PLUGIN_ROOT` / `ECC_ROOT` 만 `settings.json`
에서 제거 (다른 키 보존). 수동 재설치 전 정리용.

```bash
acorn config env.reset --yes
```

backup 자동 생성. 이후 `acorn install` 로 재주입.

### 전체 언인스톨 (v0.9.0+)

acorn 이 설치한 모든 것을 제거한다. `harness.lock` / `tx.log` / `backup/` 는 보존.

```bash
acorn uninstall --yes
```

7단계로 동작한다:
1. `settings.json` env 3키 제거 (CLAUDE_PLUGIN_ROOT / OMC_PLUGIN_ROOT / ECC_ROOT)
2. CLAUDE.md `ACORN:PHASE` 마커 블록 제거
3. `~/.claude/skills/gstack` 심링크 제거 (실 디렉토리면 건드리지 않음)
4. `hooks/guard-check.sh` 제거
5. `.gstack-setup.sha` marker 제거
6. `phase.txt` 제거
7. `vendors/` 디렉토리 제거

완료 후 `acorn status` 로 확인. 재설치는 `acorn install`.

### 도그푸딩 누적 요약 (도그푸딩 모드 전용)

```bash
dreport
```

주 1회 정도. 본인이 언제 뭘 썼고 뭘 적었는지 구조화된 요약이 나온다.
(배포판 사용자에게는 없음.)

### 기존 수동 설치물을 acorn 관리로 이관 (v0.3.0+)

> **❌ rm -rf 로 지우지 말 것** (ADR-018). acorn 은 "삭제 없음,
> 항상 rename" 원칙.

```bash
acorn install --adopt              # TTY 확인 후 <path>.pre-adopt-<ts>/ 로 rename + clone
acorn install --adopt --yes        # non-TTY/CI
```

기존 디렉토리는 `<path>.pre-adopt-<ISO8601>/` 로 보존되므로 문제 시
수동 복구 가능. `settings.json` 의 env 3키는 그대로 두면 재사용 — 충돌
안 난다 (충돌하면 `env.<key>.pre-adopt-<ts>` 로 이동).

---

## 📋 전체 커맨드 치트시트

| 커맨드 | 의미 | 빈도 | 도입 |
|---|---|---|---|
| `acorn status` | 3툴 + env + symlink 요약 | 하루 0~2회 | v0.1.0 |
| `acorn doctor` | 이슈 + 복구 힌트 | 주 0~2회 | v0.1.0 |
| `acorn install` | lock 기준 설치·갱신 | 머신 바꿀 때 | v0.1.0 |
| `acorn install --force` | tx 중단 무시 | 비상시 | v0.1.0 |
| `acorn install --skip-gstack-setup` | gstack setup 생략 | 특수 | v0.1.0 |
| `acorn install --run-gstack-setup` | gstack setup 자동 실행 | 첫 설치 | v0.1.1 |
| `acorn install --adopt` | 기존 수동 설치 흡수 + rename 보존 | 이관 | v0.3.0 |
| `acorn install --follow-symlink` | 심링크 vendor target HEAD 검증 | dev 환경 | v0.3.0 |
| `acorn install --yes` | destructive 프롬프트 스킵 | CI | v0.3.1 |
| `acorn install --mode=guided` | 추천 + plan 만 출력, 변경 없음 | 초기 검토 | v0.9.0 |
| `acorn install --mode=detect-only` | 설치 상태 감지만 | 트러블슈트 | v0.9.0 |
| `acorn list` | tool/SHA/상태 간결 나열 | CI | v0.6.0 |
| `acorn list --json` | 기계 판독용 JSON | jq 파이프 | v0.6.0 |
| `acorn preset` | 현재 preset 조회 | 수시 | v0.9.0 |
| `acorn preset list` | 4종 preset 정의 출력 | 처음 | v0.9.0 |
| `acorn preset <name> [--yes]` | preset 전환 (legacy alias 도 받음) | 작업 단계 변경 | v0.9.0 |
| `acorn lock validate [path]` | harness.lock schema 검증 | CI gate | v0.2.0 |
| `acorn config` | guard 현재 설정 요약 | 수시 | v0.3.0 |
| `acorn config guard.mode <v>` | `block\|warn\|log` 전환 | 개발 중 | v0.3.0 |
| `acorn config guard.patterns <v>` | `strict\|moderate\|minimal` 전환 | 개발 중 | v0.3.0 |
| `acorn config env.reset` | env 3키 제거 (다른 키 보존) | 드물게 | v0.3.0 |
| `acorn config provider.allow-custom <true\|false>` | 사용자 정의 provider 의 install_cmd 실행 허용 | 사용자 정의 등록 시 | v0.9.5 |
| `acorn provider list` | builtin + 사용자 정의 통합 목록 | 등록 후 검증 | v0.9.5 |
| `acorn provider add <path> [--force]` | *.json 검증 후 providers/ 로 복사 | 사용자 정의 등록 | v0.9.5 |
| `acorn migrate` | v2 → v3 plan dry-run | v2 → v3 이전 시 1 회 | v0.9.6 |
| `acorn migrate --auto --yes` | backup → v3 atomic 쓰기 + log | v2 → v3 이전 시 1 회 | v0.9.6 |
| `acorn doctor --fix` | safe drift 자동 복구 (install 재실행) | drift 발견 시 | v0.9.7 |
| `acorn doctor --fix --safe-only` | interactive 도 skip | 자동화 환경 | v0.9.7 |
| `acorn doctor --fix --json` | initial+recovery+after JSON | CI 모니터링 | v0.9.7 |
| `acorn phase` | 현재 phase 확인 | 수시 | v0.7.0 |
| `acorn phase <v> [--yes]` | `prototype\|dev\|production` 전환 | 작업 단계 변경 시 | v0.7.0 |
| `acorn uninstall --yes` | 전체 언인스톨 (7단계) | 제거 시 | v0.9.0 |
| `acorn --version` | `0.9.0` | 확인용 | v0.1.0 |
| `acorn --help` | usage | 까먹었을 때 | v0.1.0 |
| `dn <메모>` | 1줄 관찰 기록 (도그푸딩) | — | dev-only |
| `dn ux/bug/idea/blocker <메모>` | 라벨 + 메모 | — | dev-only |
| `dreport` | 누적 요약 | — | dev-only |

---

## 🎯 Claude Code 세션 안에서는

여기서는 **`acorn` 을 거의 안 친다**. 대신 **활성화된 capability ↔ provider** 가 제공하는 스킬·에이전트를 쓴다:

- **gstack provider** (`planning` / `review` / 일부 `qa_ui`): `/office-hours` / `/plan-ceo-review` / `/review` / `/ship` / `/qa` ...
- **superpowers provider** (`spec` / `tdd` / `review`): plugin marketplace 로 설치된 명령
- **gsd provider** (`planning` / `spec`): `npx get-shit-done@latest`
- **claudekit provider** (`hooks`): `npx claudekit@latest setup --hooks <name>`
- legacy v2 사용자: **OMC** / **ECC** 도 acorn 이 v0.8 이하 lock 을 계속 인식

provider 별 자산은 `~/.claude/skills/*` 심링크 또는 `~/.claude/plugins/*` 으로 **이미 연결돼 있어서** Claude Code 가 자동 인식한다. acorn 은 그 연결을 만들고 감시하는 역할이다.

---

## 💡 자연스러운 사용 루틴

### 아침 회사

```bash
cd ~/01_private/acorn && git pull
acorn status      # 전부 ✅ 확인 (도그푸딩 모드는 adog)
# Claude Code 세션 시작 → 평소 작업
```

### 작업 중 뭔가 이상함

```bash
acorn doctor
# 힌트 따라 처리
dn bug "doctor 가 지적한 N 이슈 — 실제론 정상이었음"    # 도그푸딩 모드 전용
```

### 저녁 집에 가기 전

특별히 할 일 없음. `dotfiles` 에 lock 변경 있으면 commit + push.
acorn 자체는 건드릴 일 거의 없음.

### 주말 / 주간 회고 (도그푸딩 모드 전용)

```bash
dreport   # 이번 주 얼마나 썼나, 뭐 적었나
# DOGFOOD.md Round N 기록 준비용
```

---

## 🚫 안 해도 되는 것

- `acorn install` 을 매일 돌리기 — **불필요**. lock 안 바뀌면 전부 noop.
- `status` / `doctor` 를 반복 확인 — **불필요**. 평소 한 번 보면 충분.
- 수동으로 `vendors/` 건드리기 — **비권장**. dirty warning 이 쌓인다.
  이관이 필요하면 `acorn install --adopt` (v0.3.0+).
- `rm -rf vendors/` 같은 파괴적 조치 — **금지**. ADR-018 대신 `--adopt` 사용.

---

## 📊 Exit code 규약 (스크립트 연동용)

| code | 의미 |
|---|---|
| `0` | 성공 |
| `1` | 일반 실패 (drift, critical issue 등) |
| `64` | 사용법 오류 (알 수 없는 커맨드) |
| `75` | 재시도 가능 (tx.log in_progress — `--force` 로 재실행) |
| `78` | 설정 오류 (settings 충돌, lock 스키마) |

에러 메시지는 `[area/code] 메시지` 프리픽스로 stderr 에 출력.
예: `[vendor/CLONE/omc]`, `[install/IN_PROGRESS]`, `[lock/NOT_FOUND]`.

---

## 🆘 막혔을 때

| 상황 | 조치 |
|---|---|
| `[lock/PARSE] JSON 파싱 실패` | `harness.lock` 확인 — BOM 또는 JSON 문법 오류 |
| `[lock/SCHEMA] schema_version 불일치` | lock 에 `"schema_version": 1` 추가 |
| `[install/LOCK_SEEDED]` (v0.1.2+) | 템플릿이 시드됨. 각 tool `commit` 을 실제 SHA 로 바꾼 뒤 재실행 |
| `[install/SETTINGS_CONFLICT]` | `acorn install --adopt` 로 흡수 (충돌 키를 `env.<key>.pre-adopt-<ts>` 로 이동, v0.3.0+), 또는 수동으로 기대값 교체 |
| `[install/IN_PROGRESS]` | `acorn install --force` 또는 `harness/tx.log` 확인 |
| `[install/ARGS] --adopt ... --yes 필요` | non-TTY 에서 `--adopt` 는 `--yes` 명시 필수 (v0.3.1+ B3) |
| `[vendor/NOT_A_REPO]` non-git | `acorn install --adopt` 로 자동 흡수 (v0.3.0+, ADR-018). 수동 대안: `mv <path> <path>.bak` 후 재실행. **rm -rf 금지** |
| `[vendor/NOT_A_REPO]` 심링크 | v0.3.1+ 부터 `--follow-symlink` 없이는 fail-close. 심링크 dev 레포면 `acorn install --follow-symlink`, 아니면 심링크 제거 후 재실행 |
| `[vendor/CLONE]` | 네트워크 / 레포 접근권한 확인 |
| `[config/CONFIRM_REQUIRED]` (v0.3.0+) | non-TTY 에서 `acorn config ... --yes` 로 재실행 |
| `[config/SCHEMA]` (v0.3.0+) | 값 enum 확인: `guard.mode=block\|warn\|log`, `guard.patterns=strict\|moderate\|minimal` |
| `[phase/INVALID_VALUE]` (v0.7.0+) | `acorn phase prototype\|dev\|production` 중 하나여야 함 |
| `[phase/CONFIRM_REQUIRED]` (v0.7.0+) | non-TTY 에서 `acorn phase <v> --yes` 로 재실행 |
| `[uninstall/CONFIRM_REQUIRED]` (v0.9.0+) | non-TTY 에서 `acorn uninstall --yes` 로 재실행 |
| `acorn status` 에서 `⚠️ CLAUDE.md` | `acorn install` 또는 `acorn phase <현재값> --yes` 로 마커 동기화 |
| gstack dirty warning 계속 | `cd vendors/gstack && git status` 로 원인 파악 후 커밋·스태시·reset 중 선택. `.agents/` 같은 setup 부산물은 자동 허용 (v0.1.1+) |

---

## 🌰 핵심 원칙

**acorn 이 조용할수록 정상이다.**

시끄러워질 때만 꺼내 보면 된다.
평소엔 `acorn status` 한 번 스쳐 보고, 전부 ✅ 면 닫으면 된다.

모르는 게 있으면 `acorn --help` 가 언제나 첫 진입점.

---

## 관련 문서

- [README.md](../README.md) — 설치 · 요구사항 · 아키텍처 상세
- [docs/DOGFOOD.md](DOGFOOD.md) — 도그푸딩 가이드 + 관찰 기록
- [docs/HANDOVER.md](HANDOVER.md) — 2머신 인계 체크리스트
- [docs/acorn-v1-plan.md](acorn-v1-plan.md) — 설계 · ADR · Done Definition
- [CHANGELOG.md](../CHANGELOG.md) — 버전 이력
