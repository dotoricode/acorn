# 작업 인계 (Mac ↔ Windows)

> Mac(회사) 또는 Windows(집)에서 작업을 이어갈 때 참고하는 체크리스트.
> 마지막 갱신: 2026-04-17 (Windows / **v0.1.2 + v0.1.3 + v0.2.0 동일 세션 삼중 릴리스**)

---

## 1. 현재 상태 한눈에

| 항목 | 값 |
|---|---|
| 브랜치 | `main` (origin 과 동기), 태그 `v0.2.0` 최신 (+ `v0.1.3`, `v0.1.2`, `v0.1.1`, `v0.1.0`) |
| 진행 중 작업 | **v0.2.0 릴리스 완료** — §15 v0.2.0 버킷 (H1, M1~M5) + 도그푸딩 Round 2 실증 feature (S2, S5, S6) 8개 모두 완료. 삼중 릴리스 세션 (v0.1.2 → v0.1.3 → v0.2.0). |
| 다음 작업 | (a) **v0.3.0 (선택) 큐**: S3 `acorn config` (jq 저글링 대체) · S4 `acorn install --adopt` (기존 수동 설치 흡수 — **설계 문서 먼저**) · S7 `[6/7]` 라인 축약은 C3 의 `[6/8] noop` 메시지로 사실상 해소됨 · S8 jq 안내는 README/HANDOVER 에 이미 존재 → (b) 백로그 L1~L3 (CRLF, tx.log 회전, info-severity dead code) |
| 테스트 | Windows: 157/177 (20 실패 — 전부 기존 Windows EPERM symlinkSync / 경로구분자 + C4 의 symlink 종속 1 케이스). Mac 기준 177/177 예상 |
| 릴리스 커밋 체인 | v0.1.0 → v0.1.1 (`b3c7668`) → v0.1.2 (`1a8e2a6`) → v0.1.3 (`d1590e0`) → **v0.2.0 (`640f214`)** |
| v0.1.2 본문 (이 세션) | `f502328` C6 / `b2b700f` C1 / `37b85b4` C2 / `f75ee46` C5 + 선행 `e38b29d` S1 · `8e517b0` audit 조정 |
| v0.1.3 본문 (이 세션) | `cdeacff` C4 / `cf0518d` H3 / `4f59193` H4 / `1c797d2` C3 |
| v0.2.0 본문 (이 세션) | `f660b4e` S2 drift/CHECKOUT · `a5738b6` M5 CLAUDE.md · `77a209e` H1 guard patterns · `b574f05` M4 Windows case · `08022fc` M3 envRuntime · `0165b46` S6 Windows shim · `6b269ba` S5 lock validate |
| 처리 계획 (정본) | **`acorn-v1-plan.md §15`** — ✅ v0.1.2 (C1/C2/C5/C6) / ✅ v0.1.3 (C3/C4/H3/H4) / ✅ v0.2.0 (H1/M1~M5) / ⏳ 백로그 (L1~L3). §15 밖 feature: ✅ S1/S2/S5/S6 ship, ⏳ S3/S4 는 v0.3 후보 |
| 실사용 환경 | Mac personal, CLAUDE_CONFIG_DIR=~/.claude-personal, ECC 는 로컬 개발 레포 `~/01_private/everything-claude-code` 별도 관리. Windows: `D:\.claude\skills\harness\`, acorn 은 `C:\Users\SMILE\AppData\Roaming\npm\acorn.{cmd,}` 수동 shim (Node 24 가 Junction traverse 못 함) |
| 별도 처리 | S7 Guard 훅 실전 (Claude Code UI) — bash tool 밖, DOGFOOD.md § S7 recipe 참조. **C2 완료로 `hooks/guard-check.sh` 는 이제 install 이 자동 배포하므로 recipe 의 수동 복사 전제 불필요** |

---

## 2. 새 머신에서 부트스트랩

### Windows (집)

```bash
# 1. 저장소 위치 (CLAUDE.md 기준)
cd D:\dotoricode\acorn

# 2. 최신 main 받기
git fetch origin
git checkout main
git pull --ff-only origin main

