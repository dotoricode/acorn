# acorn v2 Sprint Plan

> 목적: acorn 을 vendor-first CLI 에서 capability-first orchestrator 로 점진 전환한다.
> 대상 독자: 사람 개발자, Claude Code, Codex 류 코딩 에이전트

---

## 1. 최종 목표

v2 에서 acorn 은 아래를 할 수 있어야 한다.

- capability 기반 lock 을 읽는다
- 프로젝트를 보고 필요한 capability 를 추천한다
- capability 별 provider 를 추천한다
- 설치 상태를 감지한다
- 설치 방법을 auto 또는 guided 방식으로 안내한다
- legacy `prototype/dev/production` 도 깨지지 않는다

---

## 2. 핵심 원칙

1. 기존 사용자 경험을 한 번에 깨지 않는다
2. schema 먼저, UX 나중
3. auto install 보다 guided install 을 먼저 완성한다
4. provider 의미론을 acorn 이 과하게 복제하지 않는다
5. `qa_headless` 는 provider 없어도 capability 슬롯으로 인정한다

---

## 3. 새 개념 요약

### Capability

- `planning`
- `spec`
- `tdd`
- `review`
- `qa_ui`
- `qa_headless`
- `hooks`
- `memory`

### Provider

예시:

- `gstack`
- `superpowers`
- `gsd`
- `claudekit`

### Preset

capability 묶음이다.

예시:

- `starter`
- `builder`
- `frontend`
- `backend`

---

## 4. Sprint 개요

| Sprint | 이름 | 핵심 결과 |
|---|---|---|
| 0 | Foundation | 용어/경계/출력 포맷 정리 |
| 1 | Schema V3 | capability-first lock 파싱 |
| 2 | Provider Registry | provider detect/install 계획 모델 |
| 3 | Recommend Engine | 프로젝트 프로파일 + 추천 엔진 |
| 4 | Guided Install | 설치 안내 중심 install UX |
| 5 | Preset Layer | preset 조회/설정 + legacy alias |
| 6 | Status & Doctor | capability/provider 상태 진단 |
| 7 | Hooks & QA | hooks 연결, qa_headless 슬롯 |
| 8 | Docs & Migration | 문서/도움말/템플릿 정리 |

---

## 5. Sprint 상세

### Sprint 0. Foundation

목표:

- v2 구현에서 사용할 공통 용어를 고정
- 새 출력 포맷을 정리
- 위험한 범위를 명시

작업:

1. `docs/acorn-v2-plan.md` 와 현재 코드 기준으로 용어 확정
2. capability/provider/preset/install-mode 용어를 README용 문장으로 정리
3. `install`, `status`, `doctor` 가 앞으로 어떤 정보를 보여줄지 샘플 출력 작성

변경 후보:

- `docs/acorn-v2-plan.md`
- `README.md` 또는 별도 초안 문서

완료 조건:

- 팀이 같은 단어로 말할 수 있음
- Sprint 1 이후 설계 변경 가능성이 줄어듦

---

### Sprint 1. Schema V3

목표:

- `schema_version = 3` 도입
- capability-first lock 읽기 지원
- v2 lock 하위 호환 유지

핵심 작업:

1. `src/core/lock.ts`
   - 새 타입 추가
   - v2 parse 경로 유지
   - v3 parse 경로 추가
2. v3 타입 정의
   - `CapabilityName`
   - `CapabilityConfig`
   - `ProviderEntry`
   - `PresetEntry`
3. provider install strategy 타입 정의
4. template 초안용 fixture 생성

테스트:

- `tests/lock-v3-capabilities.test.ts`
- v2 lock regression
- invalid schema rejection

완료 조건:

- `readLock()` 가 v2/v3 둘 다 읽음
- 기존 테스트 유지
- v3 fixture 테스트 통과

---

### Sprint 2. Provider Registry

목표:

- provider 를 capability 와 분리된 1급 모델로 올림
- 설치 전략과 감지 전략을 공통화

핵심 작업:

1. 신규 파일
   - `src/core/providers.ts`
   - `src/core/provider-detect.ts`
   - `src/core/provider-install.ts`
2. provider registry 함수
   - `getProvider()`
   - `listProviders()`
3. detect 모델
   - installed / missing / unknown
4. install plan 모델
   - clone / npx / npm-global / plugin-marketplace / manual

테스트:

- `tests/providers-detect.test.ts`
- `tests/provider-install-plan.test.ts`

완료 조건:

- 특정 provider 가 설치되어 있는지 독립적으로 검사 가능
- install plan 을 실행 없이 문자열/단계로 만들 수 있음

---

### Sprint 3. Recommend Engine

목표:

- 프로젝트 프로파일을 추론
- 추천 capability 와 provider 를 계산

핵심 작업:

1. 신규 파일
   - `src/core/project-profile.ts`
   - `src/core/recommend.ts`
2. profile 추론
   - UI 유무
   - API/backend 유무
   - jobs/webhook/worker 유무
   - test maturity
3. 추천 로직
   - capability 추천
   - provider 점수화
   - 중복/충돌 제거

테스트:

- `tests/project-profile.test.ts`
- `tests/recommend.test.ts`

완료 조건:

