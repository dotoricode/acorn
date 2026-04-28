# acorn v2 설계 수정안

> 목표는 단순하다.  
> 여러 하네스 툴을 직접 공부해서 조합하는 일을 사용자에게 떠넘기지 않고,  
> **acorn 이 capability 단위로 최적 조합을 학습하고 설치/활성화/안내까지 맡는다.**

**Status: IMPLEMENTED (2026-04-28) — 본 문서는 capability-first 재설계 기록.
v0.9.0 출시로 M1~M7 모두 완료. 후속 v0.9.x 트랙은 별도 plan.**

---

## 1. 한 줄 결론

기존 v2 초안의 핵심 문제는 다음 셋이다.

1. vendor 중심이다
2. 2-preset 전제가 너무 이르다
3. acorn 이 각 vendor 의 비공식 설치 우회 레이어가 되려 한다

이 수정안은 방향을 바꾼다.

- phase 는 `planning`, `spec`, `tdd`, `review`, `qa_ui`, `qa_headless`, `hooks`, `memory` 같은 **쉬운 capability 단위**로 쪼갠다
- preset 은 2개/3개를 강제하지 않는다
- acorn 은 “툴 모음집”이 아니라 **capability orchestrator + installer guide + recommendation engine** 이 된다
- vendor 는 수단일 뿐이며, lock/schema/설치 로직의 중심이 되지 않는다

---

## 2. acorn 의 진짜 역할

acorn 이 풀고 싶은 문제는 “좋은 하네스 툴이 너무 많다”가 아니다.

진짜 문제는 이거다.

- 어떤 툴이 planning 에 강한지 사용자가 매번 조사해야 한다
- 어떤 툴이 spec/TDD/review/QA 에 적합한지 직접 판단해야 한다
- 설치 방법이 제각각이라 매번 찾아봐야 한다
- 같이 켰을 때 충돌하는 조합을 사용자가 몸으로 배워야 한다

따라서 acorn 의 역할은 아래 4개여야 한다.

1. capability 모델 제공
2. 현재 프로젝트에 맞는 조합 추천
3. 설치/업데이트/활성화 방법 안내 또는 자동 실행
4. 선택된 조합을 lock 으로 고정하고 drift 를 감시

즉, acorn 은 “여러 하네스의 장점만 뽑아 쓰는 관리자”가 맞다.  
다만 그 단위는 vendor 가 아니라 **capability** 여야 한다.

---

## 3. 새 핵심 모델

### 3-A. Phase = capability

`phase` 라는 말을 유지하되, 의미를 바꾼다.

기존:

- prototype
- dev
- production

신규:

- `planning`
- `spec`
- `tdd`
- `review`
- `qa_ui`
- `qa_headless`
- `hooks`
- `memory`

각 phase 는 “지금 프로젝트가 어느 제품 단계인가”가 아니라,  
**어떤 능력을 지금 환경에 활성화할 것인가**를 뜻한다.

이게 더 좋은 이유:

- 한국 사용자에게 직관적이다
- vendor 교체와 독립적이다
- 여러 phase 를 동시에 켤 수 있다
- 실제 트렌드인 “작업 유형별 보조 능력 조합”과 맞다

---

### 3-B. Preset = phase 묶음

preset 은 더 이상 `prototype/dev` 같은 거대한 모드가 아니다.  
그냥 capability bundle 이다.

예시:

- `lite`: `planning`, `review`
- `builder`: `planning`, `spec`, `tdd`, `review`
- `fullstack`: `planning`, `spec`, `tdd`, `review`, `qa_ui`, `hooks`
- `backend`: `planning`, `spec`, `tdd`, `review`, `qa_headless`, `hooks`
- `memory-heavy`: `planning`, `review`, `memory`, `hooks`

중요:

- preset 개수는 고정하지 않는다
- preset 이름은 사용자 친화적으로 둘 수 있지만, 내부 모델은 capability 기준이다
- preset 은 기본 추천 세트일 뿐이고 사용자는 capability 를 직접 on/off 할 수 있다

---

