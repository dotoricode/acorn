# acorn v2 설계 기획안

> 기존 ECC + OMC + gstack 조합을 폐기하고,  
> 2026년 기준 검증된 도구의 장점만 cherry-pick한 **2-프리셋 시스템** 구축.  
> 버전 트랙: v0.9.x (npm publish 전 최종 단계) → v1.0.0

**Status: PLANNING (2026-04-21)**

---

## 1. 변경 요약

| 구분 | 기존 (v0.9.0) | 신규 (v0.9.x) |
|---|---|---|
| schema_version | 2 | 3 |
| 필수 vendors | omc, gstack, ecc | gstack, superpowers, gsd, claudekit |
| 스킬 설치 방식 | 전체 clone | cherry-pick (`skills[]`) |
| Phase 조건부 활성 | 없음 | `phases[]` 필드 |
| 훅 배포 | guard-check.sh 단일 | claudekit preset (prototype/dev 구분) |
| 설치 방식 | git clone 전용 | git clone + `install_cmd` (npm 기반) |
| Preset 개념 | 없음 | `presets{}` 섹션 |

---

## 2. 신규 Vendors

| Vendor | Repo | 설치 방식 | 활성 Phase |
|---|---|---|---|
| **gstack** | `garrytan/gstack` | git clone | prototype, dev |
| **superpowers** | `obra/superpowers` | git clone | dev 전용 |
| **gsd** | `gsd-build/get-shit-done` | `install_cmd` (npx) | prototype, dev |
| **claudekit** | `carlrannaberg/claudekit` | `install_cmd` (npm) | prototype, dev |

**제거:** `omc` (Yeachan-Heo/oh-my-claudecode), `ecc` (affaan-m/everything-claude-code)

---

## 3. harness.lock 스키마 v3

### 3-A. ToolEntry 확장 필드

```typescript
interface ToolEntry {
  repo: string
  commit: string
  verified_at: string
  phases?: ('prototype' | 'dev' | 'production')[]  // 없으면 전체 phase 활성
  skills?: string[]                                 // 없으면 전체 설치
  install_cmd?: string                              // git clone 대신 실행할 npm 커맨드
}
```

- `phases` 없음 → 모든 phase에서 활성 (하위 호환)
- `skills` 없음 또는 빈 배열 → 전체 설치 (하위 호환)
- `install_cmd` 있음 → git clone/checkout 건너뜀, 해당 커맨드 실행

### 3-B. PresetEntry 신규 타입

```typescript
interface PresetEntry {
  description: string
  hooks: {
    common: string[]   // claudekit hook 이름 배열
  }
}
```

### 3-C. HarnessLock v3 전체 구조

```json
{
  "_comment": "...",
  "schema_version": 3,
  "acorn_version": "0.9.0",
  "tools": {
    "gstack": {
      "repo": "garrytan/gstack",
      "commit": "FILL_SHA",
      "verified_at": "FILL_DATE",
      "phases": ["prototype", "dev"],
      "skills": [
        "autoplan", "plan-ceo-review", "plan-eng-review",
        "plan-design-review", "cso", "ship", "review",
        "qa-only", "investigate", "office-hours"
      ]
    },
    "superpowers": {
      "repo": "obra/superpowers",
      "commit": "FILL_SHA",
      "verified_at": "FILL_DATE",
      "phases": ["dev"],
      "skills": [
        "test-driven-development", "writing-plans",
        "subagent-driven-development", "brainstorming",
        "systematic-debugging", "verification-before-completion",
        "requesting-code-review", "using-git-worktrees"
      ]
    },
    "gsd": {
      "repo": "gsd-build/get-shit-done",
      "commit": "FILL_SHA",
      "verified_at": "FILL_DATE",
      "phases": ["prototype", "dev"],
      "install_cmd": "npx get-shit-done-cc --claude --local --no-sdk",
      "skills": []
    },
    "claudekit": {
      "repo": "carlrannaberg/claudekit",
      "commit": "FILL_SHA",
      "verified_at": "FILL_DATE",
      "phases": ["prototype", "dev"],
      "install_cmd": "npm install -g claudekit && claudekit setup --yes",
      "skills": []
    }
  },
  "optional_tools": {},
  "guard": { "mode": "block", "patterns": "strict" },
  "presets": {
    "prototype": {
      "description": "빠른 실험, 아이디어 검증, 구조 탐색",
      "hooks": {
        "common": [
          "file-guard", "codebase-map", "thinking-level", "create-checkpoint"
        ]
      }
    },
    "dev": {
      "description": "TDD 강제, 코드 품질, 리뷰, 보안",
      "hooks": {
        "common": [
          "file-guard", "codebase-map", "thinking-level", "create-checkpoint",
          "typecheck-changed", "lint-changed", "test-changed",
          "check-any-changed", "self-review", "check-todos"
        ]
      }
    }
  }
}
```

