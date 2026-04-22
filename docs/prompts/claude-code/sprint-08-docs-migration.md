# Sprint 08 Prompt

## Goal

문서, 템플릿, 도움말, migration 설명을 정리해줘.

이번 sprint 의 목적은 구현한 capability-first 모델을  
사용자가 실제로 이해하고 쓸 수 있게 만드는 것이다.

## What To Update

- `README.md`
- `CLAUDE.md`
- `docs/HANDOVER.md`
- `templates/harness.lock.template.json`
- 필요하면 `CHANGELOG.md`

## Must Explain

1. capability 가 무엇인지
2. provider 가 무엇인지
3. preset 이 무엇인지
4. guided install 을 어떻게 쓰는지
5. legacy phase 사용자는 어떻게 migration 하면 되는지

## Migration Guidance

최소한 아래를 설명해줘.

- 기존 `prototype/dev/production` 사용자는 당장 깨지지 않음
- 새 모델에서는 capability/preset 이 중심임
- v2 lock 에서 v3 lock 으로 어떻게 넘어가는지

## Template

`templates/harness.lock.template.json` 은 새 v3 구조를 반영해줘.

포함할 것:

- capabilities
- providers
- presets

단, placeholder 값과 안내 문구는 명확해야 한다.

## Rules

- 기존 README 톤을 유지
- 과장보다 이해 가능성 우선
- capability 이름은 쉬운 단어 유지
- vendor 소개보다 capability 설명이 먼저 나오게 구성

## Done

- 새 사용자는 capability-first 모델을 바로 이해 가능
- 기존 사용자는 migration path 를 알 수 있음

## Output Format

1. 문서 변경 파일
2. migration 핵심 메시지
3. template 변경 요약
4. 남은 문서 부채
