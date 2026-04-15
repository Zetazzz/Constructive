#!/usr/bin/env bash
# E2E Benchmark Orchestrator
# Runs old mode (dedicated) and new mode (multi-tenancy cache) back-to-back,
# then compares results.
#
# Usage: bash run-e2e-benchmark.sh [K] [DURATION] [WORKERS]

set -euo pipefail

K="${1:-20}"
DURATION="${2:-300}"
WORKERS="${3:-8}"
SERVER_PORT=3000
SERVER_DIR="/home/ubuntu/repos/Constructive/graphql/server"
# No Crystal fork needed — wrapper approach works with published Crystal packages

# Common env vars
export PGHOST=localhost
export PGPORT=5432
export PGUSER=postgres
export PGPASSWORD=password
export PGDATABASE=postgres
export API_IS_PUBLIC=false
export SERVER_HOST=localhost
export SERVER_PORT=$SERVER_PORT
export NODE_ENV=development
export GRAPHQL_OBSERVABILITY_ENABLED=true

echo "=============================================================="
echo "E2E Multi-Tenancy Benchmark Orchestrator"
echo "  K=$K tenants, Duration=${DURATION}s, Workers=$WORKERS"
echo "=============================================================="

kill_server() {
  fuser -k ${SERVER_PORT}/tcp 2>/dev/null || true
  sleep 2
}

wait_for_server() {
  local max_wait=60
  local waited=0
  echo -n "  Waiting for server on port $SERVER_PORT..."
  while ! curl -sf http://localhost:${SERVER_PORT}/graphql \
    -H 'Content-Type: application/json' \
    -H 'X-Schemata: services_public' \
    -H 'X-Database-Id: health-check' \
    -d '{"query":"{ __typename }"}' >/dev/null 2>&1; do
    sleep 1
    waited=$((waited + 1))
    if [ $waited -ge $max_wait ]; then
      echo " TIMEOUT after ${max_wait}s"
      return 1
    fi
    echo -n "."
  done
  echo " ready (${waited}s)"
}

start_server() {
  local mode="$1"
  echo ""
  echo "--------------------------------------------------------------"
  echo "Starting server in ${mode} mode..."
  echo "--------------------------------------------------------------"

  kill_server

  if [ "$mode" = "new" ]; then
    export USE_MULTI_TENANCY_CACHE=true
    unset GRAPHILE_CACHE_MAX 2>/dev/null || true
  else
    unset USE_MULTI_TENANCY_CACHE 2>/dev/null || true
    # Enlarge GRAPHILE_CACHE_MAX for old approach to prevent unfair cache
    # eviction churn. Set to 6x the number of tenants (minimum 100).
    local old_cache_max=$(( K * 6 ))
    if [ "$old_cache_max" -lt 100 ]; then
      old_cache_max=100
    fi
    export GRAPHILE_CACHE_MAX="$old_cache_max"
    echo "  GRAPHILE_CACHE_MAX=$old_cache_max (enlarged for old approach)"
  fi

  cd "$SERVER_DIR"
  npx ts-node src/run.ts > /tmp/server-${mode}.log 2>&1 &
  SERVER_PID=$!
  echo "  Server PID: $SERVER_PID"

  wait_for_server
  echo "  Server config: USE_MULTI_TENANCY_CACHE=${USE_MULTI_TENANCY_CACHE:-unset}"
}

run_benchmark() {
  local mode="$1"
  echo ""
  echo "=============================================================="
  echo "Running ${mode^^} mode benchmark (k=$K, ${DURATION}s, ${WORKERS} workers)"
  echo "=============================================================="

  cd "$SERVER_DIR"
  MODE="$mode" K="$K" DURATION="$DURATION" WORKERS="$WORKERS" \
    SERVER_PORT="$SERVER_PORT" \
    npx ts-node e2e-benchmark.ts 2>&1 | tee /tmp/e2e-benchmark-${mode}-output.txt

  echo ""
  echo "  ${mode^^} mode complete."
}