---

## 4. Preset 설계

### Prototype — 빠른 spike, 아이디어 구체화

**활성 vendors:** gstack + gsd + claudekit  
**비활성:** superpowers (TDD 강제는 prototype에서 속도를 죽인다)

**gstack cherry-pick (prototype):**
- `autoplan`, `plan-ceo-review`, `plan-design-review`, `office-hours`, `investigate`
- 제외: `plan-eng-review`, `cso`, `ship`, `review`, `qa-only` (dev 전용)

**claudekit 훅 (prototype 최소 세트 4개):**
- `file-guard` — 민감 파일 보호
- `codebase-map` — 세션 시작 시 컨텍스트 주입
- `thinking-level` — 추론 강화
- `create-checkpoint` — Stop 시 자동 git 체크포인트

---

### Dev — 프로덕션 코드, TDD 강제, 보안/품질/리뷰

**활성 vendors:** gstack + superpowers + gsd + claudekit  

**superpowers cherry-pick (dev 전용):**
- `test-driven-development`, `writing-plans`, `subagent-driven-development`
- `brainstorming`, `systematic-debugging`, `verification-before-completion`
- `requesting-code-review`, `using-git-worktrees`
- 제외: `executing-plans`, `dispatching-parallel-agents`, `finishing-a-development-branch`, `receiving-code-review`, `writing-skills`

**gstack cherry-pick (dev에서 추가):**
- prototype 5개 + `plan-eng-review`, `cso`, `ship`, `review`, `qa-only`

**claudekit 훅 (dev 전체 세트 10개):**
- prototype 4개 + `typecheck-changed`, `lint-changed`, `test-changed`, `check-any-changed`, `self-review`, `check-todos`

---

## 5. Skills 디렉토리 구조 차이

| Vendor | 구조 | cherry-pick 심링크 경로 |
|---|---|---|
| gstack | `{skill-name}/SKILL.md` (루트 직하) | `.claude/skills/{skill-name}` → `vendors/gstack/{skill-name}` |
| superpowers | `skills/{skill-name}/SKILL.md` | `.claude/skills/{skill-name}` → `vendors/superpowers/skills/{skill-name}` |

cherry-pick 로직은 두 구조를 모두 지원해야 한다.  
`install_cmd` 있는 vendor (gsd, claudekit)는 git clone 없이 커맨드만 실행 — skills 배열 무시.

---

## 6. schema_version 마이그레이션 정책

- v1 lock → in-memory v2로 투명 마이그레이션 (기존, v0.8.0+)
- v2 lock → v3와 함께 파싱 허용 (하위 호환 읽기)
- v3 lock → 신규 필드(skills/phases/presets) 완전 지원
- v2 → v3 자동 변환 없음: `acorn lock validate` 시 "schema_version 3 권장" 안내만
- v1/v2/v3 외 버전 → 거부 (기존 behavior 유지)

---

## 7. acorn phase 커맨드 — Preset diff 출력 (Step 6)

`acorn phase dev` 실행 시 전환 diff 출력:

```
Phase: prototype → dev

+ superpowers (skills: test-driven-development, writing-plans, ...)
+ gstack: plan-eng-review, cso, ship, review, qa-only
+ claudekit hooks: typecheck-changed, lint-changed, test-changed,
                   check-any-changed, self-review, check-todos

Changes will take effect on next acorn install.
Run acorn install to apply? [Y/n]
```

---

## 8. CLAUDE.md 마커 갱신 (Step 5)

기존 `ACORN:PHASE` 마커에 활성 vendors 정보 추가:

```
<!-- ACORN:PHASE=dev -->
<!-- ACORN:ACTIVE_VENDORS=gstack,superpowers,gsd,claudekit -->
<!-- ACORN:INACTIVE_VENDORS=none -->
```

---

## 9. 구현 단계별 계획

### ── MILESTONE 1: Schema + Vendors ─────────────────────────── v0.9.1–0.9.2

#### Step 1 — lock.ts 스키마 v3 확장 (v0.9.1)

**변경 파일:** `src/core/lock.ts`

1. `SCHEMA_VERSION` → `3`으로 변경
2. `TOOL_NAMES` → `['gstack', 'superpowers', 'gsd', 'claudekit']` (omc/ecc 제거)
3. `ALLOWED_REPOS` → 신규 4개 vendor repo로 교체
4. `ToolEntry` 인터페이스에 optional 필드 추가:
   - `phases?: readonly Phase[]`
   - `skills?: readonly string[]`
   - `install_cmd?: string`
