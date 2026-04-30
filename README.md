# acorn

Claude Code 하네스 CLI — **capability-first** 모델.

원하는 기능(capability)을 선언하면 acorn 이 적합한 제공자(provider)를 격리 설치한다.

> **Status**: **v0.9.6** — capability/provider/preset 모델 (schema v3). `acorn uninstall` (v0.9.0+),
> 사용자 정의 Provider 레지스트리 + `acorn provider list/add` (v0.9.5+),
> v2 → v3 자동 마이그레이션 `acorn migrate` (v0.9.6+).
>
> **일상 사용법**: [`docs/USAGE.md`](docs/USAGE.md) ← 처음이면 여기부터
> 설계 문서: [`docs/acorn-v1-plan.md`](docs/acorn-v1-plan.md)
> 변경 이력: [`CHANGELOG.md`](CHANGELOG.md)

---

## 핵심 모델: capability → provider → preset

### Capability — 원하는 기능

| capability | 의미 |
|---|---|
| `hooks` | Claude Code PreToolUse/PostToolUse 훅 관리 |
| `planning` | 스펙·태스크·플래닝 지원 |
| `tdd` | 테스트 주도 개발 워크플로우 |
| `review` | 코드 리뷰 에이전트 |
| `qa_headless` | API/worker/cron/webhook/CLI 수동 QA 가이드 (provider 없어도 first-class) |
| `memory` | 컨텍스트 영속화 |

### Provider — 기능을 제공하는 도구

| provider | 설치 방식 | 주요 capability |
|---|---|---|
| gstack | git-clone + 심링크 | tdd, review |
| superpowers | git-clone | planning, spec |
| gsd | npx | planning, qa_headless |
| claudekit | npx | hooks |

#### 사용자 정의 Provider (v0.9.5+)

내장 4 개 외 자체 도구를 등록하려면 `<harnessRoot>/providers/<name>.json` 에 정의를 두거나,
`ACORN_EXTRA_PROVIDERS` 환경변수에 외부 경로를 OS native delimiter (POSIX `:` / Windows `;`)
로 나열한다.

```json
{
  "name": "my-review-tool",
  "displayName": "My Review Tool",
  "capabilities": [{ "name": "review", "strength": "primary" }],
  "strategies": ["npx"],
  "primaryStrategy": "npx",
  "packageName": "@me/my-review-tool",
  "command": "my-review-tool"
}
```

```bash
acorn provider add ./my-review-tool.json   # 검증 후 providers/ 로 복사
acorn provider list                        # builtin + 사용자 정의 통합 목록 + 충돌 warn
```

**보안**: 사용자 정의 provider 의 `install_cmd` (npx/npm-global 전략) 는 임의 shell 명령을
실행할 수 있으므로 기본 차단이다. 명시 opt-in 후에만 실행:

```bash
acorn config provider.allow-custom true --yes
```

같은 `name` 이 builtin 과 사용자 정의에 모두 있으면 사용자 정의가 우선하고 warning 을 출력한다.

### Preset — 용도별 capability 묶음

| preset | capabilities | 언제 |
|---|---|---|
| `starter` | hooks, planning, qa_headless | 빠른 시작, 탐색 단계 |
| `builder` | hooks, planning, tdd, review, qa_headless | 본격 개발 |

---

## 개요

- **격리 우선** — `~/.claude/skills/harness/` 단일 위치 관리
- **버전 고정** — `harness.lock`에 기록된 SHA/검증 정보만 사용
- **fail-close** — 파싱/실행 실패 시 허용이 아닌 차단
- **비파괴적** — `settings.json` 멱등 머지, 충돌 시 백업 후 중단
- **qa_headless 독립** — provider 없어도 5가지 프로젝트 유형별 체크리스트 제공

---

## 기존 사용자 마이그레이션 (v0.8 → v0.9)

v0.8 이하 (`schema_version 2`, `prototype/dev/production` phase) 사용자는 **당장 깨지지 않는다.**
acorn 은 v2 lock 을 계속 파싱하고 설치한다 (deprecation warning 한 줄 출력, v0.9.6+).

**v0.9.6+ 자동 마이그레이션 (권장):**

```bash
acorn migrate                  # plan 출력 (dry-run, 디스크 변경 없음)
acorn migrate --auto --yes     # backup → v3 으로 atomic 쓰기 + log 기록
```

자동 처리되는 것:
- `gstack` (v2 required) → v3 `gstack` provider (git-clone, commit/repo 보존)
- `superpowers` (v2 optional) → v3 `superpowers` provider (이전 lock 에 있을 때만)
- guard mode/patterns 1:1 보존
- backup: `<harnessRoot>/backup/<ts>/migrate/harness.lock.v2.bak`
- log: `<harnessRoot>/migrations/v2-to-v3-<ts>.log` (JSON)

자동 처리되지 **않는** 것 (drop + warning):
- `omc` → Claude Code 내부 plugin marketplace 로 옮겨짐. 필요 시 `/plugin install ...`
- `ecc` → v3 provider 없음. `vendors/ecc` 디렉토리는 수동 정리.
- `claude-mem` → memory provider 미안정 (experimental).

**수동 마이그레이션 (대안):**

```bash
# 1. harness.lock 을 v3 템플릿으로 교체
#    (acorn install 이 없으면 자동 시드)
acorn install   # → LOCK_SEEDED 에러 + 템플릿 생성

# 2. 템플릿의 git-clone provider commit SHA 를 실제 값으로 채움
#    gstack:      garrytan/gstack 최신 HEAD SHA
#    superpowers: obra/superpowers 최신 HEAD SHA

# 3. 재설치
acorn install
```

| 이전 개념 | 새 개념 |
|---|---|
| `phase: prototype` | preset `starter` |
| `phase: dev` | preset `builder` |
| `phase: production` | preset `builder` + guard strict |
| `tools: {omc, gstack, ecc}` | `providers: {gstack, superpowers, gsd, claudekit}` |
| guard 수준 = phase 연동 | guard 는 `harness.lock.guard` 에서 직접 지정 |

