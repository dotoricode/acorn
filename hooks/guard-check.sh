#!/bin/bash
# acorn guard-check hook
# Claude Code PreToolUse 훅으로 Bash 툴 실행을 인터셉트한다.
# fail-close: 파싱/실행 실패 시 차단이 기본.

set -u

HARNESS_ROOT="${ACORN_HARNESS_ROOT:-$HOME/.claude/skills/harness}"
LOCK_FILE="$HARNESS_ROOT/harness.lock"

# 1. Bypass check (최우선)
if [ "${ACORN_GUARD_BYPASS:-0}" = "1" ]; then
  echo "[acorn-guard] ⚠️ BYPASS ACTIVE — 위험 커맨드가 차단되지 않습니다" >&2
  exit 0
fi

# 2. Mode / Patterns 결정 (env > harness.lock > default)
parse_lock_field() {
  local field="$1"
  local default_val="$2"
  [ ! -f "$LOCK_FILE" ] && { printf '%s' "$default_val"; return 0; }
  if command -v jq >/dev/null 2>&1; then
    jq -r ".guard.${field} // \"${default_val}\"" "$LOCK_FILE" 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    node -e "
      try {
        const d = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
        process.stdout.write((d.guard && d.guard[process.argv[2]]) || process.argv[3]);
      } catch (e) { process.stdout.write(process.argv[3]); }
    " "$LOCK_FILE" "$field" "$default_val" 2>/dev/null
  else
    printf '%s' "$default_val"
  fi
}

# Phase 로드 (ADR-022): ACORN_PHASE_OVERRIDE > phase.txt > (unset → lock fallback)
PHASE_FILE="$HARNESS_ROOT/phase.txt"
read_phase() {
  if [ -n "${ACORN_PHASE_OVERRIDE:-}" ]; then
    printf '%s' "$ACORN_PHASE_OVERRIDE"
    return 0
  fi
  [ ! -f "$PHASE_FILE" ] && return 1
  local v
  v=$(head -n 1 "$PHASE_FILE" 2>/dev/null | tr -d '[:space:]')
  case "$v" in
    prototype|dev|production) printf '%s' "$v"; return 0 ;;
    *) return 1 ;;
  esac
}

phase_to_patterns() {
  case "$1" in
    prototype) printf 'minimal' ;;
    dev)       printf 'moderate' ;;
    production) printf 'strict' ;;
    *) return 1 ;;
  esac
}

ACORN_PHASE=""
PHASE_DERIVED_PATTERNS=""
if ACORN_PHASE=$(read_phase); then
  PHASE_DERIVED_PATTERNS=$(phase_to_patterns "$ACORN_PHASE") || PHASE_DERIVED_PATTERNS=""
fi

# 우선순위: env ACORN_GUARD_PATTERNS > phase 유래 > lock.guard.patterns > 기본
if [ -n "${ACORN_GUARD_PATTERNS:-}" ]; then
  GUARD_PATTERNS="$ACORN_GUARD_PATTERNS"
elif [ -n "$PHASE_DERIVED_PATTERNS" ]; then
  GUARD_PATTERNS="$PHASE_DERIVED_PATTERNS"
else
  GUARD_PATTERNS="$(parse_lock_field patterns strict)"
fi

GUARD_MODE="${ACORN_GUARD_MODE:-$(parse_lock_field mode block)}"

case "$GUARD_MODE" in
  block|warn|log) ;;
  *) GUARD_MODE="block" ;;
esac

case "$GUARD_PATTERNS" in
  strict|moderate|minimal) ;;
  *) GUARD_PATTERNS="strict" ;;
esac

# 3. stdin JSON 파싱 (fd 0, fail-close)
parse_command() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.tool_input.command // empty' 2>/dev/null
    return $?
  elif command -v node >/dev/null 2>&1; then
    node -e "
      try {
        const raw = require('fs').readFileSync(0, 'utf8');
        if (!raw.trim()) { process.exit(0); }
        const d = JSON.parse(raw);
        const cmd = (d.tool_input && d.tool_input.command) || '';
        process.stdout.write(cmd);
      } catch (e) { process.exit(1); }
    " 2>/dev/null
    return $?
  else
    return 1
  fi
}

STDIN_PAYLOAD=$(cat)
if [ -z "$STDIN_PAYLOAD" ]; then
  exit 0
fi

COMMAND=$(printf '%s' "$STDIN_PAYLOAD" | parse_command)
PARSE_EXIT=$?

if [ $PARSE_EXIT -ne 0 ]; then
  echo "[acorn-guard] 파싱 실패 — 차단 (fail-close)" >&2
  exit 1
fi

[ -z "$COMMAND" ] && exit 0