5. `PresetEntry` / `HarnessLock.presets` 타입 추가
6. `parseLock` 수정:
   - schema_version 1/2/3 모두 허용 (1/2는 기존, 3은 신규)
   - `validateToolEntry`: `phases`, `skills`, `install_cmd` optional 파싱 추가
   - `presets` 섹션 optional 파싱 추가 (`validatePresets`)
   - 기존 TOOL_NAMES 강제 검사 제거 → 동적 검사로 전환
     (schema_version 3에서는 tools 키 집합을 TOOL_NAMES로 고정하지 않음)

**불변식 유지:**
- schema_version 1/2 lock 파싱은 현재와 동일하게 동작
- ACORN_ALLOW_ANY_REPO=1 escape hatch 유지

---

#### Step 2 — vendors.ts cherry-pick + phase filter + install_cmd (v0.9.2)

**변경 파일:** `src/core/vendors.ts`

1. `InstallVendorOptions` (또는 `installVendor` 시그니처)에 추가:
   - `skills?: readonly string[]` — cherry-pick 목록
   - `phases?: readonly Phase[]` — 활성 phase 조건
   - `currentPhase: Phase` — 현재 phase.txt 값
   - `install_cmd?: string` — npm 설치 커맨드 대체
   - `skillsRootInVendor?: string` — vendor 내 skills 루트 (`'skills/'` for superpowers, `''` for gstack)

2. `installVendor` 내부 분기 추가:
   ```
   if (install_cmd 있음):
     → git clone 건너뜀
     → install_cmd 실행 (ShellRunner 인터페이스로 주입 가능)
     → skills 배열 무시
   else:
     → 기존 git clone/checkout (GitRunner)

   if (phases 있고 currentPhase 미포함):
     → vendor clone은 수행 (캐시 목적)
     → skills 심링크 노출만 건너뜀 (inactive 표시)
   else:
     → 활성: cherry-pick 또는 전체 심링크
   ```

3. cherry-pick 심링크 로직 (`linkSkills`):
   ```
   if (skills 비어있거나 없음):
     → 기존 방식: vendor 디렉토리 전체를 .claude/skills/{vendor}로 심링크
   else:
     → skills 배열 순회
     → src = vendors/{vendor}/{skillsRootInVendor}/{skill}
     → dst = .claude/skills/{skill}
     → inspectSymlink/createSymlink 재사용
   ```

4. `ShellRunner` 인터페이스 추가 (npm install_cmd 실행용):
   ```typescript
   interface ShellRunner {
     exec(cmd: string, cwd: string): void;
   }
   ```
   테스트용 stub: `noopShellRunner`, `captureShellRunner`

5. `installVendor` 반환 타입 `InstallVendorResult`에 `active: boolean` 추가:
   - `active: false` = phase 조건 미충족으로 비활성화된 vendor

---

#### Step 1-2 완료 후 TESTS ── v0.9.3

**신규 테스트 파일:**

`tests/lock-v3-schema.test.ts`
- schema_version 3 전체 구조 파싱 성공
- phases/skills/install_cmd optional 필드 파싱
- presets 섹션 파싱
- schema_version 1/2 하위 호환 파싱 (기존 테스트 캐리오버)
- schema_version 4+ 거부
- tools 키 유효성 검사 (schema v3에서 동적 허용)

`tests/vendor-cherry-pick.test.ts`
- skills 배열 있을 때: 지정 스킬만 .claude/skills/ 아래 노출
- skills 빈 배열: 전체 설치 (기존 동작)
- skills 없는 vendor: 전체 설치 (하위 호환)
- install_cmd 있을 때: GitRunner 호출 없이 ShellRunner.exec 호출
- superpowers 구조 (`skills/` 서브디렉토리 prefix)
- gstack 구조 (루트 직하)

`tests/vendor-phase-filter.test.ts`
- phases 있고 currentPhase 포함 → active=true, 심링크 노출
- phases 있고 currentPhase 미포함 → active=false, 심링크 미노출
- phases 없음 → 항상 active=true (하위 호환)
- prototype 전환 시 superpowers 비활성 확인
- dev 전환 시 superpowers 활성 확인

**기존 테스트 회귀 확인:**
- `npm test` 전체 311개 이상 통과

---

### ── MILESTONE 2: Hooks + Template + UX ──────────────────── v0.9.4–0.9.6

#### Step 3 — hooks.ts 프리셋 기반 배포 (v0.9.4)