### 3-C. Vendor = provider

vendor 라는 말 대신 `provider` 로 부른다.

이유:

- acorn 이 진짜 관리하는 것은 저장소가 아니라 capability 제공자다
- 같은 capability 를 여러 provider 가 제공할 수 있다
- 한 provider 가 여러 capability 를 동시에 제공할 수 있다

예시:

- `gstack` → `planning`, `review`, 일부 `qa_ui`
- `superpowers` → `spec`, `tdd`, `review`
- `gsd` → `planning`, `spec`, 일부 `memory`
- `claudekit` → `hooks`

핵심은 이것이다.

> acorn 은 “gstack 을 설치할까?”를 먼저 묻지 않는다.  
> “이 프로젝트에 planning 과 review 는 누가 담당하는 게 최적인가?”를 먼저 판단한다.

---

## 4. 추천 아키텍처

### 4-A. Capability registry

`harness.lock` 또는 별도 registry 에 아래 정보를 기록한다.

```typescript
type CapabilityName =
  | 'planning'
  | 'spec'
  | 'tdd'
  | 'review'
  | 'qa_ui'
  | 'qa_headless'
  | 'hooks'
  | 'memory'

interface ProviderEntry {
  source: {
    type: 'git' | 'npm' | 'plugin' | 'manual'
    repo?: string
    package?: string
    version?: string
    ref?: string
  }
  install: {
    strategy: 'clone' | 'npx' | 'npm-global' | 'plugin-marketplace' | 'manual'
    command?: string
    verify_command?: string
    uninstall_command?: string
    docs_url?: string
  }
  capabilities: Partial<Record<CapabilityName, ProviderCapability>>
  conflicts?: string[]
  priority?: number
  verified_at: string
}

interface ProviderCapability {
  strength: 'primary' | 'secondary' | 'experimental'
  activation: 'auto' | 'opt-in'
  notes?: string
}
```

이 구조의 장점:

- 설치 방식과 capability 를 분리한다
- plugin/native installer 를 정식 1급 시민으로 다룬다
- 같은 provider 안에서도 capability 강약을 표현할 수 있다
- 이후 provider 추가가 쉽다

---

### 4-B. Project profile

acorn 은 프로젝트를 분석해서 profile 을 만든다.

예시:

```json
{
  "project_profile": {
    "ui": true,
    "backend_jobs": false,
    "api_service": true,
    "test_maturity": "medium",
    "repo_size": "medium",
    "team_size": "solo",
    "preferred_style": "pragmatic"
  }
}
```

이 profile 로 capability 우선순위를 정한다.

예:

- UI 중심 앱 → `qa_ui` 우선
- 배치/잡/웹훅 중심 → `qa_headless` 우선
- 테스트가 약함 → `tdd` 강한 provider 우선
- 솔로 개발 + 빠른 탐색 → planning 을 너무 무거운 체계로 잡지 않음

---

### 4-C. Recommendation engine

acorn 은 아래 3단계로 조합을 추천한다.

1. 필요한 capability 추론
2. capability 별 후보 provider 점수화
3. 충돌/중복 제거 후 최종 조합 제안

예시 출력:

```text
Recommended stack for this project

- planning: gstack (primary)
- spec: superpowers (primary)
- tdd: superpowers (primary)
- review: gstack (primary), superpowers (secondary)
- qa_ui: disabled
- qa_headless: disabled
- hooks: claudekit (primary)
- memory: disabled

Why:
- UI 없는 API 서비스라 qa_ui 불필요
- 테스트가 있지만 discipline 이 약해 tdd capability 가치 높음
- 빠른 planning 은 gstack 이 더 적합, execution discipline 은 superpowers 가 더 강함
```

이게 acorn 이 해야 할 “학습”이다.  
사용자 대신 capability-provider mapping 을 최적화하는 것이다.

---

## 5. 현재 트렌드를 반영한 기본 해석

2026년 기준으로 대체로 이렇게 보는 게 합리적이다.

### planning

- 1순위: `gstack`
- 2순위: `gsd`

