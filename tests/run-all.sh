#!/usr/bin/env bash
# Run every test suite against a FRESH dev server, N times, and print a pass/fail table.
#
#   tests/run-all.sh [-n N] [-p PORTBASE] [-m mem|pg|redis|all] [-s REGEX] [-A] [-U] [-k]
#
#   -n N         repeat everything N times (default 3)
#   -p PORTBASE  dev server port (default 3105); self-managed suites also use PORTBASE+1..+3
#   -m MODE      storage: mem (default, in-memory), pg (local Postgres mup_e),
#                redis (mock Upstash on MOCK_PORT=8089 + Postgres mirror = production setup), all = mem+pg+redis
#   -s REGEX     only suites whose file name matches REGEX
#   -A           API suites only     -U  UI suites only (ui-*.py, Playwright; mem mode)
#   -k           keep going quietly (no per-suite output tail on failure)
#
# Every suite gets its own server ("node dev-server.js tagE<port>"), started fresh and killed afterwards
# with an exact pkill pattern, so other agents' servers are never touched. In pg/redis mode the database
# (and mock Redis) is wiped before every suite run. Exit code is non-zero if anything failed.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
N=3; PB=3105; MODES=mem; FILTER=''; WHAT=all; QUIET=0
while getopts "n:p:m:s:AUk" o; do
  case "$o" in
    n) N="$OPTARG" ;; p) PB="$OPTARG" ;; m) MODES="$OPTARG" ;; s) FILTER="$OPTARG" ;;
    A) WHAT=api ;; U) WHAT=ui ;; k) QUIET=1 ;;
    *) sed -n '2,16p' "$0"; exit 2 ;;
  esac
done
[ "$MODES" = all ] && MODES="mem pg redis"
MOCK_PORT="${MOCK_PORT:-8089}"
PG_URL="postgres://postgres:pw@localhost:5432/mup_e"
LOGDIR="${E_LOGDIR:-/tmp/e-runs}/$(date +%H%M%S)-$$"
mkdir -p "$LOGDIR"
# per-suite time limit; macOS has no `timeout` unless coreutils (gtimeout) is installed
TMO=()
if command -v timeout >/dev/null; then TMO=(timeout 600); elif command -v gtimeout >/dev/null; then TMO=(gtimeout 600); fi
unset KV_REST_API_URL KV_REST_API_TOKEN UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN DATABASE_URL POSTGRES_URL NEON_DATABASE_URL MUP_PG_LOCAL

API_SUITES=(apitest.mjs apitest2.mjs multitest.mjs boardtest.mjs)
for f in tests/v2-*.mjs tests/v3-*.mjs tests/v4-*.mjs; do [ -e "$f" ] && API_SUITES+=("$(basename "$f")"); done
UI_SUITES=()
for f in tests/ui-*.py; do [ -e "$f" ] && UI_SUITES+=("$(basename "$f")"); done

TAG="tagE$PB"
SRV_PID=''; MOCK_PID=''
stop_server() {
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null
  pkill -f "^node dev-server.js $TAG\$" 2>/dev/null
  for _ in $(seq 1 30); do pgrep -f "^node dev-server.js $TAG\$" >/dev/null || break; sleep 0.1; done
  SRV_PID=''
}
stop_mock() { [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null; MOCK_PID=''; sleep 0.1; }
ROWS=(); ANYFAIL=0; CUR=''
# the table of every suite that finished, plus the one that was running (also on Ctrl-C / kill)
summary() {
  echo
  printf '%-6s %-24s %3s %5s %5s %5s %6s\n' mode suite run pass fail warn time
  [ ${#ROWS[@]} -gt 0 ] && printf '%s\n' "${ROWS[@]}"
  [ -n "$CUR" ] && echo "INTERRUPTED during: $CUR"
  echo "logs: $LOGDIR"
  if [ -n "$CUR" ]; then echo "INTERRUPTED"; elif [ $ANYFAIL = 0 ]; then echo "ALL PASSED"; else echo "SOME FAILED"; fi
}
trap 'stop_server; stop_mock' EXIT
CHILD=''
stop_child() { [ -n "$CHILD" ] && { pkill -TERM -P "$CHILD" 2>/dev/null; kill "$CHILD" 2>/dev/null; }; CHILD=''; }
trap 'stop_child; stop_server; stop_mock; summary; exit 130' INT TERM HUP

store_env() { # $1 = mode
  case "$1" in
    pg) echo "MUP_PG_LOCAL=1 DATABASE_URL=$PG_URL" ;;
    redis) echo "MUP_PG_LOCAL=1 DATABASE_URL=$PG_URL UPSTASH_REDIS_REST_URL=http://localhost:$MOCK_PORT UPSTASH_REDIS_REST_TOKEN=test-token" ;;
    *) echo "" ;;
  esac
}
wipe_pg() { # psql if installed, else the same statement through the repo's pg module
  if command -v psql >/dev/null; then PGPASSWORD=pw psql -q -h localhost -U postgres -d mup_e -c 'drop table if exists mup_kv, mup_h, mup_log' >/dev/null 2>&1
  else node --input-type=module -e "const {default:pg}=await import('pg');const c=new pg.Client({connectionString:'$PG_URL'});await c.connect();try{await c.query('drop table if exists mup_kv, mup_h, mup_log')}finally{await c.end()}" >/dev/null 2>&1; fi
}
start_mock() {
  MOCK_PORT=$MOCK_PORT node tests/mock-upstash.mjs > "$LOGDIR/mock.log" 2>&1 &
  MOCK_PID=$!
  for _ in $(seq 1 50); do curl -s -o /dev/null "http://localhost:$MOCK_PORT/__stats" && return 0; sleep 0.1; done
  echo "mock upstash did not start" >&2; return 1
}
start_server() { # $1 = mode, $2 = log file
  stop_server
  # shellcheck disable=SC2046
  env PORT="$PB" $(store_env "$1") node dev-server.js "$TAG" > "$2" 2>&1 &
  SRV_PID=$!
  for _ in $(seq 1 100); do curl -s -o /dev/null "http://localhost:$PB/" && return 0; sleep 0.1; done
  echo "dev server did not start" >&2; return 1
}

