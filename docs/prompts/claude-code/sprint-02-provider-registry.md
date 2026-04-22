# Sprint 02 Prompt

## Goal

provider registry 와 provider detect/install plan 모델을 구현해줘.

이번 sprint 의 목적은 “무엇을 설치할 수 있는가”와 “무엇이 이미 설치되어 있는가”를  
코드에서 독립적으로 다룰 수 있게 만드는 것이다.

## What To Build

신규 파일을 중심으로 구현해줘.

- `src/core/providers.ts`
- `src/core/provider-detect.ts`
- `src/core/provider-install.ts`

## Required Concepts

### Provider

provider 는 capability 의 구현체다.

예시:

- `gstack`
- `superpowers`
- `gsd`
- `claudekit`

### Install Strategy

아래 전략을 타입으로 지원해줘.

- `clone`
- `npx`
- `npm-global`
- `plugin-marketplace`
- `manual`

### Detect Result

최소한 아래 상태를 표현할 수 있어야 해.

- `installed`
- `missing`
- `unknown`

## Scope

이번 sprint 에서는 실제 설치를 끝까지 자동화할 필요는 없다.

필수는 아래 두 가지다.

1. provider 의 install step 을 문자열/구조화된 단계로 만들 수 있어야 함
2. provider 설치 여부를 감지할 수 있어야 함

## Suggested API

예시일 뿐이니 더 좋은 형태면 바꿔도 된다.

- `listProviders()`
- `getProvider(name)`
- `detectProvider(provider, env?)`
- `buildInstallPlan(provider)`

## Rules

- install command 를 실행하는 코드와 plan 생성 코드는 분리
- network 의존 없이 테스트 가능한 구조 선호
- host/plugin/npm/git/manual 을 모두 같은 인터페이스 아래 다룰 것
- 아직 `install.ts` 를 크게 갈아엎지 말 것

## Tests

- `tests/providers-detect.test.ts`
- `tests/provider-install-plan.test.ts`

포함할 것:

- provider registry 조회
- provider detect 결과
- install plan 생성
- provider 가 capability 를 어떤 강도로 제공하는지 표현 가능 여부

## Done

- provider registry 가 lock schema 와 분리된 독립 레이어가 됨
- install 안내 텍스트를 만들 수 있음
- detect 로직이 테스트 가능함

## Output Format

1. registry 구조 설명
2. detect 전략 요약
3. install plan 구조 요약
4. 아직 구현하지 않은 부분
