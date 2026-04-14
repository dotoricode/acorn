# acorn

Claude Code 하네스 엔지니어링 툴(OMC, gstack, ECC) 통합 관리 CLI.

> **Status**: v0.1.0 개발 중 (Radical MVP).
> 설계 문서: [`docs/acorn-v1-plan.md`](docs/acorn-v1-plan.md)

---

## 개요

Claude Code 하네스 생태계의 세 툴(OMC / gstack / ECC)을 **검증된 SHA 조합**으로 격리 설치하고,
위험 커맨드를 차단하는 guard 훅을 함께 제공한다.

- **격리 우선** — `~/.claude/skills/harness/` 단일 위치 관리
- **버전 고정** — `harness.lock`에 기록된 SHA만 사용
- **fail-close** — 파싱/실행 실패 시 허용이 아닌 차단
- **비파괴적** — `settings.json` 멱등 머지, 충돌 시 백업 후 중단

---

## 설치

v0.1.0은 아직 npm publish 전이며 git 태그 기반 사설 배포다.

```bash
git clone https://github.com/dotoricode/acorn.git
cd acorn
npm install
npm run build
```

**요구사항**
- Node.js 24.x (`.nvmrc` 참고, `nvm use` 권장)
- bash (guard 훅 실행용)
- jq 권장 (없으면 node 폴백)

---

## 현재 구현된 기능 (Sprint 1~3 완료)

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

#### 차단 패턴

기본(block) 모드에서 다음 패턴이 포함된 커맨드는 exit 1로 차단된다.

| 카테고리 | 패턴 |
|---|---|
| 재귀 삭제 | `rm -rf`, `rm -fr`, `rm -Rf` |
| DB 파괴 | `DROP TABLE`, `DROP DATABASE`, `TRUNCATE TABLE` |
| git 강제 | `push --force`, `push -f`, `push --force-with-lease`, `reset --hard` |
| 권한 개방 | `chmod 777`, `chmod -R 777` |
| 시스템 파괴 | fork bomb, `mkfs`, `dd of=/dev/*`, `> /dev/sda\|nvme` |

#### 환경변수

| 변수 | 동작 |
|---|---|
| `ACORN_GUARD_BYPASS=1` | 세션 내 전체 우회. 매 실행마다 stderr에 경고 출력. |
| `ACORN_GUARD_MODE=block\|warn\|log` | 모드 강제 지정 (lock 파일보다 우선) |
| `ACORN_HARNESS_ROOT=<path>` | harness 루트 경로 (기본: `~/.claude/skills/harness`) |

모드 우선순위: **env > `harness.lock.guard.mode` > default `block`**

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
| 4 | `src/core/settings.ts` | 🔲 |
| 5 | `src/core/symlink.ts` | 🔲 |
| 6 | `src/commands/install.ts` | 🔲 |
| 7 | `src/commands/status.ts` | 🔲 |
| 8 | `src/commands/doctor.ts` | 🔲 |
| 9 | `src/index.ts` (CLI 라우터) | 🔲 |
| 10 | README 정비 + CI placeholder | 🔲 (본 문서 초안) |

---

## 라이선스

MIT © dotoricode