run_one() { # $1 mode, $2 suite, $3 run
  local mode="$1" suite="$2" run="$3" log="$LOGDIR/$1-$2-$3.log" slog="$LOGDIR/$1-$2-$3.server.log"
  local self=0 rc=0
  CUR="$mode $suite run $run"
  head -5 "tests/$suite" | grep -q '@self-managed' && self=1
  [ "$mode" != mem ] && wipe_pg
  [ "$mode" = redis ] && start_mock
  if [ $self = 0 ]; then start_server "$mode" "$slog" || { echo "server failed" > "$log"; }; fi
  local t0=$SECONDS
  case "$suite" in
    *.py) BASE="http://localhost:$PB" E_MODE="$mode" ${TMO[@]+"${TMO[@]}"} python3 "tests/$suite" > "$log" 2>&1 & ;;
    *) BASE="http://localhost:$PB/api/game" E_MODE="$mode" E_PORT=$((PB + 1)) MOCK_PORT="$MOCK_PORT" \
         MOCK_URL="$([ "$mode" = redis ] && echo "http://localhost:$MOCK_PORT")" \
         ${TMO[@]+"${TMO[@]}"} node "tests/$suite" "http://localhost:$PB/api/game" > "$log" 2>&1 & ;;
  esac
  # in the background + wait, so a Ctrl-C / kill is handled at once (summary) instead of after the suite
  CHILD=$!; wait "$CHILD"; rc=$?; CHILD=''
  local secs=$((SECONDS - t0))
  [ $self = 0 ] && stop_server
  [ "$mode" = redis ] && stop_mock
  local p f w
  p=$(grep -c '^ok' "$log"); f=$(grep -cE '^FAIL[ :]' "$log"); w=$(grep -c '^WARN' "$log")
  if [ "$rc" != 0 ] && [ "$f" = 0 ]; then f=1; fi
  if [ "$f" != 0 ]; then
    ANYFAIL=1
    if [ $QUIET = 0 ]; then echo "---- $mode $suite run $run: $f failed (log $log)"; grep -E '^FAIL[ :]' "$log" | head -15; fi
  fi
  ROWS+=("$(printf '%-6s %-24s %3s %5s %5s %5s %5ss' "$mode" "$suite" "$run" "$p" "$f" "$w" "$secs")")
  printf '%-6s %-24s run %s: pass %s fail %s warn %s (%ss)\n' "$mode" "$suite" "$run" "$p" "$f" "$w" "$secs"
  CUR=''
}

for mode in $MODES; do
  for run in $(seq 1 "$N"); do
    if [ "$WHAT" != ui ]; then
      for s in "${API_SUITES[@]}"; do
        [ -n "$FILTER" ] && ! [[ "$s" =~ $FILTER ]] && continue
        run_one "$mode" "$s" "$run"
      done
    fi
    if [ "$WHAT" != api ] && [ "$mode" = mem ]; then
      for s in "${UI_SUITES[@]}"; do
        [ -n "$FILTER" ] && ! [[ "$s" =~ $FILTER ]] && continue
        run_one "$mode" "$s" "$run"
      done
    fi
  done
done

summary
exit $ANYFAIL
