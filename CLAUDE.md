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