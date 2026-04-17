# acorn v0.3.0 설계 노트

> 2026-04-17 작성. v0.2.0 릴리스 (§15 audit 버킷 완료 + Round 2 도그푸딩 feature 반영)
> 직후 남은 feature 큐를 검증 가능한 설계로 정리한다.
> 구현은 이 문서를 기준선으로 삼는다.

## 스코프

| ID | 항목 | 크기 | 우선순위 근거 |
|---|---|---|---|
| S3 | `acorn config` — lock/settings 조작 helper | 중 | Round 1 실증: "jq 저글링 대신 직접 편집 툴 필요". 일상 편의성 |
| S4 | `acorn install --adopt` — 기존 수동 설치 흡수 | 대 | Round 1 실증: 수동 설치된 상태를 acorn 의 lock 기반으로 편입. **비파괴 설계 pressure 있음** |
| L1-L3 | 백로그 정리 | 소-중 | §15 LOW 항목. 발견 후 12개월 내 |

## 원칙 (v0.1.x 이래 유지)

- fail-close — 파싱/실행 실패 시 차단이 기본
- 비파괴적 — 백업 후 원자 쓰기. rename atomic, timestamped backup
- schema valid — 새 값은 기존 검증기 (parseLock / planMerge) 를 그대로 통과해야 함
- tx.log 흐름 — 다단계 작업은 tx begin/phase/commit 으로 감쌈
- 사용자 확인 등급 — 등급 3 (타이핑 확인) 은 uninstall 전용, config 는 기본 등급 2 (Y/n), `--yes` 로 스킵

---

## S3. `acorn config` 설계

### CLI 형태

```
acorn config <key> [value]
```

- 인자 없음 → 현재 효과값 요약 (JSON 또는 사람 친화 출력)
- `<key>` 만 → 읽기 (get)
- `<key> <value>` → 쓰기 (set) — 확인 등급 2 (기본 Y/n, `--yes` 로 스킵)

### 지원 key 목록 (v0.3.0 범위)

| key | 범위 | 읽기 소스 | 쓰기 대상 | 검증 |
|---|---|---|---|---|
| `guard.mode` | enum: `block\|warn\|log` | `harness.lock.guard.mode` | `harness.lock` | parseLock guard mode 검증 재사용 |
| `guard.patterns` | enum: `strict\|moderate\|minimal` | `harness.lock.guard.patterns` | `harness.lock` | parseLock guard patterns 검증 재사용 |
| `env.reset` | action (값 필수 아님) | n/a | `settings.json` 의 env 3키 삭제 | removal 만 하고 install 재실행 권장 |

**v0.3 범위 밖 (v0.4+)**: `env.<key>` 직접 쓰기 (wrong path 유도 위험), lock 의 `tools.*.commit` 바꾸기 (lock 무결성 위반 — `acorn lock bump` 로 별도 제공 예정).

### 쓰기 안전장치

1. **preflight** — 새 값 검증. 실패 시 디스크 변경 없음
2. **backup** — `<harnessRoot>/backup/{ISO8601}/config/<filename>.bak` 에 이전 상태 복사 (이미 settings.ts 에서 쓰는 패턴과 일치)
3. **atomic write** — 임시 파일 작성 후 rename (POSIX). Windows 는 기존 파일 unlink + rename
4. **tx.log** — phase 이름 `config-<key>`, commit 마커로 완료 기록

### 출력

- set 성공: `✅ guard.mode: block → warn (backup: <path>)` + exit 0
- set noop (값 동일): `= guard.mode: block (변경 없음)` + exit 0
- 검증 실패: `[config/SCHEMA] guard.mode: block|warn|log 중 하나여야 합니다` + exit 78
- confirm 거절: exit 0 (no change, 중립 표시 `취소됨`)

### 테스트 케이스

1. `acorn config guard.mode warn` — lock 변경 + backup 생성 + exit 0
2. `acorn config guard.mode bogus` — SCHEMA 에러 + lock 무변경
3. `acorn config guard.mode block` (동일 값) — noop
4. `acorn config guard.patterns minimal --yes` — prompt 스킵
5. `acorn config env.reset` — settings.json 에서 3키만 삭제, 다른 키 보존
6. `acorn config` (인자 없음) — 효과값 요약 출력
7. `acorn config guard.mode` (값 없음) — 현재 값 1줄 출력

### 구현 스텝

1. `src/commands/config.ts` 신규. `runConfig(opts)` 오케스트레이터 + 각 key 별 `handleGuardMode` 같은 핸들러
2. `src/index.ts` 에 `case 'config'` 추가, 확인 프롬프트는 TTY 판별 후 readline
3. 테스트: `tests/config.test.ts` — mock io, tempdir lock, 7 케이스
4. README: 일상 사용 예시 + 새 섹션 "설정 변경" 추가

### 예상 commit 구성

