# Sprint 05 Prompt

## Goal

preset 레이어를 추가하고 legacy `prototype/dev/production` 을 alias 로 유지해줘.

이번 sprint 의 목적은 기존 phase 개념을 즉시 삭제하는 것이 아니라,  
새 capability 모델 위에 안전한 호환 레이어를 얹는 것이다.

## What To Build

가능한 대상:

- `src/core/phase.ts`
- `src/commands/phase.ts`
- `src/commands/preset.ts`
- `src/index.ts`

## New Concept

preset 은 capability 집합이다.

예:

- `starter`
- `builder`
- `frontend`
- `backend`

## Required Behavior

1. 현재 preset 조회 가능
2. preset 설정 가능
3. preset -> capability 집합 계산 가능
4. legacy phase 는 alias 로 계속 동작

예시 alias:

- `prototype` -> lightweight preset 또는 `planning + review`
- `dev` -> `planning + spec + tdd + review + hooks`
- `production` -> `review + hooks + stricter profile`

정확한 매핑은 코드베이스에 맞게 제안해도 된다.

## Rules

- 기존 사용자 CLI 경험을 최대한 보존
- 한 번에 모든 capability enable/disable 명령까지 만들 필요는 없음
- 이번 sprint 에서는 preset 조회/설정에 집중
- 출력 문구는 사람이 이해하기 쉽게 유지

## Tests

- `tests/preset.test.ts`
- `tests/phase-legacy-alias.test.ts`

포함할 것:

- preset 설정 성공
- legacy phase alias 해석
- noop 동작
- invalid preset 거부

## Done

- preset 이 first-class 개념이 됨
- legacy 와 v3 가 같이 굴러감

## Output Format

1. preset 모델 설명
2. legacy alias 매핑 설명
3. CLI 변경 설명
4. 남은 capability toggle 계획
