#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PG_HOME="${PG_HOME:-$HOME/.local/share/erp-pg}"
REDIS_DIR="${REDIS_DIR:-$HOME/.local/share/erp-redis}"
PG_BIN="$PG_HOME/usr/bin"
PG_DATA="$PG_HOME/data"
PG_SOCKET="$PG_HOME/socket"
PG_LOG="$PG_HOME/log/pg.log"
PG_PORT="${PG_PORT:-5432}"
PG_SUPERUSER="${PG_SUPERUSER:-erp}"
DB_NAME="${DB_NAME:-erp}"
PG_PASSWORD="${PG_PASSWORD:-erp_dev_password}"
REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_LOG="$REDIS_DIR/redis.log"
REDIS_PID="$REDIS_DIR/redis.pid"

RUNTIME="$HOME/.local/share/erp-dev"
ERP_PID_FILE="${ERP_PID_FILE:-$RUNTIME/erp.pid}"
ERP_LOG_FILE="${ERP_LOG_FILE:-$RUNTIME/erp.log}"
WEB_PID_FILE="${WEB_PID_FILE:-$RUNTIME/web.pid}"
WEB_LOG_FILE="${WEB_LOG_FILE:-$RUNTIME/web.log}"
WEB_PORT="${WEB_PORT:-3001}"

log() { printf '\033[1;36m[dev-env]\033[0m %s\n' "$*"; }

pg_bin() {
  if [[ -x "$PG_BIN/$1" ]]; then
    echo "$PG_BIN/$1"
  elif command -v "$1" >/dev/null 2>&1; then
    echo "$1"
  else
    log "missing required binary: $1 (looked in $PG_BIN and PATH)"
    exit 1
  fi
}

pg_env() {
  export PATH="$PG_BIN:$PATH"
  export LD_LIBRARY_PATH="$PG_HOME/usr/lib:${LD_LIBRARY_PATH:-}"
}

pg_running() {
  pg_env
  "$(pg_bin pg_ctl)" -D "$PG_DATA" status >/dev/null 2>&1
}

redis_running() {
  timeout 2 redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1
}

port_pid() {
  ss -ltnp 2>/dev/null | grep -F ":$1 " | grep -oP 'pid=\K[0-9]+' | sort -u | head -1 || true
}

api_running() {
  [[ -n "$(port_pid 3000)" ]]
}

web_running() {
  [[ -n "$(port_pid "$WEB_PORT")" ]]
}

wait_pg() {
  local isready
  isready="$(pg_bin pg_isready)"
  for _ in $(seq 1 20); do
    if "$isready" -h 127.0.0.1 -p "$PG_PORT" -q 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  log "postgres did not become ready — see $PG_LOG"
  exit 1
}

wait_url() {
  local port="$1" path="${2:-/}"
  for _ in $(seq 1 40); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$port$path" 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  return 1
}

start_pg() {
  if pg_running; then
    log "postgres already running on 127.0.0.1:$PG_PORT"
    return
  fi
  mkdir -p "$PG_SOCKET" "$PG_HOME/log"
  if [[ ! -f "$PG_DATA/PG_VERSION" ]]; then
    log "initializing fresh postgres cluster ($PG_SUPERUSER/$DB_NAME)"
    local pwfile="$RUNTIME/pwfile"
    mkdir -p "$RUNTIME"
    printf '%s\n' "$PG_PASSWORD" > "$pwfile"
    pg_env
    "$(pg_bin initdb)" -D "$PG_DATA" -U "$PG_SUPERUSER" --pwfile="$pwfile" \
      -A scram-sha-256 -E UTF8 --locale=C --encoding=UTF8 > "$PG_HOME/log/initdb.log" 2>&1
    rm -f "$pwfile"
    "$(pg_bin pg_ctl)" -D "$PG_DATA" -l "$PG_LOG" \
      -o "-p $PG_PORT -h 127.0.0.1 -k $PG_SOCKET" start >/dev/null 2>&1
    wait_pg
    local createdb
    createdb="$(pg_bin createdb)"
    PGPASSWORD="$PG_PASSWORD" "$createdb" -h 127.0.0.1 -p "$PG_PORT" -U "$PG_SUPERUSER" "$DB_NAME"
    log "postgres ready (db $DB_NAME created)"
    return
  fi
  log "starting postgres on 127.0.0.1:$PG_PORT"
  pg_env
  "$(pg_bin pg_ctl)" -D "$PG_DATA" -l "$PG_LOG" \
    -o "-p $PG_PORT -h 127.0.0.1 -k $PG_SOCKET" start >/dev/null 2>&1
  wait_pg
  log "postgres ready"
}