- `feat(config): acorn config guard.mode / guard.patterns setter (S3-A)`
- `feat(config): acorn config env.reset (S3-B)`
- `docs(config): README 설정 변경 섹션`
- `chore(release): v0.3.0`

---

## S4. `acorn install --adopt` 설계

### 배경

Round 1 도그푸딩: Mac personal 머신에 gstack/OMC 가 이미 수동 설치돼 있던 상태에서 `acorn install` 이 `NOT_A_REPO` (vendors/ecc 가 실 개발 레포 심링크였음) 로 막힘. 사용자가 `rm -rf` 또는 수동 정리를 해야 했는데, acorn 의 "비파괴" 원칙에 맞지 않음.

`--adopt` 는 **기존 수동 설치를 파괴 없이 lock 기준으로 흡수** 하는 플래그.

### 지원 시나리오

| 기존 상태 | adopt 동작 |
|---|---|
| `vendors/<tool>` 가 git 저장소 + HEAD == lock SHA | action=adopted (기록만, 실 변경 없음) |
| `vendors/<tool>` 가 git 저장소 + HEAD != lock SHA | dirty 없으면 checkout, dirty 면 거부 (LOCAL_CHANGES) |
| `vendors/<tool>` 가 **심링크** (개발 레포) | lock 의 SHA 를 심링크 target 의 HEAD 로 **자동 갱신** (옵션) OR 경고 출력 후 그대로 두기 |
| `vendors/<tool>` 가 일반 디렉토리 (git 아님) | 현재 `--force` 없으면 NOT_A_REPO. `--adopt` 는 `<path>.pre-adopt-<ts>/` 로 **이동 후 clone**, 사용자에게 "원본 보존됨" 안내 |
| `vendors/<tool>` 가 파일 | §15 H4 경로 (IO 에러) — adopt 도 거부 |
| `settings.json` 에 env 키가 다른 값으로 존재 | 현재 SETTINGS_CONFLICT 로 중단. `--adopt` 는 **충돌 키를 `env.<key>.pre-adopt-<ts>` 로 이동 + 기대값으로 덮어쓰기** |
| `hooks/guard-check.sh` 가 사용자 수정본 | 이미 C2 가 backup 후 교체 (v0.1.2+). 변경 없음 |

### 핵심 설계 결정

**ADR-018 (가칭): `--adopt` 는 "가장자리에서의 lock 현실화" 전략**
- Lock 은 진실. 현실이 lock 과 다르면 현실을 **이름 바꿔 보존** 하고 lock 기준으로 덮어쓴다
- 삭제는 일절 없음. 항상 `.pre-adopt-<ts>` 접미어로 이동만
- 사용자 후처리: 이동된 디렉토리는 직접 확인·머지·폐기 (acorn 은 안 건드림)

**ADR-019 (가칭): 심링크 vendor 는 "개발 레포" 로 간주, adopt 가 흡수하지 않음**
- `vendors/<tool>` 이 심링크면: acorn 은 그 target 을 건드리지 않음 (사용자의 작업 공간일 가능성)
- `--adopt --follow-symlink` 옵션이 있으면 target HEAD 를 lock 으로 당김 (명시적 허용)
- 기본 동작은 심링크 보존 + `doctor` 가 "드리프트 가능성" warning

### 새 에러 코드

`InstallError` 에 추가:
- `ADOPT_REFUSED` — adopt 가 처리할 수 없는 상황 (예: 파일 경로, 파괴적 이동 불가)

### tx.log phase

- `vendors-adopt` — vendor 흡수 단계
- `settings-adopt` — settings 충돌 이동 단계

### CLI

```
acorn install --adopt                 # 전체 흡수
acorn install --adopt --follow-symlink   # 심링크 vendor 도 target HEAD 기준으로 흡수
acorn install --adopt --yes           # 확인 프롬프트 스킵
```

### 출력

```
[4/8] vendors clone/checkout
      omc: adopted (HEAD matches lock — 기록만)
      gstack: adopted (preserved <path>.pre-adopt-20260417-xxxx, re-cloned)
      ecc: adopted (심링크 보존, lock SHA 변경 없음)
[3/8] settings.json preflight
      conflict on CLAUDE_PLUGIN_ROOT: moved to env.CLAUDE_PLUGIN_ROOT.pre-adopt-<ts>
```

### 테스트 케이스

1. 기존 vendor (git repo + HEAD 일치) — adopt → noop-like
2. 기존 vendor (git repo + SHA drift + dirty 없음) — adopt → checkout
3. 기존 vendor (git repo + dirty) — adopt 거부 (LOCAL_CHANGES)
4. 기존 vendor (non-git 디렉토리) — adopt → 이동 후 clone, `.pre-adopt-*` 잔존 검증
5. 기존 vendor (심링크) — adopt → 보존, lock SHA 미변경
6. 기존 vendor (심링크) + `--follow-symlink` — adopt → target HEAD 기준 lock 갱신
7. settings 충돌 + `--adopt` — 충돌 키를 `.pre-adopt-*` 로 이동, 정상 env 쓰기
8. settings 충돌 + 기본 install (adopt 없음) — 여전히 SETTINGS_CONFLICT (regression guard)
9. 모든 vendor 정상 + `--adopt` — vanilla install 과 같은 결과