---

## 빠른 시작

```bash
# 1. 부트스트랩
git clone https://github.com/dotoricode/acorn.git
cd acorn
nvm use 24     # Node 24.x 필요
npm install
npm run build

# 2. 전역 연결 (개발 중 권장)
npm link       # 이후 어디서든 `acorn` 호출 가능

# 2-Windows. npm link 가 실패하면 (Node 24 + Windows 10 Junction 이슈, §15 v0.2.0 S6)
npm run shim:windows   # .cmd + bash shim 을 $APPDATA/npm/ 에 생성 (junction 없이)

# 3. 일상 사용
acorn install                     # harness.lock 기준 설치 (= --mode=auto)
acorn install --mode=guided       # 추천 + plan 출력만 (변경 없음, v0.9.0+)
acorn install --mode=detect-only  # 설치 상태 감지만 (v0.9.0+)
acorn install --run-gstack-setup  # + gstack setup --host auto 자동 실행
acorn preset                      # 현재 preset 조회 (v0.9.0+)
acorn preset list                 # starter/builder/frontend/backend 목록 (v0.9.0+)
acorn preset builder --yes        # preset 전환 (v0.9.0+)
acorn status                      # 3툴 + guard + env 요약
acorn list                        # tool/SHA/상태 간결 나열 (v0.6.0+)
acorn list --json                 # CI 용 JSON
acorn doctor                      # 이슈 + 수동 복구 힌트
acorn status --json               # 기계 판독
acorn lock validate               # harness.lock schema 검증 (v0.2.0+)
acorn phase                       # 현재 phase 조회 (v0.7.0+)
acorn phase production --yes      # phase 변경 (v0.7.0+)
acorn config                      # 현재 설정 요약 (v0.3.0+)
acorn config guard.mode warn --yes       # guard 모드 변경 (v0.3.0+)
acorn config guard.patterns minimal --yes # 패턴 레벨 변경
acorn config provider.allow-custom true --yes # 사용자 정의 provider 의 install_cmd 실행 허용 (v0.9.5+)
acorn provider list               # builtin + 사용자 정의 provider 목록 (v0.9.5+)
acorn provider add ./my-tool.json # 사용자 정의 provider 등록 (v0.9.5+)
acorn migrate                     # v2 lock → v3 plan dry-run (v0.9.6+)
acorn migrate --auto --yes        # backup 후 v3 으로 atomic 쓰기 (v0.9.6+)
acorn config env.reset --yes             # settings.json 에서 env 3키 제거 (수동 재설치 전 정리)
```

**첫 설치 (harness.lock 이 없는 상태, v0.1.2+)**
- `acorn install` 가 `<harnessRoot>/harness.lock` 이 없다는 걸 감지하면,
  패키지 동봉 템플릿을 해당 경로에 시드하고 `[install/LOCK_SEEDED]` 에러로 중단한다
- 템플릿의 `commit` 필드는 40-zero placeholder 이므로 그대로 재실행하면 clone 은 되지만 checkout 에서 실패한다
- 각 tool 의 `commit` 을 실제 SHA 로 바꾼 뒤 `acorn install` 을 다시 실행

**install 플래그**
- `--mode=auto|guided|detect-only` — install 동작 모드 (v0.9.0+, v0.9.1 에서 `normal` → `auto` 리네임)
  - `auto` (기본): 실제 설치 실행 (provider clone/npx)
  - `guided`: project profile + recommendation + install plan 출력만, 변경 없음
  - `detect-only`: 현재 설치 상태 감지 결과만 출력
  - `normal` 은 v0.9.1+ deprecated alias (auto 로 매핑되며 stderr 안내)
- `--force` — 이전 `tx.log in_progress` 우회 (수동 검사 후 사용)
- `--skip-gstack-setup` — gstack setup 콜백 생략
- `--run-gstack-setup` — `<vendors/gstack>/setup --host auto` 자동 실행 (v0.1.1+) · `--skip` 과 상호 배타
- `--adopt` — 기존 수동 설치된 vendors/settings 을 비파괴 흡수 (v0.3.0+). non-git 디렉토리는 `<path>.pre-adopt-<ts>/` 로 이동 후 clone, settings 충돌 키는 `env.<key>.pre-adopt-<ts>` 로 이동 후 기대값 덮어쓰기. **v0.3.1+ B3**: destructive rename 이므로 TTY 에선 Y/n 프롬프트, non-TTY + `--yes` 미지정 시 `[install/ARGS]` USAGE 에러로 차단
- `--follow-symlink` — vendor 경로가 심링크면 target 의 HEAD 를 lock SHA 와 비교 (v0.3.0+). **v0.3.1+ B1**: 미지정 시 심링크를 만나면 `NOT_A_REPO` 로 fail-close (이전 v0.3.0 의 silent preserve 는 lock-as-truth 계약 위반이라 제거됨)
- `--yes` — destructive 플래그용 확인 프롬프트 스킵 (v0.3.1+, `--adopt` / `config` set 시 non-TTY/CI 에서 필수)

**preset 서브커맨드 (v0.9.0+)**
- `acorn preset` — 현재 preset 조회 (legacy phase 도 alias 로 자동 해석)
- `acorn preset list` — 4종 preset 정의 (starter/builder/frontend/backend) 와 capability 매핑 출력
- `acorn preset <name> [--yes]` — preset 전환. legacy alias 도 받음 (`prototype` → `starter`, `dev` → `builder`, `production` → `builder` + strict guard)
- preset 변경은 capability 활성화 집합과 phase.txt 를 함께 갱신 (CLAUDE.md 마커도 동기화)

