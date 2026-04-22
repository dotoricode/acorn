# Sprint 01 Prompt

## Goal

acorn v2 capability-first 전환의 첫 단계로 `schema_version = 3` 을 도입해줘.

이번 sprint 에서는 UI/CLI UX 보다 **lock schema 와 parsing 안정성**이 우선이다.

## What To Build

1. `src/core/lock.ts`
   - `schema_version 3` 타입 추가
   - capability-first 구조를 읽을 수 있게 수정
   - 기존 `schema_version 2` parsing 유지
2. 새 타입 추가
   - `CapabilityName`
   - `CapabilityConfig`
   - `ProviderEntry`
   - `PresetEntry`
   - provider install strategy 타입
3. 필요하면 신규 파일 추가
   - `src/core/providers.ts`
4. parse 경로 분리
   - `parseLockV2`
   - `parseLockV3`
   - `parseLock`

## Capability Names

아래 값만 허용해줘.

- `planning`
- `spec`
- `tdd`
- `review`
- `qa_ui`
- `qa_headless`
- `hooks`
- `memory`

## Desired V3 Shape

v3 lock 은 아래 개념을 읽을 수 있어야 해.

- `capabilities`
- `providers`
- `presets`

단, 이번 sprint 에서는 실제 설치나 추천 엔진까지 구현하지 말고,  
**정상 파싱과 타입 안전성**에 집중해줘.

## Rules

- 기존 v2 lock 은 계속 읽혀야 한다
- 기존 public 함수 이름은 가능한 유지
- 필요 이상으로 install/phase/status 코드까지 건드리지 말 것
- breaking rename 피할 것
- apply_patch 로만 수정

## Tests

아래 테스트를 추가하거나 갱신해줘.

- `tests/lock-v3-capabilities.test.ts`
  - 최소 v3 lock 파싱 성공
  - invalid capability 거부
  - invalid provider shape 거부
  - invalid preset shape 거부
- 기존 v2 regression test 유지

## Done

- `readLock()` 가 v2/v3 둘 다 읽음
- 타입이 지나치게 느슨하지 않음
- 테스트 통과

## Output Format

작업이 끝나면 아래 형식으로 짧게 보고해줘.

1. 변경한 파일
2. v3 schema 에서 어떤 타입을 추가했는지
3. v2 하위 호환을 어떻게 유지했는지
4. 남은 리스크