이유:

- gstack 은 아이디어 구체화, 검토, 역할 분리형 planning 에 강하다
- GSD 는 목표가 분명할 때 spec-driven 흐름이 강하다
- 탐색 단계까지 항상 GSD 를 기본으로 넣으면 과해질 수 있다

### spec

- 1순위: `superpowers`
- 2순위: `gsd`

이유:

- superpowers 는 설계 승인 후 계획 분해와 구현 discipline 이 강하다
- GSD 는 end-to-end 문맥 설계가 강하지만, 모든 프로젝트의 기본 spec 엔진으로 고정할 필요는 없다

### tdd

- 1순위: `superpowers`

이 capability 에서는 superpowers 색채가 매우 분명하다.  
굳이 중복 provider 를 기본 탑재할 이유가 적다.

### review

- 1순위: `gstack`
- 2순위: `superpowers`

이유:

- gstack 은 역할 기반 review 관점이 강점이다
- superpowers 는 계획/구현 일치성 리뷰에 강하다

### qa_ui

- 1순위: `gstack`

단, 모든 프로젝트 기본값으로 넣으면 안 된다.  
웹 UI 가 있는 프로젝트에서만 추천해야 한다.

### qa_headless

- 기본 provider 없음

중요하다.  
이 capability 는 현재 시장에서도 아직 표준 승자가 없다.  
따라서 v2 에서는 “비워두는 것”이 맞다.  
acorn 이 미래 provider 를 붙일 수 있는 빈 슬롯으로 설계해야 한다.

### hooks

- 1순위: `claudekit`

hooks 는 capability 와 installer 가 강하게 묶여 있으므로  
acorn 이 직접 hook 의미론을 복제하지 말고 claudekit 을 우선 provider 로 써야 한다.

### memory

- 기본 provider 없음 또는 experimental

메모리는 멋있어 보이지만 쉽게 오염된다.  
v2 초기에는 실험 capability 로 두는 편이 낫다.

---

## 6. 공격적 결론: 무엇을 버려야 하나

### 6-A. “필수 vendors 4개” 전제를 버린다

기존 초안은 `gstack/superpowers/gsd/claudekit` 를 사실상 필수 묶음으로 취급한다.  
이건 나쁜 기본값이다.

버려야 하는 이유:

- 과설치
- 역할 중복
- 충돌 가능성
- 학습 비용 증가
- 설치/업데이트 실패 지점 증가

신규 원칙:

- 기본은 **필수 vendor 없음**
- capability 별로 필요한 provider 만 선택
- 설치되지 않은 provider 는 안내하고, 필요시 자동 설치 옵션 제공

---

### 6-B. “skills cherry-pick” 을 중심 축으로 두지 않는다

skills cherry-pick 자체는 유용하다.  
하지만 v2 의 중심 구조로 두면 안 된다.

이유:

- provider repo 구조가 변하면 쉽게 깨진다
- 공식 installer/plugin 경로와 충돌한다
- acorn 이 사실상 비공식 포장기를 떠맡게 된다

신규 원칙:

- 1순위: 공식 plugin/installer 사용
- 2순위: 공식 git clone/setup 사용
- 3순위: acorn custom cherry-pick 은 최후의 fallback

즉, cherry-pick 은 capability 가 아니라 **배포 최적화 기법** 이어야 한다.

---

### 6-C. `install_cmd + commit` 가짜 고정도 버린다

`npx latest` 와 `commit` 메모를 같이 두는 건 재현 가능한 lock 이 아니다.

신규 원칙:

- npm/npx 계열은 반드시 버전 고정
- plugin marketplace 는 plugin version 또는 release tag 고정
- git clone 은 commit SHA 고정
- manual install 은 “잠금 불가” 상태로 명시

---

## 7. 새 스키마 제안

### 7-A. schema_version 3

