# Changelog

모든 주목할 변경 사항을 기록한다.
[Keep a Changelog](https://keepachangelog.com/) 포맷, [SemVer](https://semver.org/).

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
