# Claude Code Runbook

> 목적: Claude Code 에게 acorn v2 capability-first 전환 작업을 sprint 단위로 안정적으로 맡긴다.

---

## 1. 사용 원칙

1. 한 번에 한 sprint 만 시킨다
2. 이전 sprint 결과를 읽고 다음 sprint 를 진행하게 한다
3. 범위를 넘는 리팩터링을 금지한다
4. 각 sprint 끝나면 테스트 결과와 남은 리스크를 반드시 보고받는다
5. legacy `prototype/dev/production` 사용자 경험은 쉽게 깨지지 않게 한다

---

## 2. 실행 순서

아래 순서대로 진행한다.

1. `sprint-01-schema-v3.md`
2. `sprint-02-provider-registry.md`
3. `sprint-03-recommend-engine.md`
4. `sprint-04-guided-install.md`
5. `sprint-05-preset-layer.md`
6. `sprint-06-status-doctor.md`
7. `sprint-07-hooks-qa.md`
8. `sprint-08-docs-migration.md`

중간에 막히면 다음 sprint 로 넘어가지 말고 현재 sprint 에서 정리한다.

---

## 3. Sprint 파일 목록

- [sprint-01-schema-v3.md](/Users/youngsang.kwon/01_private/acorn/docs/prompts/claude-code/sprint-01-schema-v3.md)
- [sprint-02-provider-registry.md](/Users/youngsang.kwon/01_private/acorn/docs/prompts/claude-code/sprint-02-provider-registry.md)
- [sprint-03-recommend-engine.md](/Users/youngsang.kwon/01_private/acorn/docs/prompts/claude-code/sprint-03-recommend-engine.md)
- [sprint-04-guided-install.md](/Users/youngsang.kwon/01_private/acorn/docs/prompts/claude-code/sprint-04-guided-install.md)
- [sprint-05-preset-layer.md](/Users/youngsang.kwon/01_private/acorn/docs/prompts/claude-code/sprint-05-preset-layer.md)
- [sprint-06-status-doctor.md](/Users/youngsang.kwon/01_private/acorn/docs/prompts/claude-code/sprint-06-status-doctor.md)
- [sprint-07-hooks-qa.md](/Users/youngsang.kwon/01_private/acorn/docs/prompts/claude-code/sprint-07-hooks-qa.md)
- [sprint-08-docs-migration.md](/Users/youngsang.kwon/01_private/acorn/docs/prompts/claude-code/sprint-08-docs-migration.md)

---

## 4. 기본 지시 방식

항상 아래 구조를 쓴다.

1. 이전 sprint 가 끝났다고 가정하게 한다
2. 이번 sprint 파일을 읽게 한다
3. 범위를 넘지 말라고 한다
4. 테스트를 실행하게 한다
5. 정해진 형식으로 보고하게 한다

---

## 5. 복붙용 지시문 템플릿

```text
docs/prompts/claude-code/runbook.md 와 이번 sprint 지시 파일을 먼저 읽고 작업해줘.

이전 sprint 결과를 반영한 현재 코드 상태를 먼저 파악하고, 이번 sprint 범위를 넘는 리팩터링은 하지 마.
legacy 호환을 쉽게 깨지 말고, 이번 sprint 의 Done 조건을 만족하는 최소 변경에 집중해.

작업이 끝나면 아래 순서로 보고해줘.
1. 변경 파일
2. 핵심 설계 판단
3. 테스트 결과
4. 남은 리스크
```

---

## 6. Sprint별 복붙용 지시문

### Sprint 01

