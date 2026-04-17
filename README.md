# acorn

Claude Code 하네스 엔지니어링 툴(OMC, gstack, ECC) 통합 관리 CLI.

> **Status**: v0.3.2 — v0.3.1 hotfix (4-agent 검토 blocker 4건) + v0.3.2 quick-sweep (S3/S4/S5)
> **일상 사용법**: [`docs/USAGE.md`](docs/USAGE.md) ← 처음이면 여기부터
> 설계 문서: [`docs/acorn-v1-plan.md`](docs/acorn-v1-plan.md)
> 변경 이력: [`CHANGELOG.md`](CHANGELOG.md)

---

## 개요

Claude Code 하네스 생태계의 세 툴(OMC / gstack / ECC)을 **검증된 SHA 조합**으로 격리 설치하고,
위험 커맨드를 차단하는 guard 훅을 함께 제공한다.

- **격리 우선** — `~/.claude/skills/harness/` 단일 위치 관리
- **버전 고정** — `harness.lock`에 기록된 SHA만 사용
- **fail-close** — 파싱/실행 실패 시 허용이 아닌 차단
- **비파괴적** — `settings.json` 멱등 머지, 충돌 시 백업 후 중단

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
acorn install                     # harness.lock 기준 설치
acorn install --run-gstack-setup  # + gstack setup --host auto 자동 실행
acorn status                      # 3툴 + guard + env 요약
acorn doctor                      # 이슈 + 수동 복구 힌트
acorn status --json               # 기계 판독
acorn lock validate               # harness.lock schema 검증 (v0.2.0+)
acorn config                      # 현재 설정 요약 (v0.3.0+)
acorn config guard.mode warn --yes       # guard 모드 변경 (v0.3.0+)
acorn config guard.patterns minimal --yes # 패턴 레벨 변경
acorn config env.reset --yes             # settings.json 에서 env 3키 제거 (수동 재설치 전 정리)
```

**첫 설치 (harness.lock 이 없는 상태, v0.1.2+)**
- `acorn install` 가 `<harnessRoot>/harness.lock` 이 없다는 걸 감지하면,
  패키지 동봉 템플릿을 해당 경로에 시드하고 `[install/LOCK_SEEDED]` 에러로 중단한다
- 템플릿의 `commit` 필드는 40-zero placeholder 이므로 그대로 재실행하면 clone 은 되지만 checkout 에서 실패한다
- 각 tool 의 `commit` 을 실제 SHA 로 바꾼 뒤 `acorn install` 을 다시 실행

**install 플래그**
- `--force` — 이전 `tx.log in_progress` 우회 (수동 검사 후 사용)
- `--skip-gstack-setup` — gstack setup 콜백 생략
- `--run-gstack-setup` — `<vendors/gstack>/setup --host auto` 자동 실행 (v0.1.1+) · `--skip` 과 상호 배타
- `--adopt` — 기존 수동 설치된 vendors/settings 을 비파괴 흡수 (v0.3.0+). non-git 디렉토리는 `<path>.pre-adopt-<ts>/` 로 이동 후 clone, settings 충돌 키는 `env.<key>.pre-adopt-<ts>` 로 이동 후 기대값 덮어쓰기. **v0.3.1+ B3**: destructive rename 이므로 TTY 에선 Y/n 프롬프트, non-TTY + `--yes` 미지정 시 `[install/ARGS]` USAGE 에러로 차단
- `--follow-symlink` — vendor 경로가 심링크면 target 의 HEAD 를 lock SHA 와 비교 (v0.3.0+). **v0.3.1+ B1**: 미지정 시 심링크를 만나면 `NOT_A_REPO` 로 fail-close (이전 v0.3.0 의 silent preserve 는 lock-as-truth 계약 위반이라 제거됨)
- `--yes` — destructive 플래그용 확인 프롬프트 스킵 (v0.3.1+, `--adopt` / `config` set 시 non-TTY/CI 에서 필수)

**config 서브커맨드 (v0.3.0+)**
- `acorn config` — 현재 guard 설정 요약 (mode / patterns)
- `acorn config <key>` — key 의 현재 값 출력
- `acorn config guard.mode <block|warn|log> [--yes]` — 차단 모드 변경
- `acorn config guard.patterns <strict|moderate|minimal> [--yes]` — 패턴 세트 변경
- `acorn config env.reset [--yes]` — settings.json 의 env 3키 (`CLAUDE_PLUGIN_ROOT` / `OMC_PLUGIN_ROOT` / `ECC_ROOT`) 만 제거 (다른 키 보존)
- 모든 쓰기는 preflight 검증 → backup → atomic write → parseLock 재검증 + `tx.log` 기록 (v0.3.1+ B2)

**lock 서브커맨드 (v0.2.0+)**
- `acorn lock validate [path]` — `harness.lock` schema 검증 (read-only). CI 한 줄 gate 로 꽂기 좋음. 실패 시 exit 78

**요구사항**
- Node.js 24.x (`.nvmrc` 참고, `nvm use` 권장)
- bash (guard 훅 실행용 — Windows 는 Git Bash)
- jq 권장 (없으면 node 폴백)
- `git` (vendors clone 용)

**환경변수**
- `ACORN_HARNESS_ROOT` — harness 루트 (기본: `$CLAUDE_CONFIG_DIR/skills/harness` 또는 `~/.claude/skills/harness`)
- `CLAUDE_CONFIG_DIR` — Claude Code 설정 루트 (direnv 사용 시)
- `ACORN_GUARD_BYPASS=1` — guard 훅 1회 우회
- `ACORN_GUARD_MODE=block|warn|log` — guard 모드 오버라이드

> 머신 간 인계(Mac ↔ Windows)는 [docs/HANDOVER.md](docs/HANDOVER.md) 참조.

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

## 구성 모듈 (v0.1.0)

핵심 구현은 크게 3개 오케스트레이터(`commands/`) + 6개 코어 모듈(`core/`) + 1개 훅 스크립트.
각 모듈은 독립적으로 import 가능하며 `GitRunner` 등 주요 외부 의존성은 주입식이다.

| 계층 | 모듈 | 역할 |
|---|---|---|
| CLI | `src/index.ts` | argv 라우팅 + exit code 매핑 |
| commands | `install.ts` | 8단계 preflight-우선 설치 파이프라인 |
| commands | `status.ts` | 읽기 전용 상태 요약 + JSON |
| commands | `doctor.ts` | 진단 + 이슈별 복구 힌트 |
| core | `lock.ts` | harness.lock 스키마 검증 |
| core | `env.ts` | 환경변수 3키 계산 + diff |
| core | `settings.ts` | settings.json 멱등 머지 + 원자 쓰기 |
| core | `symlink.ts` | gstack 디렉토리 심링크 원자 교체 |
| core | `vendors.ts` | git clone + SHA 핀 + dirty 감지 |
| core | `tx.ts` | install 트랜잭션 로그 (JSONL) |
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

출력 예:
```
acorn v0.3.2  •  ~/.claude/skills/harness
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