- UI 프로젝트와 backend 프로젝트에서 추천 결과가 달라짐
- `qa_headless` 를 정상적으로 추천 가능

---

### Sprint 4. Guided Install

목표:

- `acorn install` 을 clone loop 에서 planner 로 확장
- auto 보다 guided/detect-only 먼저 제공

핵심 작업:

1. `src/commands/install.ts`
   - v2 legacy path 유지
   - v3 path 추가
2. install mode 추가
   - `auto`
   - `guided`
   - `detect-only`
3. guided output
   - project profile
   - recommended capabilities
   - recommended providers
   - install steps

테스트:

- `tests/install-guided-v3.test.ts`
- `tests/install-detect-only-v3.test.ts`

완료 조건:

- 사용자가 웹 검색 없이 다음 행동을 알 수 있음
- v2 install 은 그대로 동작

---

### Sprint 5. Preset Layer

목표:

- preset 조회/설정 지원
- legacy phase 를 alias 로 유지

핵심 작업:

1. 신규 명령 또는 기존 명령 확장
   - `acorn preset`
   - `acorn preset <name>`
2. legacy alias 매핑
   - `prototype`
   - `dev`
   - `production`
3. capability 활성화 계산 함수 추가

변경 후보:

- `src/core/phase.ts`
- `src/commands/phase.ts`
- `src/commands/preset.ts`
- `src/index.ts`

테스트:

- `tests/preset.test.ts`
- `tests/phase-legacy-alias.test.ts`

완료 조건:

- preset 설정이 capability 집합으로 해석됨
- legacy phase 사용자도 깨지지 않음

---

### Sprint 6. Status & Doctor

목표:

- capability/provider 중심 상태 확인
- 부족한 provider 와 drift 를 쉽게 파악

핵심 작업:

1. `src/commands/status.ts`
   - active preset
   - enabled capabilities
   - capability -> provider 매핑
   - detect 결과
2. `src/commands/doctor.ts`
   - capability enabled but provider missing
   - provider installed but lock mismatch
   - recommended but missing capability/provider

테스트:

- `tests/status-v3.test.ts`
- `tests/doctor-v3.test.ts`

완료 조건:

- status 출력만 봐도 현재 스택을 이해할 수 있음
- doctor 가 실제 행동 가능한 경고를 보여줌

---

### Sprint 7. Hooks & QA

목표:

- hooks capability 연결
- `qa_headless` capability 슬롯 완성

핵심 작업:

1. `src/core/hooks.ts`
   - v2 legacy guard hook 유지
   - v3 + hooks capability + claudekit provider 처리
2. 신규 파일
   - `src/core/qa-headless.ts`
3. manual checklist 출력
   - backend/service 프로젝트용

테스트:

- `tests/hooks-v3-provider-managed.test.ts`
- `tests/qa-headless.test.ts`

완료 조건:

- hooks 는 provider-managed 상태를 표현 가능
- `qa_headless` 는 provider 없어도 first-class capability 로 동작

---

### Sprint 8. Docs & Migration

목표:

- 사용자 문서와 템플릿 정리
- migration path 제시

핵심 작업:

1. `README.md`
2. `CLAUDE.md`
3. `docs/HANDOVER.md`
4. `templates/harness.lock.template.json`
5. 필요 시 changelog 정리

완료 조건:

- 새 사용자는 capability 용어만 읽어도 이해 가능
- 기존 사용자는 migration 방법을 알 수 있음

---

## 6. Sprint 실행 순서

반드시 아래 순서를 권장한다.

1. Sprint 1
2. Sprint 2
3. Sprint 3
4. Sprint 4
5. Sprint 5
6. Sprint 6
7. Sprint 7
8. Sprint 8

Sprint 0 은 사람 합의용이라 코드 작업 전후 아무 때나 가능하다.

---

## 7. 위험한 작업

아래는 조심해야 한다.

1. `src/commands/install.ts` 대규모 재작성
2. `prototype/dev/production` 완전 제거
3. claudekit hook registry 복제
4. `latest` 기반 install command 도입
5. qa_ui 와 qa_headless 를 하나로 뭉개는 것

---

## 8. 구현 우선순위 요약

지금 가장 먼저 가치가 나는 기능은 이 세 가지다.

1. schema v3 읽기
2. guided install 출력
3. recommend 엔진

이 셋만 돼도 acorn 은 “설치와 조합 추천을 대신해주는 제품”으로 바뀌기 시작한다.

---

## 9. Claude Code 사용 방법

아래 파일들을 sprint 단위로 Claude Code 에 전달하면 된다.

- `docs/prompts/claude-code/sprint-01-schema-v3.md`
- `docs/prompts/claude-code/sprint-02-provider-registry.md`
- `docs/prompts/claude-code/sprint-03-recommend-engine.md`
- `docs/prompts/claude-code/sprint-04-guided-install.md`
- `docs/prompts/claude-code/sprint-05-preset-layer.md`
- `docs/prompts/claude-code/sprint-06-status-doctor.md`
- `docs/prompts/claude-code/sprint-07-hooks-qa.md`
- `docs/prompts/claude-code/sprint-08-docs-migration.md`

한 번에 여러 sprint 를 섞지 말고, 한 sprint 씩 끝내는 방식이 안전하다.