# 3. Node 24 확인 (nvm-windows 사용 시)
nvm use 24
node --version    # v24.x.x 여야 함

# 4. 의존성 설치 + 빌드 + 테스트
npm install
npm run build
npm test          # 110/110 통과해야 정상
```

### Mac (회사)

```bash
cd ~/01_private/acorn
git fetch origin && git checkout main && git pull --ff-only origin main
nvm use 24
npm install && npm run build && npm test
```

---

## 3. 환경 차이 — 주의 사항

| 항목 | Mac | Windows |
|---|---|---|
| harness 루트 | `~/.claude-personal/skills/harness/` (direnv) | `D:\.claude\skills\harness\` |
| 셸 | zsh | Git Bash 또는 PowerShell |
| 심링크 type | `dir` (자동) | `junction` (자동, `symlink.ts`가 처리) |
| guard 훅 stdin | `fd 0` 정상 | `fd 0` 정상 (검증 완료, `/dev/stdin` 은 fail-open 발생) |
| jq | brew 사용 가능 | scoop / chocolatey 또는 node 폴백 |

**`ACORN_HARNESS_ROOT` env**로 머신별 차이를 흡수한다.
필요시 `direnv` (Mac) 또는 `setx` (Windows)로 영구 설정.

---

## 4. 작업 재개 절차

### A. 코드 작업 (Sprint 7 착수 시)

`docs/acorn-v1-plan.md`의 §8 `acorn status 출력` 참조.

status 는 실제 FS 를 건드리지 않고 읽기 전용 요약만 출력:
- `harness.lock` 파싱 (`core/lock.ts` 재사용)
- `settings.json` env 3키 diff (`core/env.ts` + `settings.ts` 재사용)
- gstack 심링크 상태 (`core/symlink.ts` — inspectSymlink 재사용)
- guard mode 표시 (lock.guard.mode)

Sprint 6 의 `runInstall` 이 만든 상태를 그대로 읽어 요약하는 것이므로
새 코어 로직은 불필요. `src/commands/status.ts` 만 추가하면 된다.

### B. 문서만 손볼 때

`CLAUDE.md`의 "작업 완료 시 문서 업데이트 지침" 섹션 그대로 따른다:
- README.md (사용자 관점)
- docs/acorn-v1-plan.md (Done Definition 체크박스)
- CLAUDE.md (경로/규칙 변경 시)

---

## 5. 작업 종료 시 (현 머신에서 떠나기 전)

```bash
# 1. 모든 변경 커밋
git status                    # untracked 없는지 확인
git add -A && git commit ...

# 2. 로컬 검증
npm run build && npm test

# 3. 푸시
git push origin main

# 4. 인계 정보 갱신
#    이 파일(docs/HANDOVER.md)의 §1 표 업데이트
#    - 마지막 커밋 SHA
#    - 진행 중 작업 (있으면 어디까지 했는지)
#    - 다음 작업
```

**진행 중 작업이 있으면 반드시 §1에 명시.**
"Sprint 6 install.ts 작성 중, preflight까지 구현, vendors clone 미착수" 식.

---

## 6. 막혔을 때 — 빠른 복구

| 상황 | 조치 |
|---|---|
| `npm test` 실패 | 변경한 파일 위주 확인, `git stash` 후 main에서 재현되는지 비교 |
| `npm run build` TS 에러 | `tsconfig.json`의 `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` 확인 |
| import `.ts` 에러 | `CLAUDE.md` "모듈 import 규칙" 섹션 참고 |
| Node 버전 불일치 | `.nvmrc` 의 `24` 따라 `nvm use 24` |
| 심링크 권한 (Windows) | 관리자 PowerShell 또는 개발자 모드 활성화 필요 |

---

## 7. 참조 문서

- `CLAUDE.md` — 프로젝트 컨텍스트, 코딩 규칙, 문서 업데이트 지침
- `README.md` — 사용자 관점 기능 / 사용법 / 트러블슈팅
- `docs/acorn-v1-plan.md` — 설계 명세, ADR, Done Definition
- `docs/HANDOVER.md` — **본 문서** (머신 간 인계)
