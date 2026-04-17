# Changelog

모든 주목할 변경 사항을 기록한다.
[Keep a Changelog](https://keepachangelog.com/) 포맷, [SemVer](https://semver.org/).

## [0.4.1] — 2026-04-18

🟠 **Codex review (2026-04-18) 5건 fail-close 복원**. v0.4.0 직후 외부
검토가 식별한 10건 중 즉시 대응 가치가 있는 P0 5건 (empty-string env,
malformed env silent overwrite, BOM 비대칭, diffEnv self-compare,
TOCTOU `SyntaxError` leak) 을 v0.4.1 patch 로 해소. 나머지 5건은
v0.4.2 (path traversal, shell:win32) / v0.5+ (tx ID, junction test) /
부채 기록 (SKILL.md 하드코드) 로 분류. 테스트 218 → 233 (+15).

### Fixed

- **§15 v0.4.1 #3 / `src/core/env.ts`**: `defaultClaudeRoot` /
  `defaultHarnessRoot` 의 `??` 를 빈 문자열도 fallback 하도록 교정.
  `CLAUDE_CONFIG_DIR=''` / `ACORN_HARNESS_ROOT=''` 로 실행 시 `join('',
  'skills', 'harness')` 가 상대경로가 되어 CWD 아래에 settings/lock/
  tx.log/vendor 를 쓰던 silent 오염 차단. `envOrDefault` 헬퍼 한 곳에서
  nullish + empty-string 둘 다 처리.
- **§15 v0.4.1 #2 / `src/core/settings.ts` + `src/commands/config.ts`**:
  `env` 섹션이 `object` 가 아닌 경우 (null / array / scalar) 조용히
  빈 섹션으로 코어스하던 `getEnvSection` 을 **fail-close** 로 교정.
  이전에는 `planMerge` 가 모든 키를 missing 으로 보고 `mergeEnv` 가
  사용자 설정을 덮어써 유실됐다. 이제 `SettingsError(PARSE)` throw.
  `config env.reset` 도 동일 증상을 `ConfigError(SCHEMA)` 로 교정 —
  이전엔 "removedKeys: []" fake no-op 반환.
- **§15 v0.4.1 #4 / `src/core/settings.ts`**: `readSettings` 가 UTF-8
  BOM 을 선두에서 제거하도록 추가. 이전엔 `parseLock` 에만 있어 Windows
  에디터가 `settings.json` 을 BOM 포함 저장하면 PARSE 에러로 탈락.
  중복 로직을 `src/core/bom.ts` 공용 헬퍼로 통합 (lock.ts / config.ts /
  settings.ts 3곳 single source).
- **§15 v0.4.1 #5 / `src/commands/status.ts`**: `collectStatus` 의
  `runtimeEnv` 미지정 시 `diffEnv(desired, desired)` self-compare 로
  "모두 match" fake 반환하던 거짓 계약 제거. 이제 빈 배열 (`envRuntime =
  []`) 반환 — "runtime 체크 요청 안 함" 의미. 라이브러리 호출자가
  자기도 모르게 green 을 받던 경로 차단. CLI 경로 (`index.ts`) 는
  이미 `runtimeEnv: process.env` 명시 전달 중이라 사용자 체감 변화 없음.
- **§15 v0.4.1 #9 / `src/commands/config.ts`**: `setGuardField` 의 두
  번째 `readFileSync + JSON.parse` 를 `try/catch` 로 감싸 파일 손상
  시 `ConfigError(SCHEMA)` 로 번역. 이전엔 bare `SyntaxError` 가
  `exitFor` 의 exit-code 매핑 (`CONFIG=2`) 을 우회해 `FAILURE=1` 로
  새어나감. `parseLock` 재검증 경로의 `LockError` 도 동일하게 번역.
  첫 `readLock` 과 두 번째 read 사이 TOCTOU 손상 방어.

### Added

- **`src/core/bom.ts`** (신규): UTF-8 BOM 제거 헬퍼 단일 소스. lock /
  config / settings 3 곳 재사용.
- 회귀 테스트 +15: bom 4, env 2 (empty-string), settings 5 (malformed
  + BOM), config 2 (malformed env.reset + TOCTOU), status 2
  (runtimeEnv contract).

### Deferred (부채 기록)

- **P1 / v0.4.2 예정**: `installVendor` 의 `tool` 경로 traversal guard
  (codex #1), `defaultGstackSetup` Windows `shell:true` 제거 (codex #7).
- **P2 / v0.5+**: `tx.ts` transaction ID 도입 — 한 corrupt 라인이
  영구 IN_PROGRESS 유발하는 §15 H3 트레이드오프 재설계 (codex #6,
  ADR-021 예정). Windows 테스트 `symlinkSync(..., 'dir')` → junction
  전환으로 EPERM 18건 해소 (codex #10, checkpoint 🟡#6 와 합본).
- **부채 기록만**: `verifyGstackSetupArtifacts` 의 `SKILL.md` 하드
  코드 (codex #8) — SHA 락 전제상 silent false-negative 경로 없음.

## [0.4.0] — 2026-04-18

🟠 v0.4.x queue 의 마지막 항목 **HIGH-2 공급망 무결성** 을 "lite" 스코프
(allowlist + provenance CI, sha256 pinning 은 v0.5+ 연기) 로 완주.
설계 결정은 ADR-020 에 명시. allowlist 가 fork 사용자에게 breaking
가능성이 있어 patch 가 아닌 **minor bump**.

v0.3.0 (§15 §S3/S4) → v0.3.1 (4-agent blocker) → v0.3.2 (quick sweep) →
v0.3.3 (docs 전역 현행화) → v0.3.4 (H-3/H-1 silent-lie 제거) →
v0.3.5 (HIGH-3 lite) → **v0.4.0 (HIGH-2 lite) — 4-agent 검토 🔴🟠 전체
해소 완료**.

### Added

- **§15 HIGH-2 / ADR-020 (1) / `harness.lock.tools.*.repo` allowlist**:
  `src/core/lock.ts` 에 `ALLOWED_REPOS` hardcoded map 추가. `parseLock`
  이 각 tool 의 repo 를 allowlist 와 대조해 미승인 저장소는 SCHEMA
  에러로 차단. 방어 대상: dotfiles 리포 탈취 후 악성 lock 교체로 공격자
  저장소 clone 유도. 허용 목록: `omc: Yeachan-Heo/oh-my-claudecode`,
  `gstack: garrytan/gstack`, `ecc: affaan-m/everything-claude-code`.
- **`ACORN_ALLOW_ANY_REPO=1` escape hatch**: 환경변수로 allowlist 우회.
  fork, 내부 미러, 로컬 dev 용. SCHEMA 에러 메시지가 직접 이 변수
  사용법을 안내.
- **§15 HIGH-2 / ADR-020 (2) / `.github/workflows/publish.yml`**: tag
  `v*.*.*` push 시 GitHub Actions 가 `npm publish --provenance` 로
  sigstore OIDC 서명 attestation 과 함께 배포. 계정 탈취 공격 표면을
  repo commit 권한까지 (2-hop) 로 격상. 사용자는 `npm audit signatures`
  또는 `npm view @dotoricode/acorn --provenance` 로 빌드 출처 확인
  가능. 수동 `npm publish` 는 금지 (tag → GH Actions 만).

### Docs

- **`ADR-020` (acorn-v1-plan.md §11)**: 공급망 무결성 결정 3조각 분해
  (allowlist 구현 / provenance CI 구현 / sha256 pinning v0.5+ 연기) +
  각각의 trade-off 및 선택 이유 명문화.
- **`ADR-019` 말미 H-3 개정 노트**: v0.3.4 이후 `'preserved'` action 이
  unreachable 임을 명기.
- **`README.md` 공급망 무결성 섹션 신설**: allowlist 3-tool 노출,
  `ACORN_ALLOW_ANY_REPO` 사용법, `npm audit signatures` / `npm view
  --provenance` 검증 예시, 수동 publish 금지 명기.

### Changed

- `harness.lock.tools.*.repo` 형식 검증이 strict 해짐: regex 패턴 통과 +
  allowlist 통과 필요. **Breaking 가능성**: fork 사용자는
  `ACORN_ALLOW_ANY_REPO=1` 을 설정하거나 lock 의 repo 를 upstream 으로
  복구해야 함. minor bump 로 반영.

### Testing

- 218 단위 테스트 (v0.3.5 의 215 + allowlist pass/reject/escape 3건).
  기존 fixture 가 가짜 repo ("org/omc", "a/b") 를 쓰는 6 test file
  (install / status / cli / guard-hook / doctor / config) 에는 파일
  상단 `process.env['ACORN_ALLOW_ANY_REPO'] = '1'` 설정 — 실전 escape
  용도와 같은 패턴이라 production code path 는 건드리지 않음. Windows
  18 실패는 기존 `symlinkSync` EPERM 그대로. Mac 기준 218/218 예상.

### Deferred to v0.5+

- **sha256 pinning of shipped files** (hooks/guard-check.sh 등): narrow
  threat model (bundled trusted, deployed only 의심 — global npm +
  user-owned harness 에서만 유효) 과 moderate 구현 비용 대비 cost/benefit
  부족. v0.5+ 에서 integration test (ARCH-R1) 와 함께 재평가.
- 🟡 v1.0 전 부채 6건 (core/adopt+sha-display 흡수, InstallErrorCode
  naming 통일, integration test, isoTs 중복, 백업 ts 단일화, Windows
  junction 이슈 재검증).
- 🟢 Round 3 도그푸딩 — v0.3.x+v0.4.0 신기능 실증.
- 🆕 `acorn uninstall` / `acorn list` / `acorn lock bump` 같은 미구현
  user 커맨드.

## [0.3.5] — 2026-04-18

🟠 v0.4.x 큐 중 HIGH-3 (`ACORN_GUARD_BYPASS` 재설계) 를 "lite" 형태로
v0.3.x 내 patch 로 정리. 코드 재설계 (nonce / PID / TTL) 없이
**문서 truth + doctor 감지** 만으로 critic 의 실 요구 (사용자가
세션 bypass 상태를 쉽게 알아챌 수 있어야 함) 를 충족.

재설계 대신 lite 를 택한 이유: guard 의 adversary 는 AI (Claude Code)
이지 user 가 아니다. user authority 모델에선 cryptographic nonce 는
과설계이고, shell semantics 상 `VAR=val cmd` (inline) 와 `export VAR=val`
(session) 은 hook 이 구분할 수 없다. 따라서 honest docs + visible
diagnostic 이 올바른 교정.

### Docs

- **§15 HIGH-3 lite / `README.md` ACORN_GUARD_BYPASS 의미 명확화**:
  README 가 "1회 우회" (환경변수 섹션) 와 "세션 내 전체 우회" (guard
  환경변수 표) 를 동시에 주장하던 내부 모순 해소. inline vs export
  두 시나리오를 3곳 (환경변수 섹션, guard 표, 트러블슈팅) 일관 명시.
  트러블슈팅의 "1회 우회" → "inline 만 쓰고 export 하지 말 것" 으로
  강화.

### Added

- **§15 HIGH-3 lite / `acorn doctor` 의 BYPASS 세션 감지**: `DoctorArea`
  에 `'guard'` 추가. `runDoctor` 가 `opts.runtimeEnv.ACORN_GUARD_BYPASS
  === '1'` 감지 시 critical-severity 이슈로 노출. `issues` 배열 맨
  앞에 삽입해 `renderDoctor` 출력 상단에 표시 — "guard 비활성" 상태가
  다른 이슈에 묻히지 않도록. hint 는 두 복구 경로 (session unset /
  inline 으로 전환) 모두 안내. `runtimeEnv` 미제공 시 (기존 테스트
  caller) skip — backward compat 유지.

### Testing

- 215 단위 테스트 (v0.3.4 의 212 + HIGH-3 lite doctor 3). Mac 기준 전부
  pass 예상. Windows 18 실패는 기존 `symlinkSync` EPERM 그대로.

### Deferred to v0.4.0

🟠 HIGH-2 (공급망 sha256 pinning + `lock.repo` allowlist + npm
`--provenance`) 가 남은 유일한 🟠 항목. 설계 결정 3건 선행 필요 (ADR-020
예정): pinning 대상 파일 선정, allowlist schema 범위, CI 파이프라인
(GitHub Actions OIDC). v0.4.0 은 `acorn uninstall` 같은 새 user 기능과
결합한 정식 minor bump 로 진행 권장.

🟡 v1.0 전 부채 6건 + 🟢 Round 3 도그푸딩 유지.

## [0.3.4] — 2026-04-17

🟠 v0.4.x 큐 중 코드 하드닝 2건 (H-3 / H-1) 을 v0.3.x 내 patch 로
선공급. 기능 추가 없음, silent-lie 제거와 warning 노출 강화에 집중.
HIGH-2 (공급망 sha256 pinning) / HIGH-3 (ACORN_GUARD_BYPASS 재설계) 은
설계 결정 필요해 v0.4.0 에 별도.

### Fixed

- **§15 H-3 / `--follow-symlink` revParse silent 흡수 제거**: v0.3.1
  B1 으로 "`--follow-symlink` 없이 심링크를 만나면 `NOT_A_REPO` 로
  fail-close" 는 됐으나, `--follow-symlink` 자체의 성공 경로가 여전히
  silent-lie 를 흘렸다. `git.revParse(path)` throw 를 `try {} catch {}`
  로 흡수하고 head=null 로 두어 `head !== commit` 평가가 `preserved`
  action 을 반환 — drift 든 target 자체가 git 아닌 경우든 모두 조용한
  success 로 둔갑. v0.3.4 는 `--follow-symlink` 의미를 "lock SHA
  기준으로 target 을 엄격 검증" 으로 재정의하고 4 단계로 분기:
  `target 이 git 저장소 아님 → NOT_A_REPO`,
  `revParse 실행 실패 → REV_PARSE`,
  `HEAD ≠ lock SHA → SHA_MISMATCH` (drift 확정, `git checkout <sha>`
  조치 안내 포함), `HEAD == lock SHA → adopted`. `install.ts` 의
  `preserved` 로그 분기는 이제 unreachable 이라 제거.
- **§15 H-1 / gstack setup silent no-op 경고**: `opts.gstackSetup`
  미제공 + `skipGstackSetup=false` + marker 불일치 조합이면 runInstall
  은 "[6/8] gstack setup 실행" 하고 한 줄 안내만 남긴 채 skip, 이후
  `✅ 설치 완료` 초록 불빛이 덮어버려 사용자는 setup 이 안 돈 걸
  놓친다. 새 `GstackSetupReason` 타입 (`'ran' | 'skip-flag' |
  'marker-noop' | 'no-callback'`) 을 `InstallResult` 에 노출하고,
  `cmdInstall` 이 `'no-callback'` 감지 시 stderr 에 `⚠️` 경고 블록
  (조치 3안내) 출력. exit code 는 OK 유지 (backward compat). 다른 세
  상태는 모두 의도된 상태이므로 경고 없음.

### Changed

- `VendorAction` 의 `'preserved'` 멤버는 현재 미사용 (v0.3.4 H-3 이후
  어느 코드 경로도 emit 하지 않음). 미래 "소프트 모드" 가 필요할 때를
  대비해 union 은 유지 — 실제 emit 이 재개되면 코멘트 업데이트 필요.

### Testing

- 212 단위 테스트 (v0.3.3 의 208 + H-3 regression guard 3 + H-1 reason
  4상태 검증 1). Mac 기준 전부 pass 예상. Windows 18 실패는 기존
  symlinkSync EPERM 그대로.

### Deferred to v0.4.0

🟠 남은 2건 (HIGH-2 공급망 sha256 pinning + npm provenance, HIGH-3
`ACORN_GUARD_BYPASS` nonce 재설계) + 🟡 6건 + 🟢 Round 3 도그푸딩.
v0.4.0 은 새 기능 (e.g., `acorn uninstall` / `acorn list` / `lock
bump`) 와 함께 minor bump.

## [0.3.3] — 2026-04-17

v0.3.1 / v0.3.2 코드 패치 이후 전역 문서 현행화. 기능 변경 0, 테스트
변경 0. 핵심 동기: `docs/USAGE.md` 는 v0.3.1 `files` 화이트리스트로
npm 패키지에 동봉되지만 내용은 v0.1.0 상태였음 — 배포판 사용자가
보는 문서와 실제 CLI 사이 큰 gap.

### Docs

- **`docs/USAGE.md` 전면 갱신**: title version-neutral, 샘플 출력
  v0.3.2, `acorn config` / `lock validate` / `--adopt` / `--follow-symlink`
  / `--yes` 전용 섹션. "처음부터 재설치" 의 `rm -rf` 제거 → `--adopt`
  로 교체 (ADR-018 준수). 도그푸딩 alias (`adog` / `dn` / `dreport`) 를
  sidebar 로 분리 — npm 배포판에 미포함임을 명시. 치트시트 10+ 행 추가,
  "막혔을 때" 표에 LOCK_SEEDED / ARGS / NOT_A_REPO 심링크 분기 /
  CONFIRM_REQUIRED 추가.
- **`README.md` v0.3.x 반영**: status 뱃지 v0.1.1 → v0.3.2,
  `--follow-symlink` 설명 정반대 교정 (v0.3.0 "그대로 보존" → v0.3.1+
  "fail-close"), `--adopt` Y/n / non-TTY `--yes` 요구사항, `--yes`
  신설, `config` / `lock validate` 서브커맨드 블록, vendors 동작
  매트릭스 4행 확장 (adopted / preserved / symlink 분기).
- **`CLAUDE.md` 커맨드 섹션 현행화 + npm pack 화이트리스트 가이드**:
  존재하지 않던 `install --repo .` 제거, 현재 구현 vs 미구현 (list /
  uninstall / lock bump) 명시적 분리. "npm pack 화이트리스트 (v0.3.1+
  CRIT-1)" 섹션 신설 — 미래 세션이 새 top-level 디렉토리 추가 시
  `files` 등록 누락으로 배포판에서 빠지는 회귀 방지.

### Testing

변경 없음. 208 tests (Windows 190/208).

## [0.3.2] — 2026-04-17

v0.3.1 hotfix 직후 🟠 quick-sweep 패치. 4-agent 검토의 soft-priority
항목 중 저비용·고가치 3건 처리. 기능 추가 없음, 발견성·플랫폼 호환성
정비.

### Fixed

- **§15 S3 / `tests/lock.test.ts` POSIX 경로 하드코딩**: `defaultLockPath`
  테스트 2건이 `/custom/root/harness.lock` 리터럴을 기대값으로 썼다.
  `node:path.join` 은 Windows 에서 `\` 를 반환하므로 Windows assertion
  fail. 기대값도 `join()` 으로 계산해 플랫폼 중립화. 이전 HANDOVER 의
  "Windows 20 failure" 서술은 실제 "18 EPERM + 2 assertion bug" 였음 —
  이번 패치로 원래 서술한 의미의 20 failure 중 2건이 해소되고 남은 18건
  은 순수 Windows 개발자 모드 `symlinkSync` EPERM.
- **§15 S4 / `NOT_A_REPO` hint 에 `--adopt` 1차 제안**: v0.3.0 에서
  도입한 `acorn install --adopt` 의 discoverability 가 0 이었다. 기존
  non-git vendor 를 만난 사용자가 받는 hint 는 `rm -rf` / `mv` 만
  안내해 ADR-018 ("삭제 없음, 항상 rename") 과 모순. 이제 hint 는
  `acorn install --adopt` 를 1차 제안하고, `rm -rf` 안내는 제거, `mv`
  는 수동 대안으로 유지. install 테스트의 regression guard 도
  `/rm -rf|mv /` 느슨한 disjunction → `--adopt` 포함 명시적 assert 로
  강화.

### Docs

- **§15 S5 / `usage()` 에 `config` 서브커맨드 상세**: v0.3.1 에서
  install 플래그는 한 줄씩 풀었으나 config 는 "guard.mode /
  guard.patterns / env.reset 조작" 한 줄 요약만 있었다. 별도 "config
  서브커맨드" 블록을 추가해 get / set / env.reset 호출 형태, 값 enum
  (`block|warn|log`, `strict|moderate|minimal`), `--yes` 플래그를
  명시. 예시 블록에 `acorn install --adopt --yes`, `acorn config
  guard.mode warn --yes`, `acorn config env.reset --yes` 추가.

### Testing

- 208 단위 테스트 (v0.3.1 의 207 + S5 usage regression guard 1).
  Mac 기준 전부 pass 예상. Windows 는 **20 → 18** 실패 (S3 로 2건
  해소). 남은 18은 symlinkSync EPERM (Windows 개발자 모드 미활성
  환경에서만 발현).

### Deferred to v0.4.x

v0.3.1 과 동일 큐 중 S3/S4/S5 3건만 해소. 남은 🟠: H-3 (follow-symlink
revParse 흡수 강화), H-1 (setup 콜백 silent no-op 경고), security HIGH-2
(sha256 pinning + npm provenance), HIGH-3 (`ACORN_GUARD_BYPASS` nonce
재설계). 🟡 6건 + 🟢 Round 3 도그푸딩 1건은 유지.

## [0.3.1] — 2026-04-17

v0.3.0 직후 4-agent 독립 검토(critic / code-reviewer / architect / security-reviewer)
결과 식별된 blocker 4건에 대한 hotfix. v0.3.0 은 npm 에 publish 되지 않아
unpublish 는 불필요.

### Security

- **CRIT-1 / npm pack 유출 차단**: `package.json` 에 `files` 화이트리스트 추가.
  `dist/**`, `hooks/guard-check.sh`, `templates/harness.lock.template.json`,
  `scripts/install-shim-windows.sh`, `docs/USAGE.md`, `README.md`, `LICENSE`
  만 배포에 포함. 이전 pack 은 `src/**/*.ts`, `tests/**/*.ts`, 내부 설계
  문서(`docs/acorn-v0.3-plan.md`, `docs/acorn-v1-plan.md`, `docs/DOGFOOD.md`,
  `docs/HANDOVER.md`), `scripts/dogfood/*.sh`, `tsconfig.json` 을 전부 포함해
  내부 작업 내역이 npm 에 노출될 뻔함. 73 파일 / 126kB → 37 파일 / 51kB.

### Fixed

- **§15 B1 / installVendor 심링크 silent regression**: `src/core/vendors.ts`
  의 `isSymlink` 분기가 `--follow-symlink` 확인 없이 `preserved` 로 success
  를 반환해 v0.2.0 의 `NOT_A_REPO` 자동 교체 거부 계약을 회귀시키던 문제.
  이제 `--follow-symlink` 없이 심링크를 만나면 `NOT_A_REPO` 로 fail-close.
  regression guard 테스트 2건 추가 (`§15 B1 ... --follow-symlink 없음 → NOT_A_REPO`,
  `... --follow-symlink + HEAD 일치 → adopted`).
- **§15 B2 / `acorn config` tx.log 미래핑**: v0.3 plan §S3 이 명시한
  "phase 이름 `config-<key>`, commit 마커로 완료 기록" 을 `runConfig` 가
  이행하지 않아 lock/settings 변경이 `tx.log` 에 흔적 없이 이뤄지던 문제.
  `runMutation` 헬퍼로 `guard.mode` / `guard.patterns` / `env.reset` 쓰기
  경로를 `beginTx`/`phase`/`commit`/`abort` 으로 감쌈. read-only 경로
  (`summary`, `get`) 는 tx 생략. 테스트 5건 추가.
- **§15 B3 / `acorn install --adopt` 확인 프롬프트 부재**: destructive rename
  (`<path>.pre-adopt-<ISO8601>`) 임에도 `uninstall` 보다 gate 가 약했던 문제.
  TTY 에서는 경고 + Y/n 프롬프트, non-TTY + `--yes` 미지정 → `[install/ARGS]`
  USAGE 에러. `--yes` 로 프롬프트 스킵. 기존 `config` 와 동일 패턴.

### Changed

- `usage()` 에 `--adopt` / `--follow-symlink` / `--yes` 플래그 설명 추가.

### Testing

- 207 단위 테스트 (v0.3.0 의 199 + B1 regression guard 2 + B2 tx.log 검증 5 +
  B3 non-TTY gate 1). Mac 기준 전부 pass 예상. Windows 20 실패는 기존
  symlinkSync EPERM / 경로구분자 케이스로 변경 무관.

### Deferred to v0.4.x

- H-3 (follow-symlink revParse 흡수 강화), H-1 (setup 콜백 미제공 + skipGstackSetup
  조합 silent no-op), security HIGH-2 (supply-chain sha256 pinning + npm
  provenance), HIGH-3 (`ACORN_GUARD_BYPASS` 의미 재정의), critic S3/S4/S5 및
  architect R1/R2. 전체 큐는 `docs/HANDOVER.md §1` 의 "4-agent 검토 기준
  remaining work" 참조.

## [0.3.0] — 2026-04-17

v0.3 설계 문서 (`docs/acorn-v0.3-plan.md`) 기준 feature 2 개 완료 + ADR-018/019 신설. v0.1.2 → v0.1.3 → v0.2.0 → v0.3.0 으로 같은 날 네 번째 릴리스.

### Added

- **§15 v0.3.0 S3 / `acorn config`**: lock/settings 조작 helper. Round 1 도그푸딩 실증 "jq 저글링 대신 직접 편집 툴 필요" 대응.
  - `acorn config` (인자 없음) — guard 현재 설정 요약
  - `acorn config guard.mode` — 현재 값 출력 (get)
  - `acorn config guard.mode <block|warn|log>` — 변경. Y/n 프롬프트, `--yes` 로 스킵
  - `acorn config guard.patterns <strict|moderate|minimal>` — 동일 패턴
  - `acorn config env.reset` — `settings.json` 의 env 3키 (CLAUDE_PLUGIN_ROOT / OMC_PLUGIN_ROOT / ECC_ROOT) 제거. 다른 키 보존
  - 쓰기 안전장치 4단계: preflight schema 검증 → backup → atomic write → parseLock 로 쓴 결과 재검증
  - non-TTY + no `--yes` → `CONFIRM_REQUIRED` (exit 64, "CI 에서 --yes 필요" 안내)
- **§15 v0.3.0 S4 / `acorn install --adopt` + `--follow-symlink`**: 기존 수동 설치를 비파괴 흡수. Round 1 Mac personal 머신 `NOT_A_REPO` 실증 대응.
  - ADR-018 원칙: "Lock 은 진실, 현실은 이름 바꿔 보존". 삭제 일절 없음
  - vendor 경로가 non-git 디렉토리 → `<path>.pre-adopt-<ISO8601>/` 로 이동 후 clone + checkout (`action=adopted`, `preAdoptPath` 반환)
  - settings 충돌 → `env.<key>.pre-adopt-<ISO8601>` 로 키 이름 변경 후 기대값 덮어쓰기 (`action=adopted`, `movedKeys` 반환)
  - ADR-019: 심링크 vendor 는 기본 보존 (사용자 dev 레포로 간주). `--follow-symlink` 지정 시만 target HEAD 를 `revParse` 로 확인하고 lock 과 비교 (`action=preserved` 또는 `adopted`)
  - `adopt` 미지정 시는 기존 동작 유지 (regression guard 테스트 포함)
- **`src/core/adopt.ts`**: `preAdoptMove(original)` FS 유틸 + `preAdoptPathFor(path, ts?)`. collision 검증
- **`src/core/settings.ts`**: `mergeEnvAdopt(current, desired)` — conflict 키를 pre-adopt 접미어로 이동 후 새 값 반환. `AdoptMergeResult` 로 이동 기록 노출

### Changed

- `InstallOptions` 에 `adopt` / `followSymlink` 필드 추가
- `InstallVendorResult` 에 optional `preAdoptPath` 추가
- `InstallEnvResult.action` 에 `'adopted'` 가능값 추가 + optional `movedKeys` 추가
- `VendorAction` enum 에 `'adopted'` / `'preserved'` 추가
- `SETTINGS_CONFLICT` 에러 hint 에 `acorn install --adopt` 옵션 안내 추가

### Docs

- `docs/acorn-v0.3-plan.md` (v0.2.0 직후 작성): v0.3 스코프·원칙·S3/S4 설계·테스트 케이스·릴리스 전략·미해결 질문
- `docs/acorn-v1-plan.md §11`: ADR-018 (adopt 전략) + ADR-019 (심링크 preserve) 신설
- README: 일상 사용 예시 확장 + install 플래그 섹션 업데이트

### Testing

- 199 단위 테스트 (v0.2.0 의 177 + v0.3 신규 22). Mac 기준 199/199 예상. Windows 20 실패는 기존 symlinkSync EPERM / 경로구분자 케이스.

## [0.2.0] — 2026-04-17

`acorn-v1-plan.md §15` v0.2.0 버킷 전 항목 (H1 + M1~M5) + 도그푸딩 Round 2 실증 feature (S2, S5, S6) 완료. 동일 세션 내 v0.1.2 / v0.1.3 연속 릴리스 직후 추가 패스.

### Added

- **§15 S5 / `acorn lock validate` CLI**: `harness.lock` 을 읽기만 해서 schema 검증하고 1줄 요약을 내는 read-only CLI. Round 1 "수동 편집 위험" 실증에 대한 직접 대응. `acorn_version: "0.0.0-dev"` 같은 실수 사전 차단. 성공 시 `✅ harness.lock OK (schema_version=1, acorn_version=X, tools=3, guard=block/strict)`, 실패 시 기존 `LockError` 포맷 + exit 78. CI 파이프라인에 한 줄로 꽂기 좋음.
- **§15 S6 / Windows `npm link` 대체 shim 스크립트**: `scripts/install-shim-windows.sh`. Round 2 도그푸딩 (Windows 집 머신) 에서 발견한 "Node 24 가 npm link junction child 를 traverse 못 해 `acorn --version` 실패" 를 자동화. `.cmd` + bash shim 2개만 생성하여 junction 회피. `npm run shim:windows` 로 호출 가능.
- **§15 M3 / doctor env runtime 체크**: `StatusReport.envRuntime` 필드 신규. `settings.json` 은 정확하나 Claude Code 세션이 설치 후 reload 안 한 상태 (`process.env` 에 env 3키 미반영) 를 info severity 의 별도 issue 로 노출. hint 는 "Claude Code 완전 재시작 / direnv allow 재실행". `CollectOptions.runtimeEnv` 로 테스트 주입 가능.

### Fixed

- **§15 H1 / `guard.patterns` dead config**: v0.1.x 까지 `harness.lock.guard.patterns` 는 스키마만 존재했고 hook 은 `.mode` 만 읽어 strict→minimal 변경해도 차단 동작 무변화. 이제 `hooks/guard-check.sh` 가 `.patterns` 도 파싱해 3단계 dispatch: `strict`(전체 AI 실수 방어) / `moderate`(strict - `push --force`·`reset --hard`: git 일상 허용) / `minimal`(catastrophic 만 — fork bomb / mkfs / dd of=/dev/* / DROP DATABASE). `push --force-with-lease` 는 모든 레벨 통과. `ACORN_GUARD_PATTERNS` env override 추가. 차단 메시지에 `mode=X patterns=Y` 노출.
- **§15 S2 / drift SHA 착시 + CHECKOUT hint cause 분기**: Round 2 S4 실증 — status/doctor 의 drift 메시지가 7-char short SHA 만 보여줘서 `lock=c6e6a21, 실제=c6e6a21` (끝자리만 다른 SHA) 같은 착시. `src/core/sha-display.ts`의 `distinguishingPair(a, b)` 가 첫 차이 위치까지 확장. install 의 CHECKOUT 에러 hint 도 generic "git fsck" → "① SHA upstream 없음 → fetch / ② lock SHA 오타 / ③ 저장소 손상 → fsck" 3단계 원인 분기.
- **§15 M4 / Windows case-insensitive 경로 비교**: `inspectSymlink` 가 strict string equality 로 resolved vs expected 를 비교하여 Windows NTFS (기본 케이스 비민감) 에서 `D:\Dotori` vs `D:\dotori` 가 false `wrong_target` 로 보고되던 문제. `normalizePathForCompare(p, platform)` helper 가 win32 → lowercase, POSIX → strict 로 분기.
- **§15 M1 / `registry.json` phantom**: CLAUDE.md·plan §9 에서 `registry.json` 을 마치 current artifact 처럼 언급했지만 `src/` 는 read/write 하지 않음. 현재 상태 (v1.1+ 연기) 를 문서 양쪽에 명시 주석.
- **§15 M5 / CLAUDE.md drift**: 존재하지 않는 `core/registry` / `core/guard` 모듈 언급 제거, `--force` "노출 예정" → `v0.1.0+` 명시, `D:\dotori\...` 경로 실제 `D:\.claude\...` 로 교정, pipeline 서술 8-step 으로 갱신.

### Changed

- **`doctor --json` 출력**: `.summary: {critical, warning, info}` + `.okCritical` 편의 필드는 이미 v0.1.2 에서 shipped. v0.2.0 에선 `envRuntime` 기반 info issue 가 추가로 노출될 수 있음 (M3).

### Testing

- 177 단위 테스트 (v0.1.3 의 154 + v0.2.0 신규 23). Mac 기준 177/177 예상. Windows 20 실패는 기존 symlinkSync EPERM / 경로구분자 케이스.

## [0.1.3] — 2026-04-17

`acorn-v1-plan.md §15` v0.1.3 버킷 전 항목 처리 — 멱등 복원 + 백업 복원 + fail-close 두 건. 같은 날 v0.1.2 릴리스 직후 연속 수정.

### Fixed

- **§15 C3 / gstack setup 멱등 위반**: 두 번째 `runInstall()` 호출 시 `gstack ./setup --host auto` 가 무조건 재실행되어 "두 번째 호출은 모든 단계 noop" 불변식을 어기던 문제. `<harnessRoot>/.gstack-setup.sha` 마커 파일로 "어떤 SHA 에서 setup 성공했는지" 기록. marker == `lock.tools.gstack.commit` 이면 `[6/8] gstack setup (noop — SHA xxx 에 대해 이미 실행됨)` 로 skip. 40-char hex 검증 실패 시 null 반환해 재실행 유도 (fail-close).
- **§15 C4 / symlink `wrong_target` 교체 시 백업 없음**: `ensureSymlink` 의 `wrong_target` 분기가 이전 잘못된 symlink 를 기록 없이 덮어쓰던 "비파괴" 원칙 위반. `backupSymlinkInfo(opts)` 신규 함수가 `<backupDir>/<basename(target)>.info` JSON 으로 `{target, link_target, backed_up_at, reason}` 기록. `installGstackSymlink` 는 `<harnessRoot>/backup/{ISO8601}/symlinks/` 를 자동 주입. `EnsureResult` 에 optional `backup: string` 필드 추가. §15 M2 의 `symlinks/{path}.info` 미생성 갭도 같이 해소.
- **§15 H3 / tx.log partial-write crash 시 fail-open**: `readEvents` 가 JSON 파싱 실패 라인을 빈 `catch {}` 로 skip 하여 `commit` 뒤에 손상 라인이 있어도 `lastInProgress=null` 을 반환 = install 이 "clean" 으로 오판. 이제 `readEvents` 가 `{events, corrupt}` 반환. `lastInProgress` 가 corrupt 감지 시 synthesized `{phase: '<corrupt-tx-log>', status: 'begin', reason: 'partial-write crash 의심'}` 을 돌려보내 `IN_PROGRESS` 경로를 탄다. 사용자는 수동 검사 또는 `--force` 필요.
- **§15 H4 / `isEmptyDir` EACCES 흡수**: `readdirSync` 예외를 모두 catch 로 삼켜 EACCES/ENOTDIR 같은 실 장애가 "not empty" 로 둔갑, 이후 `isGitRepo=false` 분기에서 `NOT_A_REPO` 로 잘못 결론내며 "rm -rf" 힌트를 제공하던 파괴적 조치 유도 문제. `isEmptyDir` 는 이제 ENOENT (race) 만 "empty" 로 수용하고 나머지는 propagate. `installVendor` 가 `VendorError('IO')` 로 번역해 "경로 접근 실패 (ENOTDIR): ..." 정확한 메시지 제공. `vendorHint` 의 IO 분기도 `mv ${vPath} ${vPath}.bak` 같은 비파괴적 안내로 교체.

### Testing

- 154 단위 테스트 (0.1.2 의 142 + v0.1.3 신규 12). Mac 기준 전부 pass 예상. Windows 20 실패는 기존 symlinkSync EPERM / 경로구분자 케이스.

## [0.1.2] — 2026-04-17

2026-04-17 3-critic 병렬 audit (`docs/acorn-v1-plan.md §15`) 에서 식별된 CRITICAL 4건 수정 + v0.2.0 S1 선행. 도그푸딩 Round 2 (Windows, 38회 실행 / 메모 11건) 로는 blocker 0 이었으나 코드-구조 audit 이 silent-lie 와 fresh-install 시나리오에서 놓친 지점을 드러냄.

### Fixed

- **§15 C1 / install 빈 harness 즉시 실패**: 기존에는 `acorn install` 이 `harness.lock` 없으면 `[lock/NOT_FOUND]` 로 즉시 종료해 사용자가 직접 lock 을 수동 작성해야 했다. 이제 `runInstall` 진입 시 lockPath 부재를 감지하면 패키지 동봉 `templates/harness.lock.template.json` 을 시드하고 `[install/LOCK_SEEDED]` 로 중단한다. hint 는 "SHA 를 실제 값으로 바꾼 뒤 재실행". 기존 파일은 덮어쓰지 않음 (비파괴).
- **§15 C2 / `hooks/guard-check.sh` 배포 누락 (ADR-017)**: `settings.json` 의 PreToolUse 훅이 `<harnessRoot>/hooks/guard-check.sh` 를 참조하지만 install 이 해당 파일을 배달하지 않아 매 `acorn install` 후 수동 복사가 필요했고, 미복사 상태에서는 모든 Bash 툴 호출이 `No such file or directory` 로 차단되었다. install 파이프라인에 `[7/8] hooks` phase 신설 (전체 `[1/7]`→`[1/8]` renumber). sha256 멱등, 내용 다르면 timestamped backup 후 원자 교체, `chmod 0o755` (Windows 는 NTFS 특성상 무시).
- **§15 C5 / gstack setup silent success-lie**: `defaultGstackSetup` 이 spawn exit=0 만 보고 ✅ 를 반환해 shell 파싱 에러로 조용히 실패한 경우에도 install 이 녹색으로 끝났다. 신규 `verifyGstackSetupArtifacts` 가 post-spawn 에 fingerprint 파일 (`setup` 스크립트 + `SKILL.md`) 실존을 확인. 누락 시 "setup 이 exit=0 이지만 기대 파일 누락: X. shell 파싱 에러 또는 저장소 손상 가능성" hint 와 함께 중단.
- **§15 C6 / doctor `isDirty` 실패 silent 흡수**: `runDoctor` 의 `checkVendorIntegrity` 가 `git status` 실패를 빈 `catch {}` 로 묻어 dirty vendor 를 ✅ 로 보고하던 문제. "install 은 거부, doctor 는 통과" 라는 검증 표면 거짓말. `catch(e)` 로 바꿔 warning severity 의 `DoctorIssue` 로 노출 ("dirty 상태 감지 실패: <path> (<error>)"), hint 는 `git -C <path> status --porcelain` 수동 실행 안내.

### Added

- **§15 v0.2.0 S1 선행 — `doctor --json` severity 요약 필드**: CI 에서 "critical 만 fail, warning 은 로그" 패턴을 한 줄 gate 로 쓸 수 있게 `.okCritical` (critical=0 ↔ true) + `.summary: {critical, warning, info}` 노출. Round 2 S9 실증에서 기존 `.ok` 가 severity 혼재라 jq 2번 호출이 필요하던 문제 해소. `renderDoctor` 도 `r.summary` 재활용 (inline counts 중복 제거).
- **`templates/harness.lock.template.json`**: 패키지 동봉 lock 시드 템플릿. 40-zero SHA placeholder + `_comment` 안내. C1 시드 대상.

### Changed

- **install pipeline 재넘버링 `[1/7]…[7/7]` → `[1/8]…[8/8]`**: hooks phase 삽입의 결과. `✅ 설치 완료` 요약 라인에 `hooks: created|updated|noop` 추가.

### Docs

- README: "첫 설치 (harness.lock 없는 상태)" 섹션 추가, install pipeline 8-step 다이어그램 갱신, `doctor --json` 새 필드 예시 + CI 한 줄 gate 예시.
- `docs/acorn-v1-plan.md §14 Done Definition`: hooks 배포 체크박스 `[x]` 로 전환.
- `docs/acorn-v1-plan.md §15` 표에 "도그푸딩 포착 (Round 2)" 컬럼 추가 — audit lens 와 실증 lens 가 왜 다른 결론을 냈는지 사유 명시.
- `docs/DOGFOOD.md` Round 2 종료 섹션 + v0.2.0 큐 8건 + audit §15 크로스참조.

### Testing

- 142 단위 테스트 (기존 120 + v0.1.2 신규 22). Mac 기준 전부 pass 예상. Windows 19 실패는 기존 symlinkSync EPERM / 경로구분자 케이스로 변경 무관.

## [0.1.1] — 2026-04-16

도그푸딩 Round 1 (Mac personal, 40분 실사용) 관찰 기반 hotfix 5건.

### Fixed

- **lock.ts BOM 처리**: Windows 에디터로 저장 시 삽입되는 UTF-8 BOM(`\uFEFF`)이 `JSON.parse` 를 터뜨리던 문제. `parseLock` 진입부에서 선행 BOM 1바이트 자동 제거. `readLock` 포함 + 테스트 2건.
- **schema_version 필드 누락 메시지**: 필드 자체가 없을 때 `"기대 1, 실제 undefined"` 로 표시되어 혼란. 누락과 값 불일치를 분리해 각각 `"schema_version 필드 누락"` / `"schema_version 불일치: 기대 1, 실제 X"` 로 출력.
- **install 에러 hint 일관성**: doctor 수준의 구체적 next-action hint 를 `InstallError` 에도 부여. `IN_PROGRESS` / `SETTINGS_CONFLICT` (preflight + post-write) / `SETTINGS_WRITE` + vendor cause 기반 (`NOT_A_REPO` / `LOCAL_CHANGES` / `CLONE` / `CHECKOUT` / `REV_PARSE`) 별 메시지. `formatError` 가 `→ <hint>` 로 출력.
- **vendors dirty 오판정**: gstack `./setup` 이 생성한 `.agents/skills/` 가 매 install 마다 LOCAL_CHANGES 를 유발하던 문제. `GitRunner.getDirtyPaths(dir)` + 툴별 `EXPECTED_DIRTY_PATHS` 허용 리스트 (`gstack: ['.agents/']`) 도입. install 과 doctor 모두 동일 필터. LOCAL_CHANGES 메시지에 오염 경로 상위 5건 표시.

### Added

- **`acorn install --run-gstack-setup`**: CLI 사용자용 기본 gstack setup 실행. `<gstackSource>/setup --host auto` 를 spawn (Windows 는 `shell:true` 로 POSIX 스크립트 Git Bash/WSL 경유). 스크립트 부재 / 비정상 종료 / 시그널 종료 모두 fail-close. `--skip-gstack-setup` 과 상호 배타.

## [0.1.0] — 2026-04-15

Radical MVP 릴리즈 — 10 스프린트(+ 6.5 안정화) 완료.

### Added

- **CLI**: `acorn install` / `acorn status` / `acorn doctor` + `--json` / `--force` / `--help` / `--version`
- **install 파이프라인**: 7단계 preflight-우선 (lock → env → settings 충돌 체크 → vendors clone → 심링크 → gstack setup → settings 원자 쓰기)
- **harness.lock 파서**: schema_version / SHA40 / ISO 날짜 / guard 설정 검증 (`LockError`)
- **환경변수 계산**: `CLAUDE_PLUGIN_ROOT` / `OMC_PLUGIN_ROOT` / `ECC_ROOT` + diff 리포트
- **settings.json 멱등 머지**: 비파괴 머지, 충돌 시 에러+중단, ISO 타임스탬프 백업, 원자 쓰기
- **gstack 심링크**: `rename` 기반 원자 교체 (POSIX), Windows junction 폴백
- **vendors**: git clone + SHA 핀 + 120초 timeout + dirty 감지(`LOCAL_CHANGES`) + partial clone 자동 정리
- **tx.log 트랜잭션**: JSONL 로그. `begin`→`phase`→`commit|abort` 순서. 이전 실행 미완료 시 `IN_PROGRESS` 에러 (`--force` 우회)
- **doctor**: 6 area × 3 severity 이슈 분류 + 이슈별 수동 복구 힌트 + JSON 출력
- **guard 훅**: `block|warn|log` × `strict|moderate|minimal` 매트릭스. `push --force-with-lease` 는 안전 관용구로 allowlist
- **Exit code 규약**: POSIX EX_* 참조 (0/1/64/75/78)

### Design Decisions

- 격리 위치: `~/.claude/skills/harness/vendors/` (ADR-001)
- 툴별 경로: gstack=심링크 / OMC·ECC=환경변수 (ADR-003, 검증 완료)
- 기술 스택: TypeScript + Node 24 LTS + bash (ADR-005)
- CLAUDE_CONFIG_DIR 존중 (direnv 호환, 경로 단일화 in env.ts)

### Testing

- 110개 단위 테스트 (Node `--experimental-strip-types` 직접 실행)
- `GitRunner` 주입으로 네트워크 없이 설치 로직 검증
- 빌드 클린 (`tsc --project tsconfig.build.json`)

### Known Limits (v0.2.0+ 예정)

- `acorn uninstall` / `config` / `list` 서브커맨드
- `acorn doctor --fix` 자동 복구
- registry.ts (충돌 해소 자동화)
- `src/dev/*` (check/diff/lock/validate/release)
- 백업 GC (retention 정책)
- 인터랙티브 확인 등급