**config 서브커맨드 (v0.3.0+)**
- `acorn config` — 현재 guard 설정 요약 (mode / patterns)
- `acorn config <key>` — key 의 현재 값 출력
- `acorn config guard.mode <block|warn|log> [--yes]` — 차단 모드 변경
- `acorn config guard.patterns <strict|moderate|minimal> [--yes]` — 패턴 세트 변경
- `acorn config env.reset [--yes]` — settings.json 의 env 3키 (`CLAUDE_PLUGIN_ROOT` / `OMC_PLUGIN_ROOT` / `ECC_ROOT`) 만 제거 (다른 키 보존)
- 모든 쓰기는 preflight 검증 → backup → atomic write → parseLock 재검증 + `tx.log` 기록 (v0.3.1+ B2)

**lock 서브커맨드 (v0.2.0+)**
- `acorn lock validate [path]` — `harness.lock` schema 검증 (read-only). CI 한 줄 gate 로 꽂기 좋음. **v0.4.3+**: SCHEMA 뿐 아니라 **PARSE** 실패도 exit 78 로 매핑돼 "lock 파일이 잘못됐다" 를 단일 exit 로 받는다

**list 커맨드 (v0.6.0+)**
- `acorn list` — `harness.lock` 에 기록된 tool 별로 **repo / SHA / 상태** 를 간결 나열. `status` 보다 단순 — 환경변수·심링크·guard 는 포함하지 않음. CI 에서 "tool SHA 빠르게 확인" 용
- `acorn list --json` — 기계 판독용 JSON. 예: `acorn list --json | jq -r '.tools[] | select(.state != "locked") | .tool'`
- Exit code: 모든 tool 이 `locked` 이면 0, 하나라도 `drift` / `missing` / `error` 면 1

**uninstall 커맨드 (v0.9.0+)**

install 의 역순 7단계 파이프라인. 모든 단계를 최선으로 수행하고 결과를 요약 출력한다.

```bash
acorn uninstall --yes   # 확인 없이 즉시 제거
acorn uninstall         # non-TTY 환경에서 --yes 없으면 USAGE 에러
```

제거 항목 (7단계):
1. `settings.json` env 키 (`CLAUDE_PLUGIN_ROOT` / `OMC_PLUGIN_ROOT` / `ECC_ROOT`) — 다른 키 보존
2. CLAUDE.md `ACORN:PHASE` 마커 블록 — 나머지 내용 보존
3. `~/.claude/skills/gstack` 심링크 — 실 디렉토리면 **건드리지 않음** (`not_a_symlink` 보고)
4. `hooks/guard-check.sh`
5. `.gstack-setup.sha` marker
6. `phase.txt`
7. `vendors/` 디렉토리 전체

보존 항목: `harness.lock`, `tx.log`, `backup/`, harness 루트 디렉토리 자체.

corrupt CLAUDE.md 마커가 있으면 제거를 건너뛰고 경고만 출력 (전체 언인스톨은 계속).

**요구사항**
- Node.js 24.x (`.nvmrc` 참고, `nvm use` 권장)
- bash (guard 훅 실행용 — Windows 는 Git Bash)
- jq 권장 (없으면 node 폴백)
- `git` (vendors clone 용)

**환경변수**
- `ACORN_HARNESS_ROOT` — harness 루트 (기본: `$CLAUDE_CONFIG_DIR/skills/harness` 또는 `~/.claude/skills/harness`)
- `CLAUDE_CONFIG_DIR` — Claude Code 설정 루트 (direnv 사용 시)
- `ACORN_GUARD_BYPASS=1` — guard 훅 우회. 셸 inline 형태 `ACORN_GUARD_BYPASS=1 <cmd>` 는 해당 `<cmd>` 1회에만 적용되고, `export ACORN_GUARD_BYPASS=1` 은 unset 할 때까지 **세션 전체**에서 guard 를 비활성화 (매 호출마다 stderr `⚠️ BYPASS ACTIVE` 반복, v0.3.5+ `acorn doctor` 가 critical 로 표시)
- `ACORN_GUARD_MODE=block|warn|log` — guard 모드 오버라이드
- `ACORN_ALLOW_ANY_REPO=1` — **v0.4.0+**: `harness.lock.tools.*.repo` allowlist 우회. fork·내부 미러·로컬 dev 용 escape hatch. 설정하지 않으면 acorn 은 hardcoded allowlist 를 강제 (§15 HIGH-2 / ADR-020)

**공급망 무결성 (v0.4.0+)**

- `harness.lock.tools.*.repo` 는 **hardcoded allowlist** 만 허용:
  - `omc: Yeachan-Heo/oh-my-claudecode`
  - `gstack: garrytan/gstack`
  - `ecc: affaan-m/everything-claude-code`

  악성 lock 파일이 공격자 저장소를 지정하지 못하도록 차단. Fork 시엔 `ACORN_ALLOW_ANY_REPO=1` 로 우회.
