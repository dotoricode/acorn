#!/usr/bin/env bash
# dogfood/note.sh — 1줄 정성 메모 추가
#
# 사용: dn "doctor --json 의 issues[].hint 에 \n 이 이스케이프 안 됨"
# 설치: alias dn="$ACORN_REPO/scripts/dogfood/note.sh"

set -u

LOG="${ACORN_DOGFOOD_LOG:-$HOME/acorn-dogfood.log}"
TS="$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S)"
HOST="$(hostname -s 2>/dev/null || hostname || echo unknown)"

if [ $# -eq 0 ]; then
  echo "사용: dn '<한 줄 메모>'" >&2
  echo "      dn bug 'doctor --json hint 줄바꿈 안 됨'" >&2
  echo "      dn ux '2머신 sync 한 커맨드 있으면 좋겠음'" >&2
  exit 64
fi

# 첫 인자가 분류 라벨이면 분리 (bug/ux/idea/question)
LABEL=""
case "${1:-}" in
  bug|ux|idea|question|blocker)
    LABEL="$1"
    shift
    ;;
esac

MSG="$*"
[ -z "$MSG" ] && { echo "메모가 비어있음" >&2; exit 64; }

mkdir -p "$(dirname "$LOG")"
{
  if [ -n "$LABEL" ]; then
    printf '[%s] NOTE host=%s label=%s: %s\n' "$TS" "$HOST" "$LABEL" "$MSG"
  else
    printf '[%s] NOTE host=%s: %s\n' "$TS" "$HOST" "$MSG"
  fi
} >> "$LOG"

printf '기록됨: %s\n' "$LOG"