```json
{
  "schema_version": 3,
  "acorn_version": "0.9.0",
  "capabilities": {
    "planning": { "enabled": true, "provider": "gstack" },
    "spec": { "enabled": true, "provider": "superpowers" },
    "tdd": { "enabled": true, "provider": "superpowers" },
    "review": { "enabled": true, "provider": "gstack" },
    "qa_ui": { "enabled": false },
    "qa_headless": { "enabled": false },
    "hooks": { "enabled": true, "provider": "claudekit" },
    "memory": { "enabled": false }
  },
  "providers": {
    "gstack": {
      "source": {
        "type": "git",
        "repo": "garrytan/gstack",
        "ref": "FILL_SHA"
      },
      "install": {
        "strategy": "clone",
        "command": "./setup --host claude",
        "verify_command": "test -d .claude/skills/gstack"
      },
      "capabilities": {
        "planning": { "strength": "primary", "activation": "auto" },
        "review": { "strength": "primary", "activation": "auto" },
        "qa_ui": { "strength": "secondary", "activation": "opt-in" }
      },
      "verified_at": "FILL_DATE"
    },
    "superpowers": {
      "source": {
        "type": "plugin",
        "repo": "obra/superpowers",
        "version": "FILL_VERSION"
      },
      "install": {
        "strategy": "plugin-marketplace",
        "command": "/plugin install superpowers@superpowers-marketplace",
        "docs_url": "https://github.com/obra/superpowers"
      },
      "capabilities": {
        "spec": { "strength": "primary", "activation": "auto" },
        "tdd": { "strength": "primary", "activation": "auto" },
        "review": { "strength": "secondary", "activation": "auto" }
      },
      "verified_at": "FILL_DATE"
    },
    "gsd": {
      "source": {
        "type": "npm",
        "repo": "gsd-build/get-shit-done",
        "version": "FILL_VERSION"
      },
      "install": {
        "strategy": "npx",
        "command": "npx get-shit-done-cc@FILL_VERSION --claude --local",
        "docs_url": "https://github.com/gsd-build/get-shit-done"
      },
      "capabilities": {
        "planning": { "strength": "secondary", "activation": "opt-in" },
        "spec": { "strength": "secondary", "activation": "opt-in" }
      },
      "verified_at": "FILL_DATE"
    },
    "claudekit": {
      "source": {
        "type": "npm",
        "repo": "carlrannaberg/claudekit",
        "version": "FILL_VERSION"
      },
      "install": {
        "strategy": "npm-global",
        "command": "npm install -g claudekit@FILL_VERSION && claudekit setup --yes",
        "docs_url": "https://github.com/carlrannaberg/claudekit"
      },
      "capabilities": {
        "hooks": { "strength": "primary", "activation": "auto" }
      },
      "verified_at": "FILL_DATE"
    }
  },
  "presets": {
    "builder": ["planning", "spec", "tdd", "review", "hooks"],
    "frontend": ["planning", "spec", "review", "qa_ui", "hooks"],
    "backend": ["planning", "spec", "tdd", "review", "qa_headless", "hooks"]
  }
}
```

---

### 7-B. 핵심 규칙

1. capability 가 최상위다
2. provider 는 capability 의 구현체다
3. preset 은 capability 배열이다
4. 설치 전략은 provider 마다 다를 수 있다
5. lock 은 “현재 활성 capability 조합 + provider 해석 결과”를 기록한다

---

## 8. 설치 철학

사용자는 설치 방법을 매번 찾아다니고 싶지 않다.  
이건 acorn 이 해결해야 한다.

### 8-A. Install mode 3단계

#### auto

가능한 provider 는 acorn 이 직접 설치한다.

- plugin marketplace 명령 실행
- npm/npx 실행
- git clone/setup 실행

#### guided

acorn 이 단계별 안내만 한다.

예:

```text
Capability "spec" needs provider "superpowers".

Install steps:
1. Claude Code 에서 marketplace 등록:
   /plugin marketplace add obra/superpowers-marketplace
2. plugin 설치:
   /plugin install superpowers@superpowers-marketplace
3. 새 세션 시작 후 동작 확인
```

#### detect-only

acorn 은 현재 시스템에 이미 무엇이 설치되어 있는지만 검사하고 추천만 한다.

