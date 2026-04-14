# acorn

Claude Code 하네스 엔지니어링 툴(OMC, gstack, ECC) 통합 관리 CLI.
패키지명: @dotoricode/acorn

## 핵심 원칙

- fail-close: 파싱/실행 실패 시 차단이 기본
- 비파괴적: 기존 설정 덮어쓰지 않음, 백업 후 복원
- 버전 고정: harness.lock의 SHA 기준으로만 설치
- 단일 책임: 사용자 커맨드와 dotori 전용 커맨드(acorn dev) 분리

## 디렉토리 구조

src/
├── commands/   사용자 커맨드 (install, status, list, config, uninstall)
├── core/       핵심 로직 (lock, registry, symlink, env, guard)
└── dev/        dotori 전용 커맨드 (check, lock, validate, release)
                빌드 타임에 배포판에서 제거됨

## 주요 경로 (Windows 기준)

harness 루트:  D:\dotori\.claude\skills\harness\
harness.lock:  D:\dotori\.claude\skills\harness\harness.lock
registry:      D:\dotori\.claude\skills\harness\registry.json
vendors:       D:\dotori\.claude\skills\harness\vendors\
hooks:         D:\dotori\.claude\skills\harness\hooks\guard-check.sh
gstack 심링크: D:\dotori\.claude\skills\gstack\ -> vendors\gstack\

## 툴별 설치 방식

gstack  디렉토리 심링크 방식 (절대경로 하드코딩 대응)
OMC     환경변수 주입 (CLAUDE_PLUGIN_ROOT, OMC_PLUGIN_ROOT)
ECC     환경변수 주입 (CLAUDE_PLUGIN_ROOT, ECC_ROOT)

## guard 훅

위치: D:\dotori\.claude\skills\harness\hooks\guard-check.sh
방식: stdin JSON 파싱, readFileSync(0) fd 0 방식 (크로스 플랫폼)
원칙: fail-close - 파싱 실패 시 반드시 차단
기본값: block + strict

## 기술 스택

런타임: Node.js LTS + TypeScript
훅:     bash + Node.js (jq 있으면 우선)
배포:   npm (@dotoricode/acorn)

## 커맨드

### 사용자 전용
acorn install
acorn install --repo .
acorn status
acorn list
acorn config guard.mode <block|warn|log>
acorn config guard.patterns <strict|moderate|minimal>
acorn uninstall
acorn uninstall --tool <name>

### dotori 전용 (배포판 미포함)
acorn dev check
acorn dev check --tool <name>
acorn dev diff <skill>
acorn dev lock
acorn dev validate
acorn dev release

## 인터랙티브 확인 등급

등급 1  확인 불필요 (status, list)
등급 2  Y/n 확인 (install --repo, config 변경)
등급 3  타이핑 확인 (uninstall)
--yes 플래그로 스킵 가능

## 빌드

npm run build      사용자 배포판 (src/dev 제외)
npm run build:dev  개발용 전체 빌드

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