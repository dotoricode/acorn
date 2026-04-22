# Sprint 07 Prompt

## Goal

`hooks` capability 와 `qa_headless` capability 를 정리해줘.

이번 sprint 에서는 hook provider 위임 원칙을 지키면서,  
backend 프로젝트도 first-class citizen 으로 올리는 것이 중요하다.

## What To Build

대상:

- `src/core/hooks.ts`
- 신규 파일 가능: `src/core/qa-headless.ts`
- 관련 command/status/doctor 연동 가능

## Hooks Rules

1. legacy `installGuardHook` fallback 은 유지
2. v3 + hooks capability + `claudekit` provider 가 있으면
   - provider-managed 상태를 표현
   - 필요하면 detect/guided message 출력
3. acorn 이 claudekit hook registry 전체를 복제하지 말 것

즉:

- 최소 fallback 만 유지
- 의미론 전체 복제는 하지 않음

## QA Headless Rules

1. `qa_headless` 는 독립 capability 여야 함
2. provider 가 없어도 정상 상태일 수 있음
3. provider 가 없을 때는 manual checklist 또는 guidance 를 제공

예시 대상:

- API
- worker
- cron
- webhook
- CLI

## Tests

- `tests/hooks-v3-provider-managed.test.ts`
- `tests/qa-headless.test.ts`

포함할 것:

- legacy hook fallback
- hooks capability + provider-managed path
- qa_headless manual guidance path

## Done

- hooks 처리 범위가 과도하게 커지지 않음
- backend 프로젝트를 위한 qa_headless 경로가 생김

## Output Format

1. hooks 처리 방식
2. provider-managed 와 fallback 차이
3. qa_headless guidance 예시
4. 추후 provider 연결 포인트
