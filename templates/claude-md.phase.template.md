# acorn phase 블록 템플릿

acorn 이 CLAUDE.md 에 주입하는 마커 블록의 레퍼런스 템플릿.
실제 생성은 `src/core/claude-md.ts` 의 `renderPhaseBlock()` 이 담당한다.

---

## prototype

```
<!-- ACORN:PHASE:START -->
## Acorn Phase: prototype

이 프로젝트는 현재 **prototype** 단계입니다 (acorn 이 관리).

- guard 수준: minimal — 되돌릴 수 없는 catastrophic 조작만 차단
- 빠른 탐색 우선, fail-fast 보다 진행 우선
- phase 변경: `acorn phase <prototype|dev|production>`

ACORN_PHASE_KEYWORD: prototype
<!-- ACORN:PHASE:END -->
```

## dev

```
<!-- ACORN:PHASE:START -->
## Acorn Phase: dev

이 프로젝트는 현재 **dev** 단계입니다 (acorn 이 관리).

- guard 수준: moderate
- 체크인 전 `acorn doctor` 로 drift 확인
- phase 변경: `acorn phase <prototype|dev|production>`

ACORN_PHASE_KEYWORD: dev
<!-- ACORN:PHASE:END -->
```

## production

```
<!-- ACORN:PHASE:START -->
## Acorn Phase: production

이 프로젝트는 현재 **production** 단계입니다 (acorn 이 관리).

- guard 수준: strict — 모든 파괴적 패턴 차단
- 변경 전 `acorn status` 로 상태 확인 필수
- phase 변경: `acorn phase <prototype|dev|production>`

ACORN_PHASE_KEYWORD: production
<!-- ACORN:PHASE:END -->
```