- npm 패키지는 **sigstore provenance** 로 서명되어 배포된다 (GitHub Actions OIDC). 사용자는 신뢰 검증 가능:
  ```bash
  npm audit signatures                        # 전체 의존성 검증
  npm view @dotoricode/acorn --provenance     # acorn 단독 빌드 출처 확인
  ```
  수동 `npm publish` 는 금지 (릴리스는 tag push → GitHub Actions 만).

  **npm publish 활성화 절차 (메인테이너용, 아직 활성화 전)**:
  1. npm 에 `@dotoricode` scope 생성 후 `@dotoricode/acorn` 패키지 초기화
  2. npm 에서 **Automation** 타입 토큰 발급 (https://www.npmjs.com/settings/<user>/tokens/new)
  3. GitHub repo Settings → Secrets and variables → Actions → **New repository secret**:
     - Name: `NPM_TOKEN`
     - Value: 발급한 Automation token
  4. 기존 tag (v0.6.1 등) 에 대해 workflow_dispatch 로 재실행하거나 다음 tag push 때 자동 진행
  5. `npm view @dotoricode/acorn` 으로 공개 확인
  6. 성공 후 `npm view @dotoricode/acorn --provenance` 로 sigstore attestation 확인

  `.github/workflows/publish.yml` 은 `NPM_TOKEN` secret 이 없으면 `ENEEDAUTH`
  로 안전하게 실패. 테스트/빌드 단계는 통과 상태를 유지한다.

> 머신 간 인계(Mac ↔ Windows)는 [docs/HANDOVER.md](docs/HANDOVER.md) 참조.

---

## Phase 시스템 (v0.7.0+)

> acorn 의 목표는 최고의 툴 조합을 설치하는 것이 아니라,
> 지금 어느 단계인지에 맞는 조합을 자동으로 구성하는 것이다.

`<harnessRoot>/phase.txt` 에 `prototype | dev | production` 중 하나를 기록해
guard 강제 수준과 CLAUDE.md 의 LLM 지침을 동기화한다.

| phase | guard 수준 | 설명 |
|---|---|---|
| `prototype` | minimal | 빠른 탐색 우선, catastrophic 만 차단 |
| `dev` | moderate | 표준 개발 (기본값) |
| `production` | strict | 모든 파괴적 패턴 차단 |

```bash
acorn phase                        # 현재 phase 조회
acorn phase production --yes       # production 으로 전환 (CLAUDE.md 자동 업데이트)
acorn phase dev                    # dev 로 복귀 (Y/n 확인)
```

**환경변수 우선순위**: `ACORN_GUARD_BYPASS` > `ACORN_PHASE_OVERRIDE` > `ACORN_GUARD_PATTERNS` > `phase.txt` > `harness.lock.guard.patterns` > 기본 `strict`.

---

## Exit code 규약

| code | 의미 |
|---|---|
| `0` | 성공 |
| `1` | 일반 실패 (drift, critical issue 등) |
| `64` | 사용법 오류 (알 수 없는 커맨드) |
| `75` | 재시도 가능 (tx.log in_progress — `--force` 로 재실행) |
| `78` | 설정 오류 (settings 충돌, lock 스키마) |

모든 에러는 `[area/code] 메시지` 프리픽스로 stderr 출력.
예: `[vendor/CLONE/omc]`, `[install/IN_PROGRESS]`, `[install/LOCK_SEEDED]`, `[lock/NOT_FOUND]`.

---

## 구성 모듈 (v0.9.0)

핵심 구현은 오케스트레이터(`commands/`) + 코어 모듈(`core/`) + 1개 훅 스크립트.
각 모듈은 독립적으로 import 가능하며 `GitRunner` 등 주요 외부 의존성은 주입식이다.

| 계층 | 모듈 | 역할 |
|---|---|---|
| CLI | `src/index.ts` | argv 라우팅 + exit code 매핑 + VERSION 런타임 로드 (v0.6.0+) |
| commands | `install.ts` | 9단계 preflight-우선 설치 파이프라인 |
| commands | `status.ts` | 읽기 전용 상태 요약 + JSON |
| commands | `list.ts` | lock 기준 tool/SHA/상태 간결 나열 (v0.6.0+) |
| commands | `doctor.ts` | 진단 + capability 이슈 + 이슈별 복구 힌트 (v0.9.0+ capability area 추가) |
| commands | `config.ts` | guard.mode / guard.patterns / env.reset 조작 (v0.3.0+) |
| commands | `phase.ts` | `acorn phase` 커맨드 — phase.txt + CLAUDE.md 동기화 (v0.7.0+) |
| core | `lock.ts` | harness.lock v2/v3 스키마 파싱 + allowlist. v3: capability/provider/preset (v0.9.0+) |
| core | `providers.ts` | v3 provider registry — gstack/superpowers/gsd/claudekit 메타데이터 (v0.9.0+) |
| core | `preset.ts` | preset 파싱 + canonical 이름 — starter/builder + legacy alias (v0.9.0+) |
| core | `provider-detect.ts` | provider 설치 여부 감지 (git-clone: dirExists, npx: commandExists) (v0.9.0+) |
| core | `provider-install.ts` | provider install plan 생성 + recommendation (v0.9.0+) |
| core | `qa-headless.ts` | qa_headless first-class guidance — 5 project types, provider 없어도 동작 (v0.9.0+) |
| core | `hooks.ts` | guard-check.sh 배포 + v3 hooksCapabilityStatus (v0.1.2+, v0.9.0+) |
| core | `env.ts` | 환경변수 3키 계산 + diff (v0.4.1+ 빈 문자열 fallback) |
| core | `settings.ts` | settings.json 멱등 머지 + 원자 쓰기 (v0.4.1+ BOM/fail-close) |
| core | `symlink.ts` | gstack 디렉토리 심링크 원자 교체 |
| core | `vendors.ts` | git clone + SHA 핀 + dirty 감지 + tool name guard (v0.5.0+) |
| core | `tx.ts` | install 트랜잭션 로그 (JSONL) |
| core | `time.ts` | 타임스탬프 단일 소스 (v0.5.1+, backup 디렉토리 공유) |
| core | `bom.ts` | UTF-8 BOM strip 단일 소스 (v0.4.1+) |
| core | `adopt.ts` | `--adopt` 의 pre-adopt rename (v0.3.0+) |
| core | `gstack-marker.ts` | gstack setup SHA marker (v0.1.3+ 멱등성) |
| core | `phase.ts` | phase.txt read/write/seed — prototype/dev/production (v0.7.0+) |
| core | `claude-md.ts` | ACORN:PHASE 마커 비파괴 주입 + backup + atomic write (v0.7.0+) |
| core | `sha-display.ts` | drift 메시지에서 lock vs 실제 SHA 구분 표시 |
| hook | `hooks/guard-check.sh` | PreToolUse 위험 커맨드 차단 |

---

## 아키텍처 상세 (Sprint 1~9)

### `src/commands/doctor.ts` — 진단 + 권장 조치 (Sprint 8)

`collectStatus()` 위에 FS 재검증과 액션 힌트를 얹어 issue 배열을 생성.

```ts
import { runDoctor, renderDoctor, renderDoctorJson } from '@dotoricode/acorn/commands/doctor';

const report = runDoctor();
console.log(renderDoctor(report));
if (!report.ok) process.exit(1);

// CI·외부 파이프라인용
const raw = renderDoctorJson(report);
```

출력 예 (이슈 발견):
```
acorn doctor  •  ~/.claude/skills/harness
발견된 이슈: critical=1 warning=1 info=0

⛔  [vendor] omc
   vendor 미설치: omc (기대 SHA 04655ee)
   → acorn install 을 실행하면 자동 clone

⚠️  [vendor] gstack
   gstack SHA 불일치 (lock=c6e6a21, 실제=abc1234)
   → 의도적 변경이면 harness.lock 갱신. 아니면 dirty 없음을 확인한 뒤 ...
```

각 이슈는 `{area, severity, subject, message, hint}` 구조로 — area 는
`vendor|env|symlink|tx|lock|settings`. `renderDoctorJson` 은 전체 리포트를 JSON 으로.

JSON 출력 상단에 CI 게이트용 편의 필드가 포함된다 (v0.2.0+):

```json
{
  "ok": false,
  "okCritical": true,
  "summary": { "critical": 0, "warning": 1, "info": 0 },
  "issues": [...]
}
```

- `ok`: critical + warning 없음
- `okCritical`: critical 만 기준 (warning 은 허용) — "경고는 로그만, 크리티컬만 fail" 패턴
- `summary`: severity 별 카운트 (한 줄 jq 필터 없이 바로 읽힘)

CI 한 줄 gate 예:
```bash
acorn doctor --json | jq -e '.okCritical' >/dev/null || exit 1
```

doctor 는 status 와 달리 다음을 추가 검사:
- vendor 디렉토리가 실제로 비어있지는 않은지
- vendor 가 dirty 상태인지 (`git status --porcelain`)
- 각 이슈별 구체적인 수동 복구 힌트

### `src/commands/status.ts` — 읽기 전용 상태 요약 (Sprint 7)

설치된 상태를 수정 없이 조회만 한다. lock/env/settings/symlink/vendors 리더만 호출.

```ts
import { collectStatus, renderStatus, summarize } from '@dotoricode/acorn/commands/status';

const report = collectStatus();
console.log(renderStatus(report));

const { ok, issues } = summarize(report);
if (!ok) process.exit(1);
```

출력 예 (v3 lock):
```
acorn v0.9.0  •  ~/.claude/skills/harness
────────────────────────────────────────────────────────────
  capabilities:
    hooks        ✅  provider-managed (claudekit)
    planning     ✅  gsd, superpowers
    tdd          ✅  gstack
    review       ✅  gstack
    qa_headless  ✅  first-class (provider 없어도 동작)
  preset: builder
  guard:  block / strict
```

출력 예 (v2 legacy lock):
```
acorn v0.9.0  •  ~/.claude/skills/harness
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

| vendor state | 의미 |
|---|---|
| `locked` | vendors/<tool> HEAD == harness.lock SHA |
| `drift` | HEAD가 lock과 다름 (실제 SHA도 함께 반환) |
| `missing` | 디렉토리 부재 |
| `error` | rev-parse 실패 등 |

`collectStatus()` 는 FS 를 건드리지 않으므로 스크립트에서 안전하게 호출 가능.
`summarize()` 는 `{ok, issues[]}` 로 CI 친화 요약 제공.

### Sprint 6.5 — 안정화 (3/10 + 6/10 마일스톤 회고 반영)

마일스톤 회고 에이전트 리뷰로 드러난 이슈를 Sprint 7 착수 전에 흡수.

- **vendors**: checkout 실패 시 partial clone 정리, git 명령어 120초 timeout,
  `readCurrentCommit()` 헬퍼, dirty working tree 감지 (`LOCAL_CHANGES` 에러)
- **symlink**: `createDirSymlink` 이 기존 심링크를 `rename` 으로 원자 교체 (TOCTOU 제거),
  `inspectGstackSymlink()` 헬퍼 추가 (status/doctor 용)
- **install**: 모든 단계를 `tx.log` 트랜잭션으로 감쌈. 이전 실행이 `commit` 이나 `abort` 없이
  중단된 경우 다음 `runInstall` 은 `IN_PROGRESS` 에러로 차단 (`--force` 로 우회)
- **settings**: `atomicWriteJson` rename 실패 시 tmp 파일 정리
- **paths 단일화**: `defaultHarnessRoot` / `defaultClaudeRoot` 를 `env.ts` 로 단일화,
  `CLAUDE_CONFIG_DIR` 존중 버그 수정 (direnv 환경에서 올바른 harness 루트 선택)
- **guard**: `push --force-with-lease` 는 차단 제외 (안전한 강제푸시 관용구)

테스트: 71 → 86개 (+15)

### `src/commands/install.ts` — 설치 오케스트레이터 (Sprint 6, v0.7.0 에서 9단계로 확장)

`harness.lock` 기반으로 세 툴을 검증된 SHA에 고정 설치하고, gstack 심링크,
CLAUDE.md phase 마커, `settings.json` env 3키를 **비파괴적으로** 구성한다.
내부 코어 모듈(`lock` / `env` / `symlink` / `settings` / `phase` / `claude-md`)과
`core/vendors.ts`를 조립한다.

```ts
import { runInstall, InstallError } from '@dotoricode/acorn/commands/install';

try {
  const r = runInstall({
    logger: (l) => console.log(l),
    // gstackSetup: ({ gstackSource, claudeRoot }) => { ... },  // 선택
  });
  // r.vendors.omc.action: 'cloned' | 'noop' | 'checked_out'
  // r.gstackSymlink.action: 'created' | 'noop' | 'replaced'
  // r.settings.action: 'add' | 'noop'
} catch (e) {
  if (e instanceof InstallError) {
    // e.code: 'IN_PROGRESS' | 'LOCK_SEEDED' | 'SETTINGS_CONFLICT' |
    //         'VENDOR' | 'SYMLINK' | 'GSTACK_SETUP' |
    //         'HOOKS_WRITE' | 'SETTINGS_WRITE'
  }
}
```

#### 실행 순서 (preflight 우선)

```
[1/9] harness.lock 파싱
[2/9] env 3키 계산
[3/9] settings.json 충돌 체크   ← 읽기 전용, 조기 실패
[4/9] vendors clone/checkout   (OMC, gstack, ECC)
[5/9] gstack 심링크
[6/9] gstack setup (콜백, 선택)
[7/9] hooks 배포                ← v0.1.2 신설 (ADR-017): guard-check.sh
[8/9] CLAUDE.md phase 마커 주입 ← v0.7.0 신설 (ADR-023): ACORN:PHASE 블록
[9/9] settings.json 원자 쓰기  ← 마지막, 백업 후
```

**핵심 불변식**: 충돌이 감지되면 디스크를 건드리기 전에 중단된다.
vendors clone은 [3/8] 통과 이후에만 시작한다. hooks 배포가 settings-write
직전에 있어서, settings.json 이 참조하는 `<harnessRoot>/hooks/guard-check.sh`
는 settings 가 활성화되는 순간 이미 디스크에 존재한다.

#### 멱등성

두 번째 `runInstall` 호출은 모든 단계가 `noop`이 된다.
머신 간 `git pull` 후 재실행해도 안전하다.

### `src/core/vendors.ts` — vendor clone + SHA 핀 (Sprint 6)

`harness.lock`의 `commit`에 정확히 고정하여 git 저장소를 clone/checkout 한다.
네트워크를 타지 않는 **의존성 주입용 `GitRunner` 인터페이스**를 제공해 단위 테스트는 stub으로 돌린다.

```ts
import { installVendor, defaultGitRunner, VendorError } from '@dotoricode/acorn/core/vendors';

const r = installVendor({
  tool: 'omc',   // v0.5.0+: /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/ 아니면 INVALID_TOOL_NAME
  repo: 'Yeachan-Heo/oh-my-claudecode', // v0.4.0+: allowlist (또는 ACORN_ALLOW_ANY_REPO=1)
  commit: '<40자 SHA>',
  vendorsRoot: '/path/to/harness/vendors',
});
// r.action: 'cloned' | 'noop' | 'checked_out' | 'adopted'
// VendorErrorCode (v0.5.0+): 'GIT_MISSING' | 'CLONE' | 'CHECKOUT' | 'REV_PARSE'
//                           | 'NOT_A_REPO' | 'SHA_MISMATCH' | 'LOCAL_CHANGES'
//                           | 'TIMEOUT' | 'INVALID_TOOL_NAME' | 'IO'
```

| 기존 상태 | 결과 |
|---|---|
| 없음 / 빈 폴더 | **cloned** (clone → checkout → rev-parse 검증) |
| 같은 SHA | **noop** (rev-parse만 실행) |
| 다른 SHA | **checked_out** (checkout → rev-parse 검증) |
| git 저장소 아님, `--adopt` 없음 | **NOT_A_REPO 에러** (자동 교체 거부). hint 는 `acorn install --adopt` 1차 제안 (v0.3.2+ S4) |
| git 저장소 아님, `--adopt` 있음 | **adopted** (`<path>.pre-adopt-<ts>/` 로 rename 후 clone, v0.3.0+) |
| 심링크, `--follow-symlink` 없음 | **NOT_A_REPO 에러** (v0.3.1+ B1 — 이전 v0.3.0 silent preserve 제거) |
| 심링크, `--follow-symlink` + HEAD 일치 | **adopted** (v0.3.0+) |
| 심링크, `--follow-symlink` + HEAD 불일치 | **preserved** + drift 경고 (v0.3.0+) |
| checkout 후 SHA 불일치 | **SHA_MISMATCH 에러** |

### `src/core/symlink.ts` — gstack 심링크 관리 (Sprint 5)

gstack은 절대경로를 하드코딩한 부분이 있어 npm/clone 방식 대신 **디렉토리 심링크**로 설치한다.
`<harness>/vendors/gstack/`을 `~/.claude/skills/gstack/`으로 링크.

```ts
import { installGstackSymlink, inspectSymlink, SymlinkError } from '@dotoricode/acorn/core/symlink';

const r = installGstackSymlink();
// r.action: 'created' | 'noop' | 'replaced'
// r.previousLink: 교체 전 링크 (replaced 인 경우)
```

#### 동작 매트릭스
| target 상태 | 결과 |
|---|---|
| 없음 | **created** (부모 디렉토리 자동 생성) |
| 정확한 심링크 | **noop** (멱등) |
| 다른 곳 가리키는 심링크 | **replaced** (이전 링크 정보 반환) |
| 일반 디렉토리/파일 | **NOT_SYMLINK 에러** — 자동 교체 거부 (사용자 데이터 보호) |

#### 안전 장치
- **원자적 생성**: `.tmp` 링크 → `rename` (도중 중단 시 target 보존)
- **NOT_SYMLINK 시 거부**: 사용자가 의도적으로 만든 디렉토리를 임의 삭제하지 않음
- **크로스 플랫폼**: macOS/Linux는 `dir`, Windows는 `junction` symlink type

### `src/core/settings.ts` — settings.json 멱등 머지 (Sprint 4)

`~/.claude/settings.json`(또는 `CLAUDE_CONFIG_DIR/settings.json`)에 env 3키를 **비파괴적으로** 머지한다.
재실행해도 같은 결과(멱등). 충돌 시 에러 + 중단, 파일 변경 없음.

```ts
import { installEnv, SettingsError } from '@dotoricode/acorn/core/settings';
import { computeEnv } from '@dotoricode/acorn/core/env';

try {
  const r = installEnv({ desired: computeEnv() });
  // r.action: 'add' | 'noop'
  // r.added: 추가된 키 목록
  // r.backupPath: 백업 파일 경로 (원본 부재 시 null)
} catch (e) {
  if (e instanceof SettingsError && e.code === 'CONFLICT') {
    // 기존 env 키가 다른 값 — 사용자가 직접 정리 필요
  }
}
```

#### 머지 동작 매트릭스
| 현재 상태 | 결과 |
|---|---|
| 키 없음 | **추가** |
| 같은 값 | **no-op** |
| 다른 값 | **CONFLICT 에러 + 중단** (비파괴) |

#### 안전 장치
- **원자적 쓰기**: 임시파일에 먼저 쓰고 `rename` (도중 중단되어도 원본 보존)
- **백업**: `<harness>/backup/{ISO8601}/settings.json.bak`로 복사 후 쓰기
- **CONFLICT 시 백업도 안 만듦**: 파일을 건드리지 않으므로 백업 불필요
- **기존 키 보존**: env 외 다른 섹션(theme 등)은 그대로 유지

### `src/core/env.ts` — 환경변수 계산 (Sprint 3)

`harness.lock`의 vendors 경로로부터 Claude Code에 주입할 환경변수 3키를 계산하고,
현재 `process.env`와의 차이를 분류한다.

```ts
import { computeEnv, diffEnv, isEnvFullyMatched } from '@dotoricode/acorn/core/env';

const expected = computeEnv();    // ACORN_HARNESS_ROOT 또는 기본 경로 사용
// {
//   CLAUDE_PLUGIN_ROOT: '~/.claude/skills/harness/vendors',
//   OMC_PLUGIN_ROOT:    '~/.claude/skills/harness/vendors/omc',
//   ECC_ROOT:           '~/.claude/skills/harness/vendors/ecc',
// }

const diff = diffEnv(expected);   // 각 키별 status: match | missing | mismatch
if (!isEnvFullyMatched(diff)) {
  // status / doctor 가 사용자에게 알려야 할 상태
}
```

| 키 | 용도 |
|---|---|
| `CLAUDE_PLUGIN_ROOT` | OMC + ECC 공통 플러그인 루트 |
| `OMC_PLUGIN_ROOT` | OMC 전용 |
| `ECC_ROOT` | ECC 전용 |

### `src/core/lock.ts` — harness.lock 파서 (Sprint 2)

`harness.lock` 파일을 읽고 schema 검증한 뒤 타입 안전한 객체로 반환한다.
모든 검증 실패는 `LockError`로 throw하며 `code` 필드로 원인을 구분한다.

```ts
import { readLock, getTool, LockError } from '@dotoricode/acorn/core/lock';

try {
  const lock = readLock();              // 기본: ~/.claude/skills/harness/harness.lock
  const omc = getTool(lock, 'omc');     // { repo, commit, verified_at }
  console.log(lock.guard.mode);         // 'block' | 'warn' | 'log'
} catch (e) {
  if (e instanceof LockError) {
    // e.code: 'NOT_FOUND' | 'PARSE' | 'SCHEMA' | 'IO'
  }
}
```

**검증 항목**
- `schema_version === 1` (불일치 시 SCHEMA 에러)
- `tools.{omc,gstack,ecc}` 3개 모두 존재
- 각 tool: `repo` (`owner/name`), `commit` (40자 SHA1), `verified_at` (`YYYY-MM-DD`)
- `guard.mode ∈ {block,warn,log}`, `guard.patterns ∈ {strict,moderate,minimal}`

**경로 우선순위**: 함수 인자 > `ACORN_HARNESS_ROOT` env > `~/.claude/skills/harness/`

### `hooks/guard-check.sh` — PreToolUse guard 훅 (Sprint 1)

Claude Code `PreToolUse` 훅으로 Bash 툴 실행을 인터셉트하여 위험 커맨드를 차단한다.

#### 설치 (수동, Sprint 6 `acorn install` 완성 전까지)

Claude Code `~/.claude/settings.json`에 훅을 등록:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/acorn/hooks/guard-check.sh"
          }
        ]
      }
    ]
  }
}
```

#### 차단 패턴 — `guard.patterns` 3단계 (v0.2.0+)

`harness.lock.guard.patterns` 에 따라 차단 범위가 결정된다 (§15 H1). `push --force-with-lease` 는 모든 레벨에서 항상 통과 (원격 상태 확인 후 강제 푸시하는 안전 관용구).

| patterns | 차단 대상 | 언제 쓰나 |
|---|---|---|
| **`strict`** (기본) | rm -rf, DROP/TRUNCATE, push --force/-f, reset --hard, chmod 777, fork bomb, mkfs, dd of=/dev/*, `> /dev/sda\|nvme` | AI 실수 최대 방어. 일상 실수까지 차단 |
| **`moderate`** | strict 에서 `push --force` 와 `reset --hard` 제외 (git 일상 허용). rm -rf, DROP TABLE, chmod -R 777, catastrophic 은 여전히 차단 | git 워크플로우 중심 개발 |
| **`minimal`** | fork bomb, mkfs, dd of=/dev/*, `> /dev/<drive>`, DROP DATABASE 만 (되돌릴 수 없는 hardware/catastrophic) | 개인 책임 하에 최소 안전망만 |

#### 환경변수

| 변수 | 동작 |
|---|---|
| `ACORN_GUARD_BYPASS=1` | guard 우회. 의미는 설정 방식에 따라 다름: **inline** `ACORN_GUARD_BYPASS=1 <cmd>` → `<cmd>` 1회만. **`export ACORN_GUARD_BYPASS=1`** → unset 할 때까지 세션 전체 (매 호출마다 stderr `⚠️ BYPASS ACTIVE` 반복, v0.3.5+ `acorn doctor` 가 critical 로 지적). |
| `ACORN_PHASE_OVERRIDE=prototype\|dev\|production` | phase.txt 무시하고 지정 phase 강제 (v0.7.0+) |
| `ACORN_GUARD_MODE=block\|warn\|log` | 모드 강제 지정 (lock 파일보다 우선) |
| `ACORN_GUARD_PATTERNS=strict\|moderate\|minimal` | 패턴 레벨 강제 지정 (phase 보다 우선, v0.2.0+) |
| `ACORN_HARNESS_ROOT=<path>` | harness 루트 경로 (기본: `~/.claude/skills/harness`) |

**우선순위** (patterns 결정 체계, v0.7.0+): `ACORN_GUARD_BYPASS` > `ACORN_PHASE_OVERRIDE` > `ACORN_GUARD_PATTERNS` > `phase.txt` > `harness.lock.guard.patterns` > 기본 `strict`

| 모드 | 동작 |
|---|---|
| `block` | exit 1, 커맨드 차단 (기본) |
| `warn` | stderr 경고 후 exit 0 |
| `log` | stderr 로그 후 exit 0 |

#### 파싱 실패 = 차단 (fail-close)

훅은 stdin JSON을 `fd 0` 방식(`readFileSync(0)`)으로 읽는다.
JSON 파싱이 실패하면 **반드시 차단**한다 (fail-open 아님).

#### 수동 테스트 예시

```bash
# 정상 — exit 0
echo '{"tool_input":{"command":"ls -la"}}' | hooks/guard-check.sh

# 차단 — exit 1
echo '{"tool_input":{"command":"rm -rf /tmp/foo"}}' | hooks/guard-check.sh

# 우회 — exit 0, stderr 경고
echo '{"tool_input":{"command":"rm -rf /tmp/foo"}}' | ACORN_GUARD_BYPASS=1 hooks/guard-check.sh

# 파싱 실패 — exit 1 (fail-close)
echo 'not json' | hooks/guard-check.sh
```

---

## 트러블슈팅

### Node 24 전환 후 `npm` 링크 오류
`brew link --overwrite node@24` 시 `/usr/local/lib/node_modules/npm` 충돌이 나면:
```bash
sudo rm -rf /usr/local/lib/node_modules/npm && brew link --overwrite node@24
```

### Windows Git Bash에서 훅이 fail-open 발생
`/dev/stdin` 방식은 Windows Git Bash에서 빈 stdin을 반환한다.
`guard-check.sh`는 이를 피하기 위해 `cat` + node `fd 0` 방식을 사용한다.
문제 발생 시 node 또는 jq가 PATH에 있는지 확인.

### guard가 의도치 않게 커맨드를 막을 때
1. 안전한 커맨드라면 **inline** `ACORN_GUARD_BYPASS=1 <cmd>` 로 그 호출만 우회 (셸 export 금지 — `export` 하면 세션 전체 비활성이라 `acorn doctor` critical)
2. 패턴이 너무 공격적이라면 `ACORN_GUARD_MODE=warn` 으로 강등 (또는 v0.3.0+ `acorn config guard.mode warn`)
3. 근본 해결은 패턴 조정 — `hooks/guard-check.sh` 의 `is_dangerous()` 함수 수정

### Windows 에서 `--follow-symlink` 가 작동하지 않음 (v0.5.0 에서 해소)
v0.4.x 이하: Node 24 Windows 의 `existsSync(junction)` 이 `false` 를 반환하던
버그로 `installVendor` 가 junction 을 "부재" 로 오판해 `--follow-symlink`
handling 경로가 실행되지 않았다. **v0.5.0 에서 `lstatSync` 기반 `probePath`
로 교체해 해소.** dev 레포를 `~/.claude/skills/harness/vendors/<tool>` 에
junction/symlink 로 걸어놓고 `acorn install --follow-symlink` 로 HEAD drift
를 감지하는 워크플로우가 Windows 에서도 동작한다.

### `mklink /J` / PowerShell `New-Item -ItemType Junction` 으로 만든 junction 감지
acorn 내부는 `fs.symlinkSync(target, path, 'junction')` (Node API) 로 junction
을 생성하는데, 이걸로 만든 junction 은 `lstat.isSymbolicLink()` 가 `true`.
반면 **`mklink /J` (cmd.exe) 와 PowerShell `New-Item -ItemType Junction` 으로
만든 junction 은 Node `lstat` 에서 `isSymbolicLink: false`** 로 보고한다
(Round 3 도그푸딩 F2). acorn production 경로는 Node API 를 쓰므로 영향 없지만,
사용자가 cmd/PowerShell 로 dev 레포를 수동 junction 하려면 Node 기반으로
생성하거나 Developer Mode 활성 상태에서 `fs.symlinkSync` 사용 권장.

### 기타: Node 24 의 EPERM symlinkSync 로 Windows 테스트 18건 실패
프로젝트 테스트 중 symlink 관련 18건은 Windows 개발자 모드가 꺼져 있으면
EPERM 으로 실패한다. CI Linux 에서는 전부 통과 (v0.4.2 이후 `publish.yml`
CI 그린 유지). 로컬 테스트 실패가 실 버그는 아님.

---

## 로드맵

v0.1.0 Radical MVP — 10 스프린트 (상세: `docs/acorn-v1-plan.md` §4): ✅ 완료

v0.9.x — capability-first 모델 도입:

| Sprint | 산출물 | 상태 |
|---|---|---|
| 01 | lock.ts schema_version 3 타입 + 파싱 | ✅ 완료 |
| 02 | provider registry + detect + install plan | ✅ 완료 |
| 03 | recommendation engine (project profile 추론) | ✅ 완료 |
| 04 | guided install mode (v3 lock 기반) | ✅ 완료 |
| 05 | preset layer (starter/builder, legacy alias) | ✅ 완료 |
| 06 | status/doctor — capability 중심 상태 확인 | ✅ 완료 |
| 07 | hooks v3 provider-managed + qa_headless first-class | ✅ 완료 |
| 08 | docs migration — capability-first README/CLAUDE.md/template | ✅ 완료 |
| 09 | provider install 파이프라인 연결 | ⏳ 예정 |

---

## 라이선스

MIT © dotoricode
