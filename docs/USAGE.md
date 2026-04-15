# acorn 사용법 (v0.1.0)

일상적으로 acorn 을 어떻게 꺼내 쓰는지 정리한 치트시트.

> **큰 그림**
> v0.1.0 은 "설치·검증 도구". 실제 Claude Code 세션에서 OMC / gstack / ECC 스킬을
> **사용하는 것** 은 Claude Code 자체이지 acorn 이 아니다.
> acorn 은 **인프라가 흔들릴 때** 꺼내 쓰는 계측·복구 장비다.
> 하루 5분도 안 쓰는 게 정상이다.

---

## 전제 — 셋업이 끝난 상태

아래 커맨드는 다음이 이미 완료돼 있다고 가정한다:

- `npm link` 로 `acorn` 이 전역에서 호출 가능
- `~/.zshrc` (또는 `~/.bashrc`) 에 세 개의 alias 가 등록됨

```bash
export ACORN_REPO=~/01_private/acorn
alias adog="$ACORN_REPO/scripts/dogfood/wrap.sh"
alias dn="$ACORN_REPO/scripts/dogfood/note.sh"
alias dreport="$ACORN_REPO/scripts/dogfood/report.sh"
```

`adog` 는 `acorn` 대체 + 자동 로깅. 도그푸딩 중에는 `adog` 를 쓰고,
정기 사용 단계(도그푸딩 종료 후)에는 그냥 `acorn` 으로 바꿔도 된다.

---

## 🟢 거의 매일 쓰는 것 (30초)

### 1. 상태 확인 — 뭔가 이상한 감이 있을 때

```bash
adog status
```

3줄 전부 ✅ 뜨면 끝.

```
acorn v0.1.0  •  ~/.claude-personal/skills/harness
────────────────────────────────────────────────────────────
  omc     04655ee  ✅  locked
  gstack  c6e6a21  ✅  locked  (symlinked)
  ecc     125d5e6  ✅  locked
────────────────────────────────────────────────────────────
  guard    block / strict
  env:
    CLAUDE_PLUGIN_ROOT   ✅  match
    OMC_PLUGIN_ROOT      ✅  match
    ECC_ROOT             ✅  match
  gstack link   ✅  correct
```

### 2. 메모 — 1줄, 생각나는 즉시

```bash
dn ux "status 가 해석에 시간 걸림"
dn idea "lock 바뀐 거 세션 시작할 때 알려줬으면"
dn bug "install 로그 줄바꿈 이상"
```

라벨 (선택): `bug` / `ux` / `idea` / `question` / `blocker`

---

## 🟡 상황별로 가끔 (주 1~2회 예상)

### 머신 바꾸러 왔을 때 (집 → 회사, 회사 → 집)

```bash
cd ~/01_private/dotfiles && git pull origin main    # lock 받기
adog status                                          # drift 있나 확인
adog install                                         # drift 있으면 재설치
```

`status` 가 다 ✅ 면 `install` 건너뛰어도 된다. 대부분 노op.

### "뭔가 이상한데" 싶을 때

```bash
adog doctor
```

출력 예:

```
⚠️  [vendor] gstack
   vendor 에 로컬 변경이 있음
   → git -C <path> status 로 확인 후 커밋·스태시·버림 중 선택
```

힌트 그대로 따라가면 된다.

### dotfiles 의 harness.lock 이 바뀐 뒤

```bash
adog install
```

출력 `[4/7]` 줄에서 각 툴 상태 확인:

- `cloned` — 처음 설치
- `checked_out` — SHA 변경으로 재체크아웃
- `noop` — 이미 lock 과 일치

### install 이 중간에 중단됐을 때 (Ctrl-C 등)

```bash
adog install             # → [install/IN_PROGRESS] 에러
adog install --force     # 우회
```

`--force` 는 이전 트랜잭션이 `commit` / `abort` 로 마감 안 된 경우만 필요.

---

## 🔴 가끔만 (월 1~2회)

### JSON 자동화 — CI / 스크립트 / Claude Code hook

```bash
adog status --json | jq .ok                         # true/false 로 게이트
adog doctor --json | jq '.issues[].hint'            # 이슈 힌트만
adog status --json > /tmp/acorn-report.json         # 저장
```

`status` / `doctor` 둘 다 exit code 로 CI 분기 가능 — `.md` 하단 Exit code 표 참조.

### 도그푸딩 누적 요약

```bash
dreport
```

주 1회 정도. 본인이 언제 뭘 썼고 뭘 적었는지 구조화된 요약이 나온다.

### 처음부터 재설치 (극단 상황)

```bash
rm -rf ~/.claude-personal/skills/harness/vendors
adog install
```

`settings.json` 의 env 3키는 그대로 두면 재사용 — 충돌 안 난다.

---

## 📋 전체 커맨드 치트시트