```text
docs/prompts/claude-code/runbook.md 와 docs/prompts/claude-code/sprint-01-schema-v3.md 를 먼저 읽고 작업해줘.

이번 작업은 acorn v2 capability-first 전환의 Sprint 01 이다.
목표는 schema_version 3 과 capability-first lock parsing 을 도입하는 것이다.

중요:
- 기존 schema_version 2 lock 하위 호환을 깨면 안 된다
- install/status/phase 를 필요 이상으로 건드리지 마
- parsing 안정성과 테스트가 우선이다

작업 후에는 아래 순서로 보고해줘.
1. 변경 파일
2. v3 schema 에 추가된 타입
3. v2 하위 호환 유지 방식
4. 테스트 결과
5. 남은 리스크
```

### Sprint 02

```text
Sprint 01 이 끝났다고 가정하고, docs/prompts/claude-code/runbook.md 와 docs/prompts/claude-code/sprint-02-provider-registry.md 를 먼저 읽고 작업해줘.

이번 작업은 provider registry / provider detect / provider install plan 레이어를 추가하는 것이다.
현재 schema v3 구조를 먼저 읽고, install.ts 를 크게 갈아엎지 않은 상태에서 provider 모델을 독립 레이어로 세워줘.

중요:
- install 실행 로직보다 detect/plan 구조가 우선이다
- 테스트 가능한 구조를 선호한다
- 아직 recommendation 이나 preset 까지 욕심내지 마

작업 후에는 아래 순서로 보고해줘.
1. 변경 파일
2. registry 구조
3. detect 전략
4. install plan 구조
5. 테스트 결과
6. 남은 리스크
```

### Sprint 03

```text
Sprint 02 가 끝났다고 가정하고, docs/prompts/claude-code/runbook.md 와 docs/prompts/claude-code/sprint-03-recommend-engine.md 를 먼저 읽고 작업해줘.

이번 작업은 project profile 추론과 recommendation engine 추가다.
현재 schema v3 와 provider registry 를 먼저 읽고, 그 위에 capability/provider 추천 로직을 추가해줘.

중요:
- 휴리스틱 기반이면 충분하다
- qa_ui 와 qa_headless 를 분리해라
- qa_headless 는 provider 가 없어도 정상 추천 경로여야 한다
- recommendation 은 pure function 성격을 유지하는 편이 좋다

작업 후에는 아래 순서로 보고해줘.
1. 변경 파일
2. profile 추론 규칙
3. recommendation 규칙
4. 예시 출력
5. 테스트 결과
6. 남은 리스크
```

### Sprint 04

```text
Sprint 03 이 끝났다고 가정하고, docs/prompts/claude-code/runbook.md 와 docs/prompts/claude-code/sprint-04-guided-install.md 를 먼저 읽고 작업해줘.

이번 작업은 v3 lock 기준 guided / detect-only install 모드를 추가하는 것이다.
현재 install 명령의 legacy v2 경로를 먼저 파악하고, 그 위에 v3 planner 경로를 안전하게 얹어줘.

중요:
- v2 install 경로는 깨면 안 된다
- auto install 완성보다 guided output 품질이 우선이다
- 사용자가 검색 없이 바로 다음 행동을 알 수 있게 출력해라

작업 후에는 아래 순서로 보고해줘.
1. 변경 파일
2. v2/v3 분기 방식
3. guided 출력 예시
4. detect-only 출력 예시
5. 테스트 결과
6. 남은 리스크
```

### Sprint 05

```text
Sprint 04 가 끝났다고 가정하고, docs/prompts/claude-code/runbook.md 와 docs/prompts/claude-code/sprint-05-preset-layer.md 를 먼저 읽고 작업해줘.

이번 작업은 preset 을 first-class 개념으로 추가하고, legacy prototype/dev/production 을 alias 로 유지하는 것이다.
현재 phase 관련 코드와 v3 capability 구조를 먼저 읽고, preset 조회/설정에 집중해줘.

중요:
- 기존 사용자 CLI 경험을 쉽게 깨지 마
- capability 전체 토글 기능을 한 번에 다 만들려고 하지 마
- preset 과 legacy alias 해석을 안정적으로 만드는 것이 우선이다

작업 후에는 아래 순서로 보고해줘.
1. 변경 파일
2. preset 모델
3. legacy alias 매핑
4. CLI 변경 사항
5. 테스트 결과
6. 남은 리스크
```