### 구현 스텝

1. `src/core/adopt.ts` 신규 — 각 상황 detector + 이름 변경 유틸 (`preAdoptMove`)
2. `src/core/vendors.ts` 에 `installVendor` 가 `adopt: boolean` 옵션 받도록 확장. adopt=true 면 non-git 디렉토리에서 `NOT_A_REPO` 대신 `preAdoptMove` 후 clone
3. `src/core/settings.ts` 의 `planMerge` 결과가 `conflict` 일 때 adopt 경로는 `env.<key>.pre-adopt-<ts>` 로 이동 후 원자 쓰기
4. `src/commands/install.ts` 에 `InstallOptions.adopt` + `followSymlink` 옵션 추가, 각 phase 에 adopt 분기
5. `src/index.ts` 의 `cmdInstall` 에 `--adopt` / `--follow-symlink` 플래그 + 확인 프롬프트
6. 테스트: `tests/adopt.test.ts` 신규 + `tests/install.test.ts` 에 adopt 시나리오 확장
7. 새 ADR 2건 (`§11 ADR-018/019`) 을 `acorn-v1-plan.md` 에 append

### 예상 commit 구성

- `feat(adopt): core adopt 유틸 + preAdoptMove (S4-A)`
- `feat(adopt): vendors installVendor 에 adopt 옵션 (S4-B)`
- `feat(adopt): settings planMerge 에 adopt 경로 (S4-C)`
- `feat(cli): acorn install --adopt --follow-symlink (S4-D)`
- `docs(adr): ADR-018/019 — adopt 전략 (S4-E)`
- `chore(release): v0.3.0`

---

## L1~L3 백로그 처리

### L1. CRLF 처리 + UNC prefix
- `src/core/vendors.ts:124` — `git status --porcelain` 출력이 Windows 에서 CRLF 끝줄. `.trim()` 또는 `\r\n` 명시 split
- `src/core/symlink.ts:62` — Windows 경로가 `\\?\` UNC prefix 로 들어오면 strict equality 불일치. `normalizePathForCompare` (§15 M4 에서 만든) 확장 대상

### L2. `tx.log` 회전
- 현재 무한 append. 한달 이상 빈번히 쓰면 수십 MB 가능
- 방안: `tx.log` 가 10MB 초과 시 `tx.log.{ISO8601}.rotated` 로 이동 후 새 파일 시작. 로테이션 시점은 `beginTx` 초기

### L3. `runDoctor.ok` info carve-out dead code
- v0.1.2 에서 `summary.critical === 0 && summary.warning === 0` 으로 바꿨을 때 info 는 자연스럽게 ok 계산에서 빠짐
- 기존 `severity !== 'info'` carve-out 은 이제 코드에 없음 (M3 의 info 이슈는 ok 에 영향 안 줌)
- 결론: **이미 resolved** — §15 L3 는 v0.2.0 시점에 사실상 해소됨. 별도 작업 불필요

### L1/L2 는 v0.4.x 후보. 실제로 사용자가 느끼는 blocker 아님.

---

## 릴리스 전략

### v0.3.0 (이 문서 범위)

S3 (config) + S4 (--adopt) + ADR-018/019 + 관련 tests + docs. 한 릴리스로 묶음.

**Entry criteria**: 이 설계 문서가 승인 (user review + no blocking questions)
**Exit criteria**: 
- 모든 테스트 케이스 (S3 7건, S4 9건) 통과
- 실환경 dogfood: 적어도 한 번의 `--adopt` 실 시나리오 (e.g., 수동 설치된 vendors 흡수)
- CHANGELOG + HANDOVER §1 + plan §14 갱신

### v0.4.x (후속)

- L1 CRLF/UNC 처리 (작음)
- L2 tx.log 회전 (작음)
- 그 외 Round 3 도그푸딩에서 나오는 것

---

## 미해결 질문 (다음 세션 시작 시 재확인)

1. **`--adopt --follow-symlink` 가 lock SHA 를 자동 갱신하면 git diff 가 발생** — 사용자가 commit 해야 하나? (제안: 갱신 시 stdout 에 "lock 변경됨 — 필요 시 커밋" 경고. 자동 커밋 하지 않음)
2. **`acorn config env.reset` 이후 install 재실행 암묵적 필요** — config 가 install 을 자동 트리거 해야 하나? (제안: 아니오. config 는 side effect 최소, 사용자가 `acorn install` 로 재주입)
3. **등급 2 확인 프롬프트 구현** — readline 쓰면 non-TTY (CI) 에서 블록. `--yes` 없이 non-TTY 면 어떻게? (제안: non-TTY + no `--yes` → exit 75 + "CI 환경에서 --yes 필요" 안내)
