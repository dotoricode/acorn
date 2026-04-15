#!/usr/bin/env bash
# dogfood/report.sh — 누적 로그 요약
# 사용: dreport

set -u

LOG="${ACORN_DOGFOOD_LOG:-$HOME/acorn-dogfood.log}"

if [ ! -f "$LOG" ]; then
  echo "로그 파일 없음: $LOG" >&2
  echo "wrap.sh 또는 note.sh 를 먼저 실행하거나 ACORN_DOGFOOD_LOG 를 확인하세요." >&2
  exit 1
fi

total_lines=$(wc -l < "$LOG" | tr -d ' ')
first_ts=$(grep -oE '^\[[^]]+\]' "$LOG" | head -1 | tr -d '[]')
last_ts=$(grep -oE '^\[[^]]+\]' "$LOG" | tail -1 | tr -d '[]')
invocations=$(grep -c '^  cmd: acorn ' "$LOG" 2>/dev/null | tr -d '[:space:]')
invocations=${invocations:-0}
notes=$(grep -c 'NOTE' "$LOG" 2>/dev/null | tr -d '[:space:]')
notes=${notes:-0}

echo "=== acorn 도그푸딩 요약 ==="
echo "로그: $LOG  ($total_lines 줄)"
echo "기간: $first_ts  →  $last_ts"
echo "실행: $invocations 회,  메모: $notes 건"
echo ""

echo "--- 서브커맨드 실행 분포 ---"
grep '^  cmd: acorn ' "$LOG" | awk '{print $3}' | sort | uniq -c | sort -rn
echo ""

echo "--- exit code 분포 ---"
grep -oE 'exit=[0-9]+' "$LOG" | sort | uniq -c | sort -rn
echo ""

echo "--- 호스트별 실행 ---"
grep '^\[' "$LOG" | grep -oE 'host=[^ ]+' | sort | uniq -c | sort -rn
echo ""

if [ "$notes" -gt 0 ]; then
  echo "--- 메모 (최신 20건) ---"
  grep 'NOTE' "$LOG" | tail -20
  echo ""

  echo "--- 라벨별 메모 ---"
  for label in blocker bug ux idea question; do
    cnt=$(grep -c "label=$label" "$LOG" 2>/dev/null | head -1 | tr -d '[:space:]')
    cnt=${cnt:-0}
    if [ "$cnt" -gt 0 ] 2>/dev/null; then
      echo "  $label: $cnt"
    fi
  done
  echo ""
fi

echo "--- 실패 (최근 5건) ---"
grep -B1 -A2 'exit=[1-9]' "$LOG" | tail -30 || echo "  (없음)"