**변경 파일:** `src/core/hooks.ts`

현재 `installGuardHook`은 `guard-check.sh` 단일 파일을 배포한다.  
신규 로직:

1. `installHooksPreset(opts)` 함수 추가:
   - `currentPhase: Phase`
   - `presets: Record<string, PresetEntry> | undefined`
   - `harnessRoot: string`
   - `settingsPath: string`

2. 동작:
   - `presets[currentPhase]?.hooks.common` 배열을 읽음
   - 배열이 없으면 기존 guard-check.sh 단일 배포로 폴백
   - 배열이 있으면 claudekit hook 활성화 흐름:
     - claudekit이 설치되어 있는지 확인 (`which claudekit` or `npx claudekit`)
     - 설치되어 있으면: `claudekit hooks add {hook-name}` 순서대로 실행
     - 설치 없으면: settings.json hooks 섹션을 직접 생성

3. settings.json hooks 섹션 직접 생성 (claudekit 없을 때 폴백):
   ```json
   {
     "hooks": {
       "PostToolUse": [ ... ],
       "Stop": [ ... ]
     }
   }
   ```
   claudekit 각 훅의 동작을 settings.json 형식으로 직접 기록.  
   hook 이름 → settings 섹션 매핑 테이블은 `src/core/hooks-registry.ts` 에 분리.

4. `installGuardHook`은 유지 (schema_version 2 이하 폴백용)

5. `runInstall` Step 7에서 호출 분기:
   - schema_version 3 + presets 있음 → `installHooksPreset`
   - 그 외 → 기존 `installGuardHook`

---

#### Step 4 — harness.lock.template.json 교체 (v0.9.4와 같은 커밋)

**변경 파일:** `templates/harness.lock.template.json`

기존 omc/gstack/ecc → 신규 gstack/superpowers/gsd/claudekit 구조로 교체.  
FILL_SHA / FILL_DATE 자리표시자 유지.  
`_comment` 내용 갱신 (schema v3 사용법 안내).

---

#### Step 5 — claude-md.ts 마커 갱신 (v0.9.5)

**변경 파일:** `src/core/claude-md.ts`

`applyClaudeMdUpdate` 함수에서 phase 마커 외 active/inactive vendors 마커 추가:

```
<!-- ACORN:PHASE=dev -->
<!-- ACORN:ACTIVE_VENDORS=gstack,superpowers,gsd,claudekit -->
<!-- ACORN:INACTIVE_VENDORS=none -->
```

`computeActiveVendors(lock, phase)` 헬퍼 함수 추가:
- lock.tools 순회
- `phases` 없거나 포함 → active
- `phases` 있고 미포함 → inactive

---

#### Step 6 — acorn phase 커맨드 — Preset diff 출력 (v0.9.5)

**변경 파일:** `src/commands/phase.ts`

`phase set` 시 기존 phase와 신규 phase 사이의 vendor/hook diff 출력:

```
Phase: prototype → dev

+ superpowers (skills: test-driven-development, writing-plans, ...)
+ gstack: plan-eng-review, cso, ship, review, qa-only
+ claudekit hooks: typecheck-changed, lint-changed, test-changed,
                   check-any-changed, self-review, check-todos
```

구현:
- `computePhaseDiff(lock, fromPhase, toPhase)` 함수 추가 (`src/core/phase-diff.ts`)
- 추가 vendors, 추가 skills, 추가 hooks를 diff로 계산
- `phase.ts` 커맨드에서 확인 전에 diff 먼저 출력
- diff가 없으면 출력 생략

---

#### Step 3-6 완료 후 TESTS ── v0.9.6

**신규 테스트 파일:**

`tests/hooks-phase-preset.test.ts`
- prototype phase: 4개 훅 세트 생성 확인
- dev phase: 10개 훅 세트 생성 확인
- presets 없는 lock → guard-check.sh 폴백
- claudekit 없을 때 settings.json 직접 생성 폴백
- 멱등: 동일 phase 재실행 시 noop

`tests/phase-diff.test.ts`
- prototype → dev: superpowers 추가, gstack skill 5개 추가, hook 6개 추가
- dev → prototype: 반대 방향 diff
- 같은 phase → diff 없음

**기존 테스트 전체 회귀 확인**

---

### ── MILESTONE 3: 문서 + 릴리스 ─────────────────────────── v0.9.7

#### 문서 업데이트

1. **CLAUDE.md**
   - `## 툴별 설치 방식` → omc/ecc 제거, superpowers/gsd/claudekit 추가
   - `## 주요 경로` → 신규 vendor 경로 추가
   - 프리셋별 활성 vendors 표 추가
   - 환경변수 섹션 갱신

