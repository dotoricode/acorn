# acorn

Claude Code 하네스 CLI — capability-first 모델로 원하는 기능(capability)을 선언하고, 검증된 제공자(provider)를 격리 설치한다.
패키지명: @dotoricode/acorn

## 핵심 원칙

- fail-close: 파싱/실행 실패 시 차단이 기본
- 비파괴적: 기존 설정 덮어쓰지 않음, 백업 후 복원
- 버전 고정: harness.lock의 SHA 기준으로만 설치
- 단일 책임: 사용자 커맨드와 dotori 전용 커맨드(acorn dev) 분리

## 디렉토리 구조

src/
├── commands/   사용자 커맨드 현재 구현: install, status, doctor, config (v0.3.0+),
│               phase (v0.7.0+), list (v0.6.0+)
│               (uninstall 은 v0.9+ 예정)
│               (lock validate 는 src/index.ts 의 cmdLock 라우터에 인라인 —
│                v0.2.0+)
├── core/       핵심 로직 현재 구현: lock, env, settings, symlink, vendors,
│               tx, hooks, gstack-marker, sha-display, adopt (v0.3.0+),
│               phase (v0.7.0+), claude-md (v0.7.0+),
│               providers, preset, provider-detect, provider-install (v0.9+),
│               qa-headless (v0.9+),
│               provider-loader (v0.9.5+) — 사용자 정의 provider 병합 + 정책,
│               errors (v0.9.4+) — AcornError 베이스
│               (registry 는 v1.1+ 연기, 별도 core/guard 모듈 없음 —
│                guard 정책은 harness.lock + hooks/guard-check.sh 에 존재)
└── dev/        dotori 전용 커맨드 (check, lock, validate, release) —
                빌드 타임에 배포판에서 제거됨 (src/dev 는 아직 구현 전)

## 경로 단일화 (Sprint 6.5 이후)

defaultClaudeRoot / defaultHarnessRoot 는 src/core/env.ts 단일 소스.
- CLAUDE_CONFIG_DIR → defaultClaudeRoot() fallback
- ACORN_HARNESS_ROOT → defaultHarnessRoot() override
다른 모듈은 env.ts 에서 import. 중복 정의 금지.

## 트랜잭션 로그 (tx.log)

runInstall 은 모든 단계를 src/core/tx.ts 의 beginTx/phase/commit 으로 감싼다.
이전 실행이 commit/abort 없이 중단된 경우 다음 runInstall 은 IN_PROGRESS 에러.
강제 진행은 `force: true` 옵션 — CLI 에서 `acorn install --force` 로 노출 (v0.1.0+).
위치: <harnessRoot>/tx.log (JSONL)
§15 H3 (v0.1.3): tx.log 에 partial-write 로 인한 corrupt 라인이 있으면
lastInProgress 가 fail-close 로 IN_PROGRESS 를 반환 — 사용자 수동 검사 유도.

## runInstall 오케스트레이터 (9단계)

src/commands/install.ts 의 runInstall() 은 9단계 preflight-우선 파이프라인:

  pre-0a: harness.lock 부트스트랩 (§15 C1, v0.1.2+) — 없으면 템플릿 시드 후
          LOCK_SEEDED 에러. 사용자가 SHA 채운 뒤 재실행.
  pre-0b: phase.txt 초기화 — 없으면 'dev' 시드. fail-soft (실패해도 install 계속).
  [1] lock 파싱 → [2] env 계산 → [3] settings 충돌 읽기전용 체크
  → [4] vendors clone/checkout → [5] gstack 심링크
  → [6] gstack setup (주입 콜백, SHA marker 로 멱등 §15 C3)
  → [7] hooks 배포 (§15 C2 / ADR-017)
  → [8] CLAUDE.md phase 마커 주입 (ADR-023, --skip-claude-md 로 우회)
  → [9] settings 원자 쓰기

핵심 불변식:
- [3] preflight 실패 시 디스크 변경 없음
- [8] 은 반드시 마지막 (백업 후 원자 쓰기) — settings.json 이 참조하는
  모든 artifact (vendors / symlink / hooks) 가 이 시점에 디스크에 존재해야 함
- 두 번째 호출은 모든 단계 noop (멱등) — gstack setup 도 SHA marker 덕분에 포함

git 의존성은 GitRunner 인터페이스(core/vendors.ts)로 주입 가능.
테스트는 stub git 으로 네트워크 없이 실행.

## 주요 경로 (Windows 기준)

