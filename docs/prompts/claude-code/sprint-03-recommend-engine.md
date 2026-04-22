# Sprint 03 Prompt

## Goal

project profile 기반 recommendation engine 을 구현해줘.

이번 sprint 의 목적은 사용자가 직접 조합을 공부하지 않아도  
acorn 이 capability 와 provider 를 추천할 수 있게 만드는 것이다.

## What To Build

신규 파일:

- `src/core/project-profile.ts`
- `src/core/recommend.ts`

## Project Profile

최소한 아래를 추론해줘.

- UI 존재 여부
- API/backend 성격 여부
- background jobs / webhook / worker 성격 여부
- test maturity 대략 추정

정교한 ML 은 필요 없다.  
휴리스틱 기반이면 충분하다.

## Recommendation Output

최소한 아래를 계산해줘.

1. 추천 capability 목록
2. capability 별 추천 provider
3. 추천 이유 문자열

예:

- `planning -> gstack`
- `spec -> superpowers`
- `tdd -> superpowers`
- `qa_headless -> enabled but no provider`

## Special Rule

`qa_headless` 는 provider 가 없어도 정상 추천 대상이어야 한다.

즉:

- capability 는 추천
- provider 는 비어 있을 수 있음
- 이유를 설명해야 함

## Rules

- 추천 로직은 pure function 성격이 강해야 함
- 입력 profile 이 다르면 결과도 달라져야 함
- frontend 와 backend 시나리오가 구분되어야 함
- recommendation 엔진이 provider detect 로직에 강하게 결합되지 않게 할 것

## Tests

- `tests/project-profile.test.ts`
- `tests/recommend.test.ts`

포함할 것:

- frontend 프로젝트 추천
- backend/API 프로젝트 추천
- jobs/webhook 포함 프로젝트 추천
- test maturity 가 낮을 때 `tdd` 비중 증가

## Done

- 추천 결과가 사람이 읽어서 납득 가능함
- qa_ui 와 qa_headless 가 구분됨
- 추후 preset 생성에 재사용 가능한 구조임

## Output Format

1. profile 추론 규칙 요약
2. recommendation 규칙 요약
3. frontend/backend 예시 결과
4. 남은 개선 포인트
