#!/usr/bin/env bash
# §15 v0.2.0 S6 — Windows npm link 대체 shim 생성 스크립트.
#
# 배경: Node 24 + Windows 10 조합에서 'npm link' 가 Junction 을 만들고
# Node lstat 이 child path 를 traverse 못 해 'acorn --version' 이 실패함
# (도그푸딩 Round 2 실증). 이 스크립트는 junction 없이 .cmd + bash shim
# 두 개만 만들어 문제를 회피한다.
#
# 사용:
#   bash scripts/install-shim-windows.sh              (기본: $APPDATA/npm)
#   bash scripts/install-shim-windows.sh --prefix <path>
#
# 생성 파일:
#   <prefix>/acorn.cmd        cmd/PowerShell 용
#   <prefix>/acorn            Git Bash / WSL 용 (shebang script)
#
# PATH 에 <prefix> 가 포함되어 있으면 'acorn --version' 바로 작동.

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_JS="$REPO_ROOT/dist/index.js"

if [ ! -f "$DIST_JS" ]; then
  echo "[shim] dist/index.js 없음: $DIST_JS" >&2
  echo "[shim] npm run build 를 먼저 실행하세요." >&2
  exit 1
fi

# Prefix 결정: --prefix 인자 우선, 없으면 npm prefix -g, 없으면 Windows 기본.
PREFIX=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prefix)
      PREFIX="$2"
      shift 2
      ;;
    --prefix=*)
      PREFIX="${1#--prefix=}"
      shift
      ;;
    *)
      echo "[shim] 알 수 없는 인자: $1" >&2
      exit 64
      ;;
  esac
done

if [ -z "$PREFIX" ]; then
  if command -v npm >/dev/null 2>&1; then
    PREFIX="$(npm prefix -g 2>/dev/null || true)"
  fi
fi
if [ -z "$PREFIX" ]; then
  PREFIX="${APPDATA:-$HOME/AppData/Roaming}/npm"
fi

mkdir -p "$PREFIX"

# Windows 경로로 변환 (cygpath 있으면 사용, 없으면 그대로)
if command -v cygpath >/dev/null 2>&1; then
  DIST_JS_WIN="$(cygpath -w "$DIST_JS")"
else
  DIST_JS_WIN="$DIST_JS"
fi

# .cmd shim — cmd/PowerShell 용
cat > "$PREFIX/acorn.cmd" <<EOF
@ECHO off
node "$DIST_JS_WIN" %*
EOF

# bash shim — Git Bash / WSL 용
cat > "$PREFIX/acorn" <<EOF
#!/usr/bin/env bash
exec node "$DIST_JS" "\$@"
EOF
chmod +x "$PREFIX/acorn"

echo "✅ shim 생성 완료"
echo "   prefix:     $PREFIX"
echo "   dist entry: $DIST_JS"
echo ""
echo "PATH 에 '$PREFIX' 가 포함됐는지 확인 후 'acorn --version' 테스트."
echo "repo 경로가 바뀌면 이 스크립트를 다시 실행하세요 (shim 이 절대경로 하드코딩)."