| 커맨드 | 의미 | 빈도 |
|---|---|---|
| `adog status` | 3툴 + env + symlink 요약 | 하루 0~2회 |
| `adog doctor` | 이슈 + 복구 힌트 | 주 0~2회 |
| `adog install` | lock 기준 설치·갱신 | 머신 바꿀 때 |
| `adog install --force` | tx 중단 무시 | 비상시 |
| `adog install --skip-gstack-setup` | gstack setup 생략 | 특수 |
| `adog --version` | `0.1.0` | 확인용 |
| `adog --help` | usage | 까먹었을 때 |
| `dn <메모>` | 1줄 관찰 기록 | 생각날 때마다 |
| `dn ux/bug/idea/blocker <메모>` | 라벨 + 메모 | 〃 |
| `dreport` | 누적 요약 | 주 1회 |

---

## 🎯 Claude Code 세션 안에서는

여기서는 **`acorn` 을 거의 안 친다**. 대신:

- **gstack 스킬**: `/office-hours` / `/plan-ceo-review` / `/review` / `/ship` / `/qa` ...
- **OMC 스킬**: `ultrawork` / `ralph` / `autopilot` ...
- **ECC 에이전트**: `code-reviewer` / `architect` / `tdd-guide` / `security-reviewer` ...

이 스킬들이 `~/.claude-personal/skills/*` 심링크로 **이미 연결돼 있어서**
Claude Code 가 자동 인식한다. acorn 은 그 연결을 만들고 감시하는 역할이다.

---

## 💡 자연스러운 사용 루틴

### 아침 회사

```bash
cd ~/01_private/acorn && git pull
adog status       # 전부 ✅ 확인
# Claude Code 세션 시작 → 평소 작업
```

### 작업 중 뭔가 이상함

```bash
adog doctor
# 힌트 따라 처리
dn bug "doctor 가 지적한 N 이슈 — 실제론 정상이었음"
```

### 저녁 집에 가기 전

특별히 할 일 없음. `dotfiles` 에 lock 변경 있으면 commit + push.
acorn 자체는 건드릴 일 거의 없음.

### 주말 / 주간 회고

```bash
dreport   # 이번 주 얼마나 썼나, 뭐 적었나
# DOGFOOD.md Round N 기록 준비용
```

---

## 🚫 안 해도 되는 것

- `adog install` 을 매일 돌리기 — **불필요**. lock 안 바뀌면 전부 noop.
- `status` / `doctor` 를 반복 확인 — **불필요**. 평소 한 번 보면 충분.
- 수동으로 `vendors/` 건드리기 — **비권장**. dirty warning 이 쌓인다.

---

## 📊 Exit code 규약 (스크립트 연동용)

| code | 의미 |
|---|---|
| `0` | 성공 |
| `1` | 일반 실패 (drift, critical issue 등) |
| `64` | 사용법 오류 (알 수 없는 커맨드) |
| `75` | 재시도 가능 (tx.log in_progress — `--force` 로 재실행) |
| `78` | 설정 오류 (settings 충돌, lock 스키마) |

에러 메시지는 `[area/code] 메시지` 프리픽스로 stderr 에 출력.
예: `[vendor/CLONE/omc]`, `[install/IN_PROGRESS]`, `[lock/NOT_FOUND]`.

---

## 🆘 막혔을 때

| 상황 | 조치 |
|---|---|
| `[lock/PARSE] JSON 파싱 실패` | `harness.lock` 확인 — BOM 또는 JSON 문법 오류 |
| `[lock/SCHEMA] schema_version 불일치` | lock 에 `"schema_version": 1` 추가 |
| `[install/SETTINGS_CONFLICT]` | `settings.json` 의 해당 env 키를 기대값으로 교체 또는 삭제 후 재실행 |
| `[install/IN_PROGRESS]` | `adog install --force` 또는 `harness/tx.log` 확인 |
| `[vendor/NOT_A_REPO]` | `vendors/<tool>/` 에 git 아닌 내용 있음. 확인 후 이동 또는 삭제 |
| `[vendor/CLONE]` | 네트워크 / 레포 접근권한 확인 |
| gstack dirty warning 계속 | `cd vendors/gstack && git status` 로 원인 파악 후 커밋·스태시·reset 중 선택 |

---

## 🌰 핵심 원칙

**acorn 이 조용할수록 정상이다.**

시끄러워질 때만 꺼내 보면 된다.
평소엔 `adog status` 한 번 스쳐 보고, 전부 ✅ 면 닫으면 된다.

모르는 게 있으면 `adog --help` 가 언제나 첫 진입점.

---

## 관련 문서

- [README.md](../README.md) — 설치 · 요구사항 · 아키텍처 상세
- [docs/DOGFOOD.md](DOGFOOD.md) — 도그푸딩 가이드 + 관찰 기록
- [docs/HANDOVER.md](HANDOVER.md) — 2머신 인계 체크리스트
- [docs/acorn-v1-plan.md](acorn-v1-plan.md) — 설계 · ADR · Done Definition
- [CHANGELOG.md](../CHANGELOG.md) — 버전 이력