harness 루트:   D:\.claude\skills\harness\
harness.lock:   D:\.claude\skills\harness\harness.lock
tx.log:         D:\.claude\skills\harness\tx.log
phase.txt:      D:\.claude\skills\harness\phase.txt (v0.7.0+ / ADR-022)
vendors:        D:\.claude\skills\harness\vendors\
hooks:          D:\.claude\skills\harness\hooks\guard-check.sh (install 이 자동 배포, v0.1.2+)
gstack 심링크:  D:\.claude\skills\gstack\ -> vendors\gstack\
gstack marker:  D:\.claude\skills\harness\.gstack-setup.sha (v0.1.3+ / §15 C3)
backup:         D:\.claude\skills\harness\backup\{ISO8601}\ (settings / hooks / symlinks / claude-md)
CLAUDE.md:      D:\.claude\CLAUDE.md (ACORN:PHASE 마커 주입, ADR-023)
providers/:     D:\.claude\skills\harness\providers\<name>.json (v0.9.5+, 사용자 정의 provider)
config.json:    D:\.claude\skills\harness\config.json (v0.9.5+, provider.allow_custom 등)
(registry.json 은 §15 M1 로 v1.1+ 연기 — 현재 코드가 read/write 하지 않음)

## 환경변수 (guard 우선순위)

ACORN_GUARD_BYPASS=1          모든 guard 차단 건너뜀 (세션 단위)
ACORN_PHASE_OVERRIDE=<phase>  phase.txt 무시하고 강제 phase (v0.7.0+)
ACORN_GUARD_PATTERNS=<level>  phase 유래 patterns 덮어쓰기 (v0.7.0+)
ACORN_GUARD_MODE=<mode>       lock 유래 mode 덮어쓰기
ACORN_HARNESS_ROOT=<path>     harnessRoot override
ACORN_EXTRA_PROVIDERS=<paths> 사용자 정의 provider *.json 경로 (콜론/세미콜론 분리, v0.9.5+)
ACORN_ALLOW_ANY_REPO=1        lock repo allowlist bypass (fork/dev용)

우선순위: ACORN_GUARD_BYPASS > ACORN_PHASE_OVERRIDE > ACORN_GUARD_PATTERNS
          > phase.txt > harness.lock.guard.patterns > strict

## 툴별 설치 방식 (v3 provider 모델)

gstack      git-clone + 디렉토리 심링크 (절대경로 하드코딩 대응)
superpowers git-clone (planning/spec 제공자)
gsd         npx install_cmd (planning/qa_headless 제공자)
claudekit   npx install_cmd (hooks 제공자)

v2 legacy (schema_version 2 lock 에 여전히 동작):
OMC     환경변수 주입 (CLAUDE_PLUGIN_ROOT, OMC_PLUGIN_ROOT)
ECC     환경변수 주입 (CLAUDE_PLUGIN_ROOT, ECC_ROOT)

## guard 훅

위치: D:\.claude\skills\harness\hooks\guard-check.sh
방식: stdin JSON 파싱, readFileSync(0) fd 0 방식 (크로스 플랫폼)
원칙: fail-close - 파싱 실패 시 반드시 차단
기본값: block + strict

## 기술 스택

런타임: Node.js LTS + TypeScript
훅:     bash + Node.js (jq 있으면 우선)
배포:   npm (@dotoricode/acorn)

## 커맨드

### 사용자 전용 (현재 구현 기준)
acorn install
acorn install --force                              v0.1.0+: tx.log IN_PROGRESS 우회
acorn install --skip-gstack-setup                  v0.1.0+
acorn install --run-gstack-setup                   v0.1.1+
acorn install --adopt [--yes]                      v0.3.0+ / v0.3.1+ Y/n gate (B3)
acorn install --follow-symlink                     v0.3.0+ / v0.3.1+ fail-close (B1)
acorn install --skip-claude-md                     v0.7.0+: CLAUDE.md 마커 주입 건너뜀
acorn status [--json]
acorn doctor [--json]
acorn lock validate [path]                         v0.2.0+
acorn list                                         v0.6.0+
acorn config                                       v0.3.0+: guard 요약
acorn config guard.mode <block|warn|log> [--yes]   v0.3.0+
acorn config guard.patterns <strict|moderate|minimal> [--yes]  v0.3.0+
acorn config env.reset [--yes]                     v0.3.0+
acorn config provider.allow-custom <true|false> [--yes]  v0.9.5+: 사용자 정의 provider 의 install_cmd 실행 허용 (기본 false)
acorn provider list                                v0.9.5+: builtin + 사용자 정의 통합 목록
acorn provider add <path> [--force]                v0.9.5+: *.json 검증 후 providers/ 로 복사
acorn phase                                        v0.7.0+: 현재 phase 조회
acorn phase <prototype|dev|production> [--yes]     v0.7.0+: phase 전환 + CLAUDE.md 동기화
acorn uninstall [--yes]                            v0.9.0+: 전체 언인스톨 (7단계)