2. **docs/acorn-v1-plan.md**
   - `## 1. 핵심 재정의` 배경 테이블 갱신 (omc/ecc → superpowers/gsd/claudekit)
   - `## 5. 충돌 해소 우선순위 테이블` → v2 preset 테이블로 교체
   - v0.9.x Done Definition 체크박스 추가

3. **README.md**
   - 지원 vendors 목록 갱신
   - Preset 개념 설명 추가 (prototype vs dev 단락)
   - harness.lock 예시 JSON 갱신

---

## 10. Done Definition

### Milestone 1 (v0.9.1–0.9.3)
- [ ] `npm test` — 기존 311개 + lock-v3/cherry-pick/phase-filter 신규 테스트 전부 통과
- [ ] `npm run build` — 클린 빌드
- [ ] schema_version 2 lock으로 기존 `acorn install` 정상 동작 (하위 호환)
- [ ] schema_version 3 lock 파싱 성공 (phases/skills/presets 포함)
- [ ] `installVendor`: skills 배열 있을 때 cherry-pick만 노출 확인
- [ ] `installVendor`: phases 조건 미충족 vendor → active=false, 심링크 없음 확인
- [ ] `installVendor`: install_cmd 있을 때 ShellRunner 호출, GitRunner 미호출

### Milestone 2 (v0.9.4–0.9.6)
- [ ] `acorn install` (stub) — prototype: superpowers 스킬 미노출, hooks 4개
- [ ] `acorn install` (stub) — dev: superpowers TDD 스킬 노출, hooks 10개
- [ ] `harness.lock.template.json` — schema_version 3, omc/ecc 없음
- [ ] `acorn phase dev` → diff 출력 확인 (추가 vendors/skills/hooks 표시)
- [ ] CLAUDE.md 마커 — ACORN:ACTIVE_VENDORS 포함

### Milestone 3 (v0.9.7)
- [ ] CLAUDE.md, README.md, docs/acorn-v1-plan.md 갱신 완료
- [ ] HANDOVER.md §1 갱신
- [ ] `git tag v0.9.7` + push

---

## 11. 주의사항 및 기술 결정

### GSD / claudekit install_cmd 처리

- `install_cmd` 필드가 있는 vendor는 git clone을 건너뜀
- `ShellRunner` 인터페이스로 주입 가능 → 테스트에서 captureShellRunner로 stub
- `commit` 필드는 여전히 필수 (harness.lock 불변식 유지)
  - install_cmd vendor의 commit은 "설치 시점 버전을 검증한 커밋" 역할
  - 실제 git repo를 clone하지 않으므로 revParse 검증 건너뜀
  - `verified_at` 날짜가 실질적인 버전 고정 근거

### schema_version 2 → 3 하위 호환

- schema_version 2 lock의 `tools`는 `omc/gstack/ecc` 고정 → 기존 TOOL_NAMES 검사 유지
- schema_version 3 lock의 `tools`는 키 집합 고정 없음 → 동적 파싱
- `parseLock` 내부에서 schema_version으로 분기

### superpowers 디렉토리 구조

- superpowers repo의 skills는 `skills/{skill-name}/SKILL.md` 구조
- cherry-pick 시 `skillsRootInVendor = 'skills'` 파라미터 사용
- gstack은 `skillsRootInVendor = ''` (루트 직하)

### Phase 조건부 활성 + clone 정책

- **항상 clone**: phases 조건 미충족이어도 vendors/ 에 clone 수행 (phase 전환 후 빠른 활성화)
- **조건부 노출**: .claude/skills/ 심링크는 현재 phase 조건 충족 시에만 생성
- `installVendor` 반환 `active` 필드로 install 파이프라인에 통보

---

## 12. 버전 태그 계획

| 태그 | 내용 |
|---|---|
| v0.9.1 | feat(lock): schema_version 3 타입 + 파싱 |
| v0.9.2 | feat(vendors): cherry-pick + phase filter + install_cmd |
| v0.9.3 | test: lock-v3 / vendor-cherry-pick / vendor-phase-filter |
| v0.9.4 | feat(hooks+template): 프리셋 기반 훅 배포 + template 교체 |
| v0.9.5 | feat(phase+claude-md): phase diff 출력 + vendor 마커 |
| v0.9.6 | test: hooks-phase-preset / phase-diff + 회귀 전체 |
| v0.9.7 | docs: CLAUDE.md / README / acorn-v1-plan 갱신 |
| **v1.0.0** | npm publish 활성화 |