compare_results() {
  echo ""
  echo "=============================================================="
  echo "COMPARISON: OLD (Dedicated) vs NEW (Multi-tenancy Cache)"
  echo "=============================================================="

  local old_file="/tmp/e2e-benchmark-old-k${K}.json"
  local new_file="/tmp/e2e-benchmark-new-k${K}.json"

  if [ ! -f "$old_file" ] || [ ! -f "$new_file" ]; then
    echo "  ERROR: Missing result files"
    return 1
  fi

  python3 << 'PYEOF'
import json, sys

k = int(sys.argv[1]) if len(sys.argv) > 1 else 20

with open(f"/tmp/e2e-benchmark-old-k{k}.json") as f:
    old = json.load(f)
with open(f"/tmp/e2e-benchmark-new-k{k}.json") as f:
    new = json.load(f)

def fmt(v, unit=""):
    if isinstance(v, float):
        return f"{v:.2f}{unit}"
    return f"{v:,}{unit}"

def delta(o, n, unit="", lower_better=True):
    if o == 0:
        return "N/A"
    diff = n - o
    pct = (diff / o) * 100
    direction = "↓" if diff < 0 else "↑"
    good = (diff < 0 and lower_better) or (diff > 0 and not lower_better)
    marker = "✓" if good else "✗"
    return f"{diff:+.1f}{unit} ({pct:+.1f}%) {direction}"

print()
print(f"{'Metric':<25} {'Dedicated (Old)':<20} {'Multi-tenant (New)':<20} {'Delta':<30}")
print("─" * 95)
print(f"{'Tenants (k)':<25} {fmt(old['k']):<20} {fmt(new['k']):<20}")
print(f"{'Duration':<25} {fmt(old['durationSec'], 's'):<20} {fmt(new['durationSec'], 's'):<20}")
print(f"{'Workers':<25} {fmt(old['workers']):<20} {fmt(new['workers']):<20}")
print(f"{'Total Queries':<25} {fmt(old['totalQueries']):<20} {fmt(new['totalQueries']):<20} {delta(old['totalQueries'], new['totalQueries'], '', False)}")
print(f"{'Errors':<25} {fmt(old['errors']):<20} {fmt(new['errors']):<20} {delta(old['errors'], new['errors'], '', True)}")
print(f"{'QPS':<25} {fmt(old['qps']):<20} {fmt(new['qps']):<20} {delta(old['qps'], new['qps'], '', False)}")
print(f"{'p50 Latency':<25} {fmt(old['p50'], 'ms'):<20} {fmt(new['p50'], 'ms'):<20} {delta(old['p50'], new['p50'], 'ms', True)}")
print(f"{'p95 Latency':<25} {fmt(old['p95'], 'ms'):<20} {fmt(new['p95'], 'ms'):<20} {delta(old['p95'], new['p95'], 'ms', True)}")
print(f"{'p99 Latency':<25} {fmt(old['p99'], 'ms'):<20} {fmt(new['p99'], 'ms'):<20} {delta(old['p99'], new['p99'], 'ms', True)}")
print(f"{'Heap Before':<25} {fmt(old['heapBefore'], ' MB'):<20} {fmt(new['heapBefore'], ' MB'):<20}")
print(f"{'Heap After':<25} {fmt(old['heapAfter'], ' MB'):<20} {fmt(new['heapAfter'], ' MB'):<20}")
print(f"{'Heap Delta':<25} {fmt(old['heapDelta'], ' MB'):<20} {fmt(new['heapDelta'], ' MB'):<20} {delta(old['heapDelta'], new['heapDelta'], ' MB', True)}")
print()

# Cold start analysis
old_cold = old.get('coldStartMs', [])
new_cold = new.get('coldStartMs', [])
if old_cold and new_cold:
    print(f"{'Cold Start (1st tenant)':<25} {fmt(old_cold[0], 'ms'):<20} {fmt(new_cold[0], 'ms'):<20}")
    print(f"{'Cold Start (last tenant)':<25} {fmt(old_cold[-1], 'ms'):<20} {fmt(new_cold[-1], 'ms'):<20}")
    old_avg = sum(old_cold) / len(old_cold)
    new_avg = sum(new_cold) / len(new_cold)
    print(f"{'Cold Start (avg)':<25} {fmt(old_avg, 'ms'):<20} {fmt(new_avg, 'ms'):<20} {delta(old_avg, new_avg, 'ms', True)}")
    # In new mode, after first tenant, subsequent should be near-instant (cache hit)
    if len(new_cold) > 1:
        new_cached = sum(new_cold[1:]) / len(new_cold[1:])
        old_cached = sum(old_cold[1:]) / len(old_cold[1:])
        print(f"{'Cold Start (2nd+ avg)':<25} {fmt(old_cached, 'ms'):<20} {fmt(new_cached, 'ms'):<20} {delta(old_cached, new_cached, 'ms', True)}")

print()
print("─" * 95)
PYEOF
}

# ─── Main Flow ───────────────────────────────────────────────────────────────

# Phase A: Run OLD mode (dedicated PostGraphile instances per tenant)
start_server "old"
run_benchmark "old"
kill_server

# Phase B: Run NEW mode (multi-tenancy cache with shared templates)
start_server "new"
run_benchmark "new"
kill_server

# Phase C: Compare results
compare_results "$K"

echo ""
echo "Benchmark complete. Result files:"
echo "  /tmp/e2e-benchmark-old-k${K}.json"
echo "  /tmp/e2e-benchmark-new-k${K}.json"
echo "  /tmp/e2e-benchmark-old-output.txt"
echo "  /tmp/e2e-benchmark-new-output.txt"
echo "  /tmp/server-old.log"
echo "  /tmp/server-new.log"