### 미구현 (v1.0+ 예정)
acorn uninstall --tool <name>
acorn lock bump                                    ADR-019 에서 암시 (v0.4+)

### dotori 전용 (배포판 미포함, 아직 구현 안 됨 — src/dev/ 빈 상태)
acorn dev check
acorn dev check --tool <name>
acorn dev diff <skill>
acorn dev lock
acorn dev validate
acorn dev release

## 인터랙티브 확인 등급

등급 1  확인 불필요 (status, doctor, list, lock validate, config get/summary, phase get)
등급 2  Y/n 확인 (install --adopt, config set / env.reset, phase set)
등급 3  타이핑 확인 (uninstall — v0.9+ 예정)
--yes 플래그로 스킵 가능. non-TTY 에서 destructive 플래그(등급 2+)는
--yes 명시 없으면 USAGE 에러 (v0.3.1+ B3 / v0.3.0+ CONFIRM_REQUIRED).

## 빌드 및 배포

npm run build      사용자 배포판 (src/dev 제외)
npm run build:dev  개발용 전체 빌드

## npm pack 화이트리스트 (v0.3.1+ CRIT-1)

package.json `files` 필드가 배포 파일을 화이트리스트로 제한한다.
src/**/*.ts, tests/**/*.ts, docs/{HANDOVER,DOGFOOD,acorn-v*-plan}.md,
scripts/dogfood/*.sh, tsconfig*.json 은 **배포판에 포함되지 않는다**.

배포되는 파일: dist/**, hooks/guard-check.sh,
templates/harness.lock.template.json, scripts/install-shim-windows.sh,
docs/USAGE.md, README.md, LICENSE.

새 top-level 디렉토리나 사용자 노출 파일을 추가할 때는 `files` 에
명시해야 한다. `npm pack --dry-run` 으로 확인 가능.

## 테스트

npm test

테스트는 tests/*.test.ts 에 작성한다.
Node 24 의 --experimental-strip-types 모드로 직접 실행하므로
TS 클래스의 parameter properties (constructor(readonly x: T)) 문법은 사용 불가.
constructor 본문에서 명시적으로 필드 할당하는 방식을 따른다.

## 모듈 import 규칙

src/ 내 모듈 간 import 는 .ts 확장자를 명시한다.
  import { x } from './env.ts';
tsconfig 에 allowImportingTsExtensions + rewriteRelativeImportExtensions 설정으로
빌드 시 .js 로 자동 재작성된다.
이 방식이 Node strip-types(직접 실행) 와 tsc 빌드를 동시에 만족시킨다.

## 기획안

docs/acorn-v1-plan.md 참조. 구현 시 이 문서를 기준으로 한다.

## 머신 간 인계 (Mac ↔ Windows)

집(Windows)/회사(Mac) 머신을 오갈 때마다 docs/HANDOVER.md 를 먼저 읽고
작업을 떠날 때는 §1 표(마지막 커밋, 진행 중 작업, 다음 작업)를 반드시 갱신한다.

머신 변경 절차:
  1. 떠나는 쪽: 커밋 + 빌드/테스트 검증 + push + HANDOVER.md §1 갱신
  2. 받는 쪽: git pull --ff-only + nvm use 24 + npm install + npm test (55개 통과 확인)

## 작업 완료 시 문서 업데이트 지침

각 Sprint 또는 기능 작업이 끝날 때마다 아래 3가지를 반드시 갱신한다.

1. **README.md** — 사용자 관점의 변경사항
   - 새로 추가된 기능 요약
   - 사용 방법 / 실행 예시 / 환경변수
   - 주의사항·트러블슈팅 포인트

2. **docs/acorn-v1-plan.md** — 설계 기준 문서
   - 해당 Sprint의 Done Definition 체크박스 업데이트
   - 구현 과정에서 결정된 세부사항을 ADR/명세에 반영
   - 설계와 실제 구현이 어긋나면 문서를 우선 수정 후 재합의

3. **CLAUDE.md** — 미래 세션이 참고할 프로젝트 컨텍스트
   - 새 경로·커맨드·환경변수가 생기면 관련 섹션 갱신
   - 작업 규칙/원칙이 발견되면 명시적으로 추가

문서 업데이트는 기능 커밋과 **같은 커밋** 또는 **직후 별도 docs 커밋**으로 포함한다.
문서 없이 코드만 커밋하지 않는다.