start_redis() {
  if redis_running; then
    log "redis already running on 127.0.0.1:$REDIS_PORT"
    return
  fi
  mkdir -p "$REDIS_DIR"
  redis-server --port "$REDIS_PORT" --daemonize yes \
    --dir "$REDIS_DIR" --logfile "$REDIS_LOG" \
    --pidfile "$REDIS_PID" --appendonly no --save ""
  timeout 5 bash -c "until redis-cli -p $REDIS_PORT ping >/dev/null 2>&1; do sleep 0.3; done"
  log "redis ready on 127.0.0.1:$REDIS_PORT"
}

start_api() {
  if api_running; then
    log "api already running (pid $(port_pid 3000))"
    return
  fi
  if [[ ! -f "$ROOT_DIR/dist/main.js" ]]; then
    log "dist/main.js missing — building API first"
    npm --prefix "$ROOT_DIR" run build
  fi
  mkdir -p "$RUNTIME"
  ERP_PID_FILE="$ERP_PID_FILE" ERP_LOG_FILE="$ERP_LOG_FILE" "$ROOT_DIR/scripts/dev-server.sh" start
  if wait_url 3000 /api/v1/health; then
    log "api ready on :3000"
  else
    log "api health check timed out — see $ERP_LOG_FILE"
    exit 1
  fi
}

start_web() {
  if web_running; then
    log "web already running (pid $(port_pid "$WEB_PORT"))"
    return
  fi
  mkdir -p "$RUNTIME"
  (
    cd "$ROOT_DIR/web"
    setsid nohup npm run dev > "$WEB_LOG_FILE" 2>&1 < /dev/null &
    echo "$!" > "$WEB_PID_FILE"
  )
  if wait_url "$WEB_PORT" /; then
    log "web ready on :$WEB_PORT"
  else
    log "web did not become ready — see $WEB_LOG_FILE"
    exit 1
  fi
}

stop_web() {
  local pid
  pid="$(port_pid "$WEB_PORT")"
  if [[ -n "${pid:-}" ]]; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    log "web stopped"
  else
    log "web not running"
  fi
  rm -f "$WEB_PID_FILE"
}

stop_api() {
  local pid
  pid="$(port_pid 3000)"
  if [[ -n "${pid:-}" ]]; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    log "api stopped"
  else
    log "api not running"
  fi
  rm -f "$ERP_PID_FILE"
}

stop_redis() {
  if redis_running; then
    redis-cli -p "$REDIS_PORT" shutdown nosave
    log "redis stopped"
  else
    log "redis not running"
  fi
}

stop_pg() {
  if pg_running; then
    pg_env
    "$(pg_bin pg_ctl)" -D "$PG_DATA" -m fast stop >/dev/null 2>&1
    log "postgres stopped"
  else
    log "postgres not running"
  fi
}

status() {
  if pg_running; then log "postgres   running  on 127.0.0.1:$PG_PORT"; else log "postgres   stopped"; fi
  if redis_running; then log "redis      running  on 127.0.0.1:$REDIS_PORT"; else log "redis      stopped"; fi
  if api_running; then log "api        running  (pid $(port_pid 3000))"; else log "api        stopped"; fi
  if web_running; then log "web        running  (pid $(port_pid "$WEB_PORT"))"; else log "web        stopped"; fi
}

seed() {
  npm --prefix "$ROOT_DIR" run db:migrate
  npx --prefix "$ROOT_DIR" tsx "$ROOT_DIR/prisma/seed.ts"
  log "migrations + seed complete"
}

case "${1:-}" in
  start|up)
    start_pg
    start_redis
    start_api
    start_web
    status
    ;;
  stop)
    stop_web || true
    stop_api || true
    stop_redis || true
    stop_pg || true
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  status)
    status
    ;;
  seed)
    seed
    ;;
  *)
    echo "usage: $0 {start|stop|restart|status|seed}" >&2
    exit 1
    ;;
esac