### Sprint 06

```text
Sprint 05 가 끝났다고 가정하고, docs/prompts/claude-code/runbook.md 와 docs/prompts/claude-code/sprint-06-status-doctor.md 를 먼저 읽고 작업해줘.

이번 작업은 status 와 doctor 를 capability/provider 중심으로 확장하는 것이다.
현재 status/doctor 출력 구조와 v3 capability/provider 모델을 먼저 읽고, 사람이 바로 이해할 수 있는 상태 요약과 행동 가능한 경고를 추가해줘.

중요:
- status 는 요약 중심
- doctor 는 행동 가능한 경고 중심
- capability enabled but provider missing, qa_headless recommended but no provider configured, hooks provider missing 같은 경고를 잘 보여줘

작업 후에는 아래 순서로 보고해줘.
1. 변경 파일
2. 새 status 예시
3. 새 doctor 예시
4. v2/v3 공존 방식
5. 테스트 결과
6. 남은 리스크
```

### Sprint 07

```text
Sprint 06 이 끝났다고 가정하고, docs/prompts/claude-code/runbook.md 와 docs/prompts/claude-code/sprint-07-hooks-qa.md 를 먼저 읽고 작업해줘.

이번 작업은 hooks capability 와 qa_headless capability 를 정리하는 것이다.
현재 hooks 처리 방식과 v3 capability/provider 모델을 먼저 읽고, provider-managed 원칙을 지키면서 구현해줘.

중요:
- acorn 이 claudekit hook 의미론 전체를 복제하지 마
- legacy guard hook fallback 은 유지해라
- qa_headless 는 provider 없어도 first-class capability 여야 한다
- backend 프로젝트를 위한 manual guidance 를 제공해라

작업 후에는 아래 순서로 보고해줘.
1. 변경 파일
2. hooks 처리 방식
3. provider-managed 와 fallback 차이
4. qa_headless guidance 예시
5. 테스트 결과
6. 남은 리스크
```

### Sprint 08

```text
Sprint 07 이 끝났다고 가정하고, docs/prompts/claude-code/runbook.md 와 docs/prompts/claude-code/sprint-08-docs-migration.md 를 먼저 읽고 작업해줘.

이번 작업은 capability-first 모델 기준으로 문서와 template 과 migration 설명을 정리하는 것이다.
README, CLAUDE.md, HANDOVER, harness.lock template 을 중심으로 새 모델을 설명하고, legacy 사용자의 migration path 도 분명히 적어줘.

중요:
- vendor 설명보다 capability/provider/preset 설명이 먼저 와야 한다
- 새 사용자가 guided install 과 preset 모델을 바로 이해할 수 있어야 한다
- 기존 prototype/dev/production 사용자는 당장 깨지지 않는다는 점을 분명히 적어라

작업 후에는 아래 순서로 보고해줘.
1. 변경 파일
2. migration 핵심 메시지
3. template 변경 요약
4. 문서상 남은 부채
```

---

## 7. 짧은 지시문 예시

짧게 지시하고 싶으면 아래처럼 해도 된다.

```text
docs/prompts/claude-code/runbook.md 와 docs/prompts/claude-code/sprint-01-schema-v3.md 를 읽고 그 지시대로 작업해줘. 범위를 넘는 리팩터링은 하지 말고, 테스트까지 실행한 뒤 runbook 에 적힌 형식으로 보고해.
```

---

## 8. 추천 운영 방식

가장 안전한 운영 방식은 이렇다.

1. sprint 하나 지시
2. 결과 리뷰
3. 필요하면 작은 수정 지시
4. 다음 sprint 진행

한 번에 여러 sprint 를 묶어 시키면 범위가 쉽게 커지고,  
legacy 호환이 깨질 가능성도 커진다.