### `src/commands/install.ts` — 설치 오케스트레이터 (Sprint 6)

`harness.lock` 기반으로 세 툴을 검증된 SHA에 고정 설치하고, gstack 심링크와
`settings.json` env 3키를 **비파괴적으로** 구성한다.
내부 코어 4개 모듈(`lock` / `env` / `symlink` / `settings`)과 신규 `core/vendors.ts`를 조립한다.

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
    // e.code: 'SETTINGS_CONFLICT' | 'VENDOR' | 'SYMLINK' | 'GSTACK_SETUP' | 'SETTINGS_WRITE'
  }
}
```

#### 실행 순서 (preflight 우선)

```
[1/8] harness.lock 파싱
[2/8] env 3키 계산
[3/8] settings.json 충돌 체크   ← 읽기 전용, 조기 실패
[4/8] vendors clone/checkout   (OMC, gstack, ECC)
[5/8] gstack 심링크
[6/8] gstack setup (콜백, 선택)
[7/8] hooks 배포                ← v0.1.2 신설 (ADR-017): guard-check.sh
[8/8] settings.json 원자 쓰기  ← 마지막, 백업 후
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
  tool: 'omc',
  repo: 'org/omc',
  commit: '<40자 SHA>',
  vendorsRoot: '/path/to/harness/vendors',
});
// r.action: 'cloned' | 'noop' | 'checked_out' | 'adopted' | 'preserved'
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
| `ACORN_GUARD_BYPASS=1` | 세션 내 전체 우회. 매 실행마다 stderr에 경고 출력. |
| `ACORN_GUARD_MODE=block\|warn\|log` | 모드 강제 지정 (lock 파일보다 우선) |
| `ACORN_GUARD_PATTERNS=strict\|moderate\|minimal` | 패턴 레벨 강제 지정 (lock 파일보다 우선, v0.2.0+) |
| `ACORN_HARNESS_ROOT=<path>` | harness 루트 경로 (기본: `~/.claude/skills/harness`) |

우선순위: **env > `harness.lock.guard.*` > default (`mode=block`, `patterns=strict`)**

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
1. 안전한 커맨드라면 `ACORN_GUARD_BYPASS=1 <cmd>`로 1회 우회
2. 패턴이 너무 공격적이라면 `ACORN_GUARD_MODE=warn`으로 강등
3. 근본 해결은 패턴 조정 — `hooks/guard-check.sh`의 `is_dangerous()` 함수 수정

---

## 로드맵

v0.1.0 Radical MVP — 10 스프린트 (상세: `docs/acorn-v1-plan.md` §4)

| Sprint | 산출물 | 상태 |
|---|---|---|
| 0 | Node 24 LTS 전환, TS 안정성 | ✅ 완료 |
| 1 | `hooks/guard-check.sh` | ✅ 완료 |
| 2 | `src/core/lock.ts` | ✅ 완료 |
| 3 | `src/core/env.ts` | ✅ 완료 |
| 4 | `src/core/settings.ts` | ✅ 완료 |
| 5 | `src/core/symlink.ts` | ✅ 완료 |
| 6 | `src/commands/install.ts` + `src/core/vendors.ts` | ✅ 완료 |
| 7 | `src/commands/status.ts` | ✅ 완료 |
| 8 | `src/commands/doctor.ts` | ✅ 완료 |
| 9 | `src/index.ts` (CLI 라우터) | ✅ 완료 |
| 10 | README 정비 + CI placeholder | ✅ 완료 |

---

## 라이선스

MIT © dotoricode
