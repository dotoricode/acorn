# Changelog

모든 주목할 변경 사항을 기록한다.
[Keep a Changelog](https://keepachangelog.com/) 포맷, [SemVer](https://semver.org/).

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
