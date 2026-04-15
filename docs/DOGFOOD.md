# Dogfooding acorn v0.1.0

> 실사용 관찰 로그. v0.1.1 / v0.2.0 우선순위 결정의 근거가 된다.
> 1~2주 간 실 2머신에서 굴리며 감각을 수집한다.

---

## 관찰 원칙

- **상상하지 말고 쓴다** — 기능 검토가 아니라 실제 작업 흐름에서 acorn 을 꺼내 쓴다
- **정량 데이터는 자동** — 실행 기록·exit code·stderr 는 wrapper 가 알아서 저장. 아래 "자동 로거" 참고
- **정성 관찰은 수동** — "불편하다", "이상하다" 감각은 `dn` 으로 1줄 메모 (사람 판단 필요)
- **수정하지 않는다** — 버그 발견해도 v0.1.0 코드는 **건드리지 않음**. 쌓이면 v0.1.1 로 한 번에 처리
- **유일한 예외**: 실제로 하루 작업을 막는 블로커는 hotfix 브랜치에서 즉시 수정

---

## 자동 로거 (정량 수집) — 1회 셋업

`scripts/dogfood/` 에 wrapper 3종이 있다. 한 번만 alias 등록하면 이후 자동 로깅.

### Mac (zsh)

```bash
# ~/.zshrc 에 추가
export ACORN_REPO=~/01_private/acorn
alias adog="$ACORN_REPO/scripts/dogfood/wrap.sh"
alias dn="$ACORN_REPO/scripts/dogfood/note.sh"
alias dreport="$ACORN_REPO/scripts/dogfood/report.sh"
# (선택) 로그 위치 커스터마이즈
# export ACORN_DOGFOOD_LOG=~/acorn-dogfood.log
```

### Windows (Git Bash, `~/.bashrc`)

```bash
export ACORN_REPO=/d/dotoricode/acorn
alias adog="$ACORN_REPO/scripts/dogfood/wrap.sh"
alias dn="$ACORN_REPO/scripts/dogfood/note.sh"
alias dreport="$ACORN_REPO/scripts/dogfood/report.sh"
```

재로그인 또는 `source ~/.zshrc`.

### 사용법

```bash
# acorn 대신 adog 로 호출 — 실행결과는 동일, 백그라운드에서 로깅됨
adog install
adog status --json | jq .
adog doctor --force

# 이상한 걸 발견하면 1줄 메모 (라벨 선택: bug ux idea question blocker)
dn ux "status 출력에 personal/work 구분이 없어 헷갈림"
dn bug "doctor --json 의 hint 에서 줄바꿈이 리터럴 \\n 으로 찍힘"
dn idea "acorn sync 한 커맨드로 drift 수복되면 매일 씀"

# 누적 요약 — 언제든
dreport
```

출력 예 (`dreport`):
```
=== acorn 도그푸딩 요약 ===
로그: /Users/.../acorn-dogfood.log  (47 줄)
기간: 2026-04-16T09:12:03+09:00 → 2026-04-19T18:04:11+09:00
실행: 18 회,  메모: 7 건

--- 서브커맨드 실행 분포 ---
   9 status
   5 install
   3 doctor
   1 --version

--- exit code 분포 ---
  15 exit=0
   2 exit=1
   1 exit=64

--- 라벨별 메모 ---
  bug: 2
  ux: 3
  idea: 2
```

로그는 **로컬 파일**이며 레포에 커밋되지 않는다 (`~/acorn-dogfood.log` 기본값).

### 자동으로 수집되는 것

- 타임스탬프 (ISO8601)
- 호스트명 (Mac/Windows 구분용)
- 작업 디렉토리
- 전체 커맨드 + 인자
- exit code
- 소요 시간 (초)
- 실패 시 stderr 마지막 5줄

### 여전히 수동으로 필요한 것

- UX 불편함 ("이 화면 오래 봐야 이해됨")
- 기능 제안 ("이런 게 있으면 좋겠다")
- false positive / true positive 판단
- v0.1.1 / v0.2.0 / v0.3.0 분류 (도그푸딩 종료 시)

**자동으로 못 잡는 부분이 오히려 가치 있는 데이터**다. 한 줄씩 남겨라.

---

---

## 사전 준비 (한 번만)

### 양쪽 머신 공통

```bash
# 1. 최신 main
cd ~/01_private/acorn    # Mac, 또는 D:\dotoricode\acorn (Windows)
git pull origin main
git checkout v0.1.0      # 태그 기준으로 고정 (도그푸딩 중 main drift 차단)

# 2. 빌드
nvm use 24
npm install
npm run build

# 3. 전역 링크
npm link
which acorn              # dist/index.js 가리켜야 함
acorn --version          # 0.1.0

# 4. 관찰 로그 파일 생성
cp docs/DOGFOOD.md ~/acorn-dogfood.md     # 템플릿 복사, 개인 로그는 레포 밖에
```

### harness.lock 준비

