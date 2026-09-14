#!/usr/bin/env bash
# Thin dev-server lifecycle helper. Avoids pattern-matching footguns when
# scripts must kill long-running node processes (pkill -f self-matches).
set -euo pipefail

PID_FILE="${ERP_PID_FILE:-/tmp/opencode/erp.pid}"
LOG_FILE="${ERP_LOG_FILE:-/tmp/opencode/erp.log}"

case "${1:-}" in
  start)
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "already running (pid $(cat "$PID_FILE"))"
      exit 0
    fi
    rm -f "$LOG_FILE"
    setsid nohup node dist/main.js > "$LOG_FILE" 2>&1 < /dev/null &
    echo "$!" > "$PID_FILE"
    echo "started pid $!"
    ;;
  stop)
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      kill "$(cat "$PID_FILE")"
      rm -f "$PID_FILE"
      echo "stopped"
    else
      echo "not running"
    fi
    ;;
  restart)
    "$0" stop || true
    sleep 1
    "$0" start
    ;;
  status)
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "running (pid $(cat "$PID_FILE"))"
    else
      echo "not running"
    fi
    ;;
  *)
    echo "usage: $0 {start|stop|restart|status}" >&2
    exit 1
    ;;
esac