# 4. 패턴 매칭 — §15 H1 (v0.2.0): patterns 를 실제로 동작시키는 3단계 분기.
#    strict   = 기존 전체 패턴 (일상 실수까지 차단)
#    moderate = 대규모 파괴 + DB 관련만 (git push --force / reset --hard 는 통과)
#    minimal  = 되돌릴 수 없는 catastrophic 만 (mkfs, dd /dev/, fork bomb, DROP DATABASE)
#    push --force-with-lease 는 모든 레벨에서 항상 통과 (원격 상태 확인 후 강제 푸시)

is_dangerous_strict() {
  local cmd="$1"
  case "$cmd" in
    *"push --force-with-lease"*)
      # force-with-lease allowlist — 나머지 파괴적 패턴만 검사
      case "$cmd" in
        *"rm -rf"*|*"rm -fr"*|*"rm -Rf"*) return 0 ;;
        *"DROP TABLE"*|*"DROP DATABASE"*|*"TRUNCATE TABLE"*) return 0 ;;
        *"reset --hard"*) return 0 ;;
        *"chmod 777"*|*"chmod -R 777"*) return 0 ;;
        *":(){ :|:& };:"*) return 0 ;;
        *"mkfs"*) return 0 ;;
        *"> /dev/sda"*|*"> /dev/nvme"*) return 0 ;;
        *"dd if="*"of=/dev/"*) return 0 ;;
      esac
      return 1
      ;;
  esac
  case "$cmd" in
    *"rm -rf"*|*"rm -fr"*|*"rm -Rf"*) return 0 ;;
    *"DROP TABLE"*|*"DROP DATABASE"*|*"TRUNCATE TABLE"*) return 0 ;;
    *"push --force"*|*"push -f"*) return 0 ;;
    *"reset --hard"*) return 0 ;;
    *"chmod 777"*|*"chmod -R 777"*) return 0 ;;
    *":(){ :|:& };:"*) return 0 ;;
    *"mkfs"*) return 0 ;;
    *"> /dev/sda"*|*"> /dev/nvme"*) return 0 ;;
    *"dd if="*"of=/dev/"*) return 0 ;;
  esac
  return 1
}

is_dangerous_moderate() {
  # strict 에서 git 일상 (push --force, reset --hard) 허용.
  # rm -rf, chmod -R 777, DROP/TRUNCATE, catastrophic 은 여전히 차단.
  local cmd="$1"
  case "$cmd" in
    *"rm -rf"*|*"rm -fr"*|*"rm -Rf"*) return 0 ;;
    *"DROP TABLE"*|*"DROP DATABASE"*|*"TRUNCATE TABLE"*) return 0 ;;
    *"chmod 777"*|*"chmod -R 777"*) return 0 ;;
    *":(){ :|:& };:"*) return 0 ;;
    *"mkfs"*) return 0 ;;
    *"> /dev/sda"*|*"> /dev/nvme"*) return 0 ;;
    *"dd if="*"of=/dev/"*) return 0 ;;
  esac
  return 1
}

is_dangerous_minimal() {
  # 되돌릴 수 없는 hardware/catastrophic 만 차단.
  # rm -rf, DROP TABLE 같은 일반 실수는 허용 (사용자가 의식적으로 선택).
  local cmd="$1"
  case "$cmd" in
    *":(){ :|:& };:"*) return 0 ;;
    *"mkfs"*) return 0 ;;
    *"> /dev/sda"*|*"> /dev/nvme"*|*"> /dev/xvd"*) return 0 ;;
    *"dd if="*"of=/dev/"*) return 0 ;;
    *"DROP DATABASE"*) return 0 ;;
  esac
  return 1
}

is_dangerous() {
  case "$GUARD_PATTERNS" in
    moderate) is_dangerous_moderate "$1" ;;
    minimal)  is_dangerous_minimal "$1" ;;
    strict|*) is_dangerous_strict "$1" ;;
  esac
}

if is_dangerous "$COMMAND"; then
  case "$GUARD_MODE" in
    block)
      echo "[acorn-guard] 차단 (mode=$GUARD_MODE patterns=$GUARD_PATTERNS): $COMMAND" >&2
      echo "[acorn-guard] bypass: ACORN_GUARD_BYPASS=1 <command>" >&2
      exit 1
      ;;
    warn)
      echo "[acorn-guard] ⚠️  경고 (patterns=$GUARD_PATTERNS): $COMMAND" >&2
      exit 0
      ;;
    log)
      echo "[acorn-guard] log (patterns=$GUARD_PATTERNS): $COMMAND" >&2
      exit 0
      ;;
  esac
fi

exit 0
