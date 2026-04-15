#!/usr/bin/env bash
# dogfood/wrap.sh — acorn 자동 실행 로거
#
# 호출할 때마다 커맨드 / 인자 / 종료코드 / 소요시간 / 호스트 / cwd 를
# $ACORN_DOGFOOD_LOG 에 append. 실 acorn 출력은 그대로 통과.
#
# 설치: ~/.zshrc 또는 ~/.bashrc 에
#   alias adog="$ACORN_REPO/scripts/dogfood/wrap.sh"
# 이후 `adog status`, `adog install --force` 식으로 사용.
#
# 환경변수:
#   ACORN_DOGFOOD_LOG  로그 파일 경로 (기본: ~/acorn-dogfood.log)
#   ACORN_BIN          실행할 acorn 경로 (기본: npm root -g 또는 리포 dist/)

set -u

LOG="${ACORN_DOGFOOD_LOG:-$HOME/acorn-dogfood.log}"
TS="$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S)"
START_EPOCH="$(date +%s)"
HOST="$(hostname -s 2>/dev/null || hostname || echo unknown)"
CWD="$(pwd)"

# acorn 실행 파일 탐색 (alias 무한 루프 방지)
resolve_acorn() {
  if [ -n "${ACORN_BIN:-}" ] && [ -x "$ACORN_BIN" ]; then
    echo "$ACORN_BIN"
    return
  fi
  # 리포 상대 경로
  local script_dir repo_dist
  script_dir="$(cd "$(dirname "$0")" && pwd)"
  repo_dist="$script_dir/../../dist/index.js"
  if [ -f "$repo_dist" ]; then
    echo "node $repo_dist"
    return
  fi
  # npm global
  local npm_root
  npm_root="$(npm root -g 2>/dev/null || echo '')"
  if [ -n "$npm_root" ] && [ -f "$npm_root/@dotoricode/acorn/dist/index.js" ]; then
    echo "node $npm_root/@dotoricode/acorn/dist/index.js"
    return
  fi
  echo "ERROR: acorn 실행 파일을 찾을 수 없음" >&2
  exit 127
}

ACORN_CMD="$(resolve_acorn)"

# stderr 를 임시 파일로 tee 하면서 동시에 화면에도 출력
STDERR_TMP="$(mktemp -t acorn-dogfood.XXXXXX)"
trap 'rm -f "$STDERR_TMP"' EXIT

# shellcheck disable=SC2086
$ACORN_CMD "$@" 2> >(tee "$STDERR_TMP" >&2)
RC=$?

END_EPOCH="$(date +%s)"
DUR=$((END_EPOCH - START_EPOCH))

mkdir -p "$(dirname "$LOG")"
{
  printf '[%s] host=%s cwd=%s\n' "$TS" "$HOST" "$CWD"
  printf '  cmd: acorn %s\n' "$*"
  printf '  exit=%d duration=%ds\n' "$RC" "$DUR"
  if [ "$RC" -ne 0 ] && [ -s "$STDERR_TMP" ]; then
    printf '  stderr-tail:\n'
    tail -n 5 "$STDERR_TMP" | sed 's/^/    /'
  fi
} >> "$LOG"

exit "$RC"
