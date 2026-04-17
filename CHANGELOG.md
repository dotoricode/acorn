# Changelog

모든 주목할 변경 사항을 기록한다.
[Keep a Changelog](https://keepachangelog.com/) 포맷, [SemVer](https://semver.org/).

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