`acorn install` 이 실행되려면 `harness.lock` 이 필요하다.
아직 dotfiles 레포에 실물 lock 이 없다면 최소 샘플을 만든다:

```bash
mkdir -p ~/.claude-personal/skills/harness   # 또는 $CLAUDE_CONFIG_DIR/skills/harness
cat > ~/.claude-personal/skills/harness/harness.lock <<'EOF'
{
  "schema_version": 1,
  "acorn_version": "0.1.0",
  "tools": {
    "omc": {
      "repo": "affaan-m/oh-my-claudecode",
      "commit": "0000000000000000000000000000000000000001",
      "verified_at": "2026-04-15"
    },
    "gstack": {
      "repo": "aj-geddes/gstack",
      "commit": "0000000000000000000000000000000000000002",
      "verified_at": "2026-04-15"
    },
    "ecc": {
      "repo": "aj-geddes/everything-claude-code",
      "commit": "0000000000000000000000000000000000000003",
      "verified_at": "2026-04-15"
    }
  },
  "guard": { "mode": "block", "patterns": "strict" }
}
EOF
```

**주의**: `commit` SHA 는 실제 값으로 교체. 샘플 SHA 는 clone 실패함.
*`acorn dev lock` 이 v1.1+ 예정이므로 v0.1.0 단계에서는 수동 편집.*

---

## 시나리오 (순서대로)

### S1. Fresh install — "새 머신에 처음 깔 때"
**목적**: 설치 파이프라인이 진짜로 도는가.

```bash
acorn status            # 아직 vendors 없음 → 3개 모두 missing 뜨는지
acorn doctor            # critical 3개 (vendor) + env 3개 (missing) 뜨는지
acorn install           # 7단계 로그가 순서대로 찍히는지
acorn status            # 이번엔 ✅ locked 3개
acorn doctor            # 이슈 없음 메시지
```

**관찰 포인트**:
- 7단계 로그 순서가 `[1/7]` → `[7/7]` 순서인가
- `settings.json` 에 env 3키가 **추가**됐는가 (기존 키 보존?)
- `~/.claude/skills/harness/backup/` 에 백업이 있는가
- `tx.log` 에 `begin` → `phase`... → `commit` 순서로 기록됐는가

---

### S2. 재실행 멱등성 — "두 번째 install"
**목적**: 멱등성 설계가 말로만인지 실제로인지.

```bash
acorn install           # 직전 성공 상태에서 한 번 더
```

**관찰 포인트**:
- vendors 3개 모두 `noop` 인가 (로그 확인)
- gstack 심링크 `noop`
- settings `action=noop`
- `backup/` 에 새 폴더가 생겼는가 (생겼다면 불필요 백업 = v0.2.0 GC 근거)

---

### S3. 심링크 수동 파괴 — "doctor 가 정확히 집는가"
**목적**: Done Definition `심링크 수동 삭제 후 acorn doctor 가 정확 지적` 실환경 확인.

```bash
rm ~/.claude-personal/skills/gstack      # 링크 제거
acorn status
acorn doctor --json | jq '.issues[] | select(.area=="symlink")'
acorn install           # 자동 복구?
```

**관찰 포인트**:
- status / doctor 출력이 실제로 사람이 읽기 쉬운가
- JSON 포맷이 `jq` 파이프로 바로 쓸만한가 (**가장 중요한 관찰 포인트**)
- `acorn install` 이 복구 가능했는가, 아니면 `doctor --fix` 가 필요하다고 느꼈는가

---

### S4. Vendor drift — "harness.lock 은 바꼈는데 vendor 가 구버전"
**목적**: drift 감지가 실제로 유용한가.

```bash
# lock 만 수정 (commit SHA 1글자 바꿔서 다른 SHA 로 만듦)
vim ~/.claude-personal/skills/harness/harness.lock
acorn status            # omc drift 로 뜨는지
acorn doctor            # warning + 힌트
acorn install           # 실 SHA 가 아니라 clone 실패할 것 — 에러 메시지 품질 확인
```

**관찰 포인트**:
- drift 감지됐을 때 **실제로 어떤 행동**을 하고 싶어지는가 (install? 아니면 lock 되돌리기?)
- 에러 메시지가 fix 로 연결되는가, 아니면 docs 를 뒤져야 하는가

---

### S5. Settings 충돌 — "수동으로 env 넣어놨는데 값이 다르면"
**목적**: 비파괴 원칙 확인.

```bash
# settings.json 에 이미 다른 값으로 env 키 넣기
vim ~/.claude-personal/settings.json
# "env": { "CLAUDE_PLUGIN_ROOT": "/other/path", ... }

acorn install           # preflight 에서 CONFLICT 로 막혀야 함
# 파일 변경 없이 중단됐는지 확인 (timestamp)
```

**관찰 포인트**:
- 에러 메시지가 "어느 키가 충돌, 현재값 vs 기대값" 을 명확히 보여주는가
- 사용자가 **다음에 뭘 해야 하는지** 알 수 있는가

---