---

### 8-B. Install UX

`acorn install` 은 더 이상 단순 clone 루프가 아니다.

원하는 UX:

```text
$ acorn install

Project profile detected:
- UI: no
- API/backend: yes
- background jobs: yes
- test maturity: low

Recommended capabilities:
- planning
- spec
- tdd
- review
- qa_headless
- hooks

Recommended providers:
- planning -> gstack
- spec -> superpowers
- tdd -> superpowers
- review -> gstack
- qa_headless -> none yet (manual workflow recommended)
- hooks -> claudekit

Install plan:
- gstack: clone + setup
- superpowers: plugin marketplace
- claudekit: npm global install

Continue? [Y/n]
```

이게 acorn 이 사용자 시간을 절약하는 지점이다.

---

## 9. qa_headless 에 대한 명시적 입장

기존 초안은 QA 를 너무 UI 중심으로 바라봤다.  
이건 2026년 현실과 안 맞는다.

실제 프로젝트는 아래가 많다.

- cron
- worker
- webhook
- notifier
- CLI
- ETL

따라서 `qa_headless` 는 독립 capability 여야 한다.

v2 에서의 현실적 전략:

1. capability 자체는 schema 에 넣는다
2. 기본 provider 는 비워둔다
3. acorn 은 provider 가 없을 때 manual checklist 를 제공한다
4. 추후 provider 등장 시 바로 연결 가능하게 만든다

즉, “지금 표준 provider 가 없다”는 이유로 capability 를 빼면 안 된다.

---

## 10. hooks 에 대한 명시적 입장

기존 초안의 가장 위험한 부분은 acorn 이 claudekit hook 의미론을 직접 복제하려는 점이었다.

이건 축소해야 한다.

신규 원칙:

1. hooks capability 의 1순위 provider 는 claudekit
2. acorn 은 hook registry 를 전부 복제하지 않는다
3. acorn 은 preset 별 “원하는 hook 목록”만 선언한다
4. 실제 설치/활성화는 provider 에 위임한다
5. provider 부재 시에는 최소 fallback 만 허용한다

최소 fallback 예:

- file guard
- checkpoint

그 이상은 provider 의 책임으로 남긴다.

---

## 11. memory 에 대한 명시적 입장

memory 는 멋있지만 초기에 과투자하면 안 된다.

v2 에서의 위치:

- phase 로는 포함
- 기본값은 disabled
- provider 는 optional/experimental
- acorn 은 “memory 를 어디에 붙일지”보다 “오염 없이 끌 수 있게” 설계

즉, memory 는 v2 핵심 selling point 가 아니라 확장 슬롯이다.

---

## 12. 구현 단계 재작성

> **상태 (2026-04-28)**: M1~M7 모두 v0.9.0 단일 릴리스로 완료. 본 문서의 마일스톤별
> 버전 표기는 원안 기획 시점 (2026-04-22) 의 추정치였으며, 실제 출시 트랙은
> Sprint 1~9 를 한 번에 v0.9.0 에 묶어 출하. 이후 v0.9.1+ 트랙은 별도 plan 참조
> (`/Users/youngsang.kwon/.claude-personal/plans/tingly-sprouting-sun.md`).

### M1. Capability-first schema (v0.9.1) — ✅ 완료 (Sprint 1)

변경:

- `schema_version = 3`
- `capabilities`, `providers`, `presets` 타입 추가
- 기존 `tools` 중심 파싱은 하위 호환으로만 유지

목표:

- acorn 의 내부 모델을 vendor-first 에서 capability-first 로 전환

---

### M2. Provider registry + detection (v0.9.2) — ✅ 완료 (Sprint 2)

변경:

- provider 설치 방식 정의
- provider detect 함수 추가
- plugin/npm/git/manual 설치 전략 공통 인터페이스 추가

목표:

- “무엇을 설치할지”보다 “무엇이 이미 있는지”와 “어떻게 설치할지”를 먼저 판단

---

### M3. Recommendation engine (v0.9.3) — ✅ 완료 (Sprint 3)

