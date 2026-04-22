# Sprint 04 Prompt

## Goal

`acorn install` 에 guided / detect-only 모드를 추가해줘.

이번 sprint 의 목표는 auto install 완성이 아니다.  
사용자가 설치법을 검색하지 않아도 되게 만드는 것이 핵심이다.

## What To Build

대상:

- `src/commands/install.ts`
- 필요 시 `src/index.ts`

## Modes

최소한 아래 모드를 지원해줘.

- `guided`
- `detect-only`

가능하면 기존 default path 는 유지해도 되지만,  
v3 lock 에서는 guided output 이 자연스럽게 연결되게 해줘.

## Guided Output Should Include

1. project profile
2. recommended capabilities
3. recommended providers
4. provider detect 결과
5. install steps

예시 느낌:

- `gstack: clone + setup`
- `superpowers: plugin marketplace install`
- `claudekit: npm global install`

## Important Constraints

- v2 legacy install path 는 깨지지 말 것
- 실제 설치 command 실행보다 출력 품질이 우선
- provider install plan 을 재사용할 것
- web search 없이 다음 행동이 가능할 정도로 구체적으로 쓸 것

## CLI

필요하면 아래 옵션을 추가해줘.

- `acorn install --mode guided`
- `acorn install --mode detect-only`

## Tests

- `tests/install-guided-v3.test.ts`
- `tests/install-detect-only-v3.test.ts`

포함할 것:

- v3 lock + guided output
- v3 lock + detect-only output
- v2 legacy path regression

## Done

- install 명령이 planner 역할을 하기 시작함
- 사용자가 뭘 설치해야 하는지 바로 이해 가능
- v2 path 는 유지

## Output Format

1. guided mode 출력 예시
2. detect-only mode 출력 예시
3. v2 와 v3 분기 방식
4. 남은 auto install 범위
