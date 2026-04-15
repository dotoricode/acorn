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

# 2. Mode 결정 (env > harness.lock > default:block)
parse_mode() {
  if [ -n "${ACORN_GUARD_MODE:-}" ]; then
    printf '%s' "$ACORN_GUARD_MODE"
    return 0
  fi
  [ ! -f "$LOCK_FILE" ] && return 1
  if command -v jq >/dev/null 2>&1; then
    jq -r '.guard.mode // "block"' "$LOCK_FILE" 2>/dev/null
  elif command -v node >/dev/null 2>&1; then
    node -e "
      try {
        const d = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
        process.stdout.write((d.guard && d.guard.mode) || 'block');
      } catch (e) { process.exit(1); }
    " "$LOCK_FILE" 2>/dev/null
  else
    return 1
  fi
}

GUARD_MODE=$(parse_mode 2>/dev/null)
[ -z "$GUARD_MODE" ] && GUARD_MODE="block"

case "$GUARD_MODE" in
  block|warn|log) ;;
  *) GUARD_MODE="block" ;;
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

# 4. 패턴 매칭 + mode 분기
is_dangerous() {
  local cmd="$1"
  # Allowlist: --force-with-lease 는 원격 상태 체크 후에만 강제 푸시하는 안전 관용구
  # push --force 패턴을 검사하기 전에 이 경우를 먼저 걸러낸다.
  case "$cmd" in
    *"push --force-with-lease"*)
      # force-with-lease 만 쓰는 경우는 위험 아님. 다른 패턴 계속 검사.
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

if is_dangerous "$COMMAND"; then
  case "$GUARD_MODE" in
    block)
      echo "[acorn-guard] 차단: $COMMAND" >&2
      echo "[acorn-guard] bypass: ACORN_GUARD_BYPASS=1 <command>" >&2
      exit 1
      ;;
    warn)
      echo "[acorn-guard] ⚠️  경고: $COMMAND" >&2
      exit 0
      ;;
    log)
      echo "[acorn-guard] log: $COMMAND" >&2
      exit 0
      ;;
  esac
fi

exit 0