변경:

- project profile 추론
- capability 추천
- provider 점수화
- 충돌/중복 제거

목표:

- acorn 이 조합을 추천하는 제품이 되기 시작

---

### M4. Install UX rewrite (v0.9.4) — ✅ 완료 (Sprint 4 + Sprint 9)

변경:

- `acorn install` 을 clone loop 에서 install planner 로 전환
- `auto/guided/detect-only` 모드 도입

목표:

- 사용자가 설치법을 검색하지 않아도 되게 만들기

---

### M5. hooks + capability activation (v0.9.5) — ✅ 완료 (Sprint 7)

변경:

- hooks capability 연결
- claudekit provider 우선
- 최소 fallback 만 유지

목표:

- 가장 위험한 drift 영역을 provider 위임 방식으로 축소

---

### M6. qa_headless slot + manual playbook (v0.9.6) — ✅ 완료 (Sprint 7)

변경:

- `qa_headless` capability 활성화
- provider 없을 때 manual checklist/report 생성

목표:

- backend-heavy 프로젝트를 정식 1급 시민으로 올리기

---

### M7. docs + migration (v0.9.7) — ✅ 완료 (Sprint 8)

변경:

- README
- CLAUDE.md
- HANDOVER
- 기존 prototype/dev/production 서술 정리

목표:

- 제품 언어를 capability 언어로 통일

---

## 13. 하위 호환 정책

기존 사용자를 깨뜨리면 안 된다.

원칙:

1. `prototype/dev/production` phase 는 당장 제거하지 않는다
2. 내부적으로는 legacy preset alias 로 해석한다
3. 예:
   - `prototype` -> `planning`, `review`
   - `dev` -> `planning`, `spec`, `tdd`, `review`, `hooks`
   - `production` -> `review`, `hooks` + stricter guard profile
4. 새 문서와 새 UX 에서는 capability 용어를 우선 사용한다

즉, 마이그레이션은 점진적으로 간다.

---

## 14. 권장 기본 preset 초안

이 문서는 preset 개수를 강제하지 않지만, 현실적으로 시작점은 필요하다.

### `starter`

- `planning`
- `review`

대상:

- 툴에 익숙하지 않은 사용자
- 최소 학습 비용

### `builder`

- `planning`
- `spec`
- `tdd`
- `review`
- `hooks`

대상:

- 대부분의 앱/서비스 개발

### `frontend`

- `planning`
- `spec`
- `review`
- `qa_ui`
- `hooks`

대상:

- 웹 UI 중심 프로젝트

### `backend`

- `planning`
- `spec`
- `tdd`
- `review`
- `qa_headless`
- `hooks`

대상:

- API, worker, cron, webhook 중심 프로젝트

이 4개 정도면 시작점으로 충분하다.  
2개로 억지로 줄이는 것보다 훨씬 낫다.

---

## 15. 이 수정안의 제품 메시지

사용자에게는 이렇게 설명하면 된다.

> acorn 은 여러 AI coding harness 의 장점을 capability 단위로 조합해 주는 관리자다.  
> planning, spec, tdd, review, qa, hooks 같은 능력을 프로젝트에 맞게 추천하고,  
> 필요한 툴의 설치 방법도 자동 실행하거나 단계별로 안내한다.  
> 사용자는 각 하네스를 따로 공부하지 않아도 된다.

이 메시지가 현재 초안보다 훨씬 강하다.

---

## 16. 최종 권고

### 유지할 것

- 여러 하네스의 장점만 뽑아 쓰겠다는 방향
- schema_version 3 전환
- 설치 자동화/안내 강화
- 최소 friction install UX

### 버릴 것

- 2-preset 강박
- 필수 vendor 4종 묶음
- vendor-first schema
- `latest` 기반 install_cmd + 가짜 commit 고정
- acorn 이 provider 의미론 전체를 복제하려는 태도

### 새 기준

- capability-first
- provider-second
- preset-flexible
- install-guided
- drift-aware

이 기준으로 다시 설계해야 acorn 이 오래 간다.