### S6. Ctrl-C 시뮬레이션 — "설치 중 중단했을 때"
**목적**: tx.log 가 실제로 복구에 도움이 되는가.

```bash
acorn install &          # 백그라운드로
sleep 0.3; kill -INT $!  # 중간에 인터럽트
acorn install            # 재실행 → IN_PROGRESS 에러 떠야 함
cat ~/.claude-personal/skills/harness/tx.log | tail
acorn install --force    # 우회
```

**관찰 포인트**:
- `IN_PROGRESS` 에러 메시지가 `--force` 를 안내하는가
- tx.log 가 사람이 읽을 만한가 (phase 이름이 직관적?)
- 중단된 상태의 vendors 가 일관된가 (partial clone 정리됐나)

---

### S7. Guard 훅 실전 — "진짜로 위험 커맨드 막는가"
**목적**: PreToolUse 훅이 Claude Code 환경에서 발화하는지.

```bash
# Claude Code 에 훅 등록
# ~/.claude-personal/settings.json 에 hooks.PreToolUse 추가:
#   "matcher": "Bash",
#   "command": "/absolute/path/to/acorn/hooks/guard-check.sh"

# Claude Code 세션에서 위험 커맨드 시도
# - rm -rf /tmp/foo → 차단
# - git push --force-with-lease → 통과
# - DROP TABLE foo → 차단
```

**관찰 포인트**:
- 차단 메시지가 bypass 방법을 안내하는가
- Claude Code UI 에서 에러 메시지가 읽히는가
- false positive 는? (일상 커맨드 중 막히면 안 되는 것이 막혔는가)

---

### S8. 2머신 동기화 — "아침 회사 Mac 에서 이어 받기"
**목적**: 실제 워크플로우에 acorn 이 녹는가.

```bash
# Mac 회사
cd ~/01_private/dotfiles
git pull                 # 집에서 lock 갱신된 커밋 받음
cd ~/01_private/acorn
acorn status             # lock SHA 와 실 vendor SHA 차이?
acorn install            # 갱신된 SHA 로 재checkout
acorn status             # 다시 locked
```

**관찰 포인트**:
- **이 루프가 매일 돌만큼 가볍고 믿을만한가**
- 어느 단계에서 "이걸 한 커맨드로" 하고 싶어지는가 → `acorn sync` 필요성 근거
- status 출력이 한눈에 읽히는가

---

### S9. CI 게이트 흉내 — "CI 에서 설치 건강도 체크"
**목적**: JSON 출력이 외부 도구에 실용적인가.

```bash
# 임시 스크립트
if acorn doctor --json | jq -e '.ok' > /dev/null; then
  echo "healthy"
else
  acorn doctor --json | jq -r '.issues[] | "[\(.severity)] \(.area)/\(.subject): \(.message)"'
  exit 1
fi
```

**관찰 포인트**:
- JSON 스키마가 실제로 쓸만한가 (필드 이름, severity 체계)
- exit code 로 게이트 걸기 편한가

---

## 관찰 로그 (자동 + 수동 합쳐 한 파일)

모든 기록은 `$ACORN_DOGFOOD_LOG` (기본 `~/acorn-dogfood.log`) 에 append 된다.
실행 기록은 wrapper 가, 메모는 `dn` 이 같은 파일에 쓴다.

필요하면 같은 디렉토리에 별도 `~/acorn-dogfood.md` 를 만들어
주간 요약·회고를 써도 되지만 **필수 아님**. `dreport` 출력을 그대로 다음 세션에 가져와도 충분.

---

## 분류 기준

| 라벨 | 기준 |
|---|---|
| **v0.1.1-hotfix** | 크래시, 데이터 손실, 실제로 하루 작업을 막는 것 |
| **v0.2.0-candidate** | "없어서 불편하다" 를 주 1회 이상 체감, 설계 영향 있음 |
| **v0.3.0+** / dropped | 써보니 "있으면 좋겠다" 수준, 실빈도 낮음, YAGNI |

---

## 도그푸딩 종료 기준

다음 중 **하나라도** 충족하면 종료:
- 불편 로그 10건 이상 쌓임 (데이터 충분)
- 2주 경과 (달력 기준)
- 명백한 v0.1.1 블로커 1건 발견 (즉시 대응)
- 로그가 3일간 업데이트 없음 (= acorn 을 실제로 안 씀 = 기능이 데일리 루프에 안 녹은 것. **그 자체가 최대 가치의 관찰**)

---

## 종료 후 다음 세션 브리핑 재료

1. `dreport` 출력 (정량 전부 — 실행 횟수, 실패 분포, 메모 전량)
2. v0.1.1 / v0.2.0 분류 요약 (사람 판단)
3. 가장 의외였던 발견 3개 (사람 판단)
4. **실제로 얼마나 썼나 솔직히** — `dreport` 의 "실행 N 회" 가 숫자로 말해줌. 안 쓴 날은 왜?

이 네 가지 들고 와서 v0.1.1 착수 세션 시작.
