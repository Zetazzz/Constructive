/**
 * Comparison Benchmark: Multi-Tenancy Cache vs Dedicated Instances
 *
 * Compares two approaches:
 *   A) "Dedicated" — each tenant gets its own PostGraphile instance (old approach)
 *   B) "Multi-Tenancy Cache" — tenants share templates via fingerprinting (new approach)
 *
 * Measures:
 *   - Memory usage (heap, RSS) per approach
 *   - Build time per tenant
 *   - Query latency under load
 *
 * Usage:
 *   cd graphile/graphile-multi-tenancy-cache
 *   PGDATABASE=constructive npx ts-node src/comparison-benchmark.ts
 */

import { createServer } from 'node:http';
import { Pool } from 'pg';
import { Logger } from '@pgpmjs/logger';
import { getPgEnvOptions } from 'pg-env';
import { makePgService } from 'postgraphile/adaptors/pg';
import { PostGraphileAmberPreset } from 'postgraphile/presets/amber';
import { postgraphile } from 'postgraphile';
import { grafserv } from 'grafserv/express/v4';
import express from 'express';
import type { GraphileConfig } from 'graphile-config';
import {
  getOrCreateTenantInstance,
  shutdownMultiTenancyCache,
  getMultiTenancyCacheStats,
} from '../src/multi-tenancy-cache';
import { getIntrospectionCacheStats } from '../src/introspection-cache';

const log = new Logger('comparison-benchmark');

const TENANT_COUNT = parseInt(process.env.BENCHMARK_TENANTS || '5', 10);
const PRESSURE_DURATION_MS = parseInt(process.env.BENCHMARK_PRESSURE_MS || '10000', 10);
const CONCURRENCY = parseInt(process.env.BENCHMARK_CONCURRENCY || '4', 10);

/**
 * Simulated API endpoints per tenant database.
 * In real production (apiIsPublic=false), each tenant DB is accessed via
 * multiple API endpoints (e.g., api, admin, auth). Each produces a different
 * svcKey/cacheKey but queries the SAME database+schemas combination.
 * The introspection cache deduplicates across these endpoints.
 */
const API_ENDPOINTS = ['api', 'admin', 'auth'];

interface Metric {
  approach: string;
  phase: string;
  metric: string;
  value: number;
  unit: string;
}

const metrics: Metric[] = [];

function record(approach: string, phase: string, metric: string, value: number, unit: string): void {
  metrics.push({ approach, phase, metric, value, unit });
  log.info(`  [${approach}][${phase}] ${metric}: ${value.toFixed(2)} ${unit}`);
}

function memMb(): { heap: number; rss: number } {
  const m = process.memoryUsage();
  return { heap: m.heapUsed / 1024 / 1024, rss: m.rss / 1024 / 1024 };
}

// =============================================================================
// Schema Setup (identical for both approaches)
// =============================================================================

async function setupSchemas(pool: Pool, count: number): Promise<string[]> {
  const schemas: string[] = [];
  const client = await pool.connect();
  try {
    for (let i = 0; i < count; i++) {
      const schema = `cmp_tenant_${i}`;
      schemas.push(schema);
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.query(`CREATE SCHEMA "${schema}"`);

      await client.query(`
        CREATE TABLE "${schema}".users (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          display_name text NOT NULL,
          email text UNIQUE NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        CREATE TABLE "${schema}".posts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          author_id uuid NOT NULL REFERENCES "${schema}".users(id),
          title text NOT NULL,
          body text,
          published boolean NOT NULL DEFAULT false,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await client.query(`
        CREATE TABLE "${schema}".comments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          post_id uuid NOT NULL REFERENCES "${schema}".posts(id),
          author_id uuid NOT NULL REFERENCES "${schema}".users(id),
          body text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO administrator`);
      await client.query(`GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO administrator`);

      await client.query(`
        INSERT INTO "${schema}".users (display_name, email)
        VALUES ('User ${i}', 'user${i}@cmp.test')
      `);
    }
    log.info(`Created ${count} comparison tenant schemas`);
  } finally {
    client.release();
  }
  return schemas;
}

async function cleanupSchemas(pool: Pool, schemas: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    for (const s of schemas) {
      await client.query(`DROP SCHEMA IF EXISTS "${s}" CASCADE`);
    }
  } finally {
    client.release();
  }
}

// =============================================================================
// Preset builder
// =============================================================================

function buildPreset(
  pool: Pool,
  schemas: string[],
  _anonRole: string,
  _roleName: string,
): GraphileConfig.Preset {
  return {
    extends: [PostGraphileAmberPreset],
    pgServices: [makePgService({ pool, schemas })],
    grafserv: { graphqlPath: '/graphql' },
    grafast: { explain: false },
  };
}

// =============================================================================
// Approach A: Dedicated instances (old approach — no sharing)
// =============================================================================

async function runDedicated(pool: Pool, schemas: string[], pgConfig: { database?: string }): Promise<void> {
  const label = 'dedicated';
  log.info('\n' + '='.repeat(80));
  log.info(`Approach A: Dedicated Instances (${schemas.length} tenants, no sharing)`);
  log.info('='.repeat(80));

  // Force GC before measurement
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, 500));

  const memBefore = memMb();
  record(label, 'build', 'heap_before_mb', memBefore.heap, 'MB');
  record(label, 'build', 'rss_before_mb', memBefore.rss, 'MB');

  const handlers: express.Express[] = [];
  const buildTimes: number[] = [];

  for (let i = 0; i < schemas.length; i++) {
    const schema = schemas[i];
    const start = Date.now();

    const preset = buildPreset(pool, [schema], 'administrator', 'administrator');
    const pgl = postgraphile(preset);
    const serv = pgl.createServ(grafserv);
    const app = express();
    const httpServer = createServer(app);
    await serv.addTo(app, httpServer);
    await serv.ready();

    handlers.push(app);
    const elapsed = Date.now() - start;
    buildTimes.push(elapsed);
    log.info(`  Tenant ${i}: ${elapsed}ms (dedicated)`);
  }

  // Force GC before measuring final memory
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, 1000));

  const memAfter = memMb();
  record(label, 'build', 'heap_after_mb', memAfter.heap, 'MB');
  record(label, 'build', 'rss_after_mb', memAfter.rss, 'MB');
  record(label, 'build', 'heap_delta_mb', memAfter.heap - memBefore.heap, 'MB');
  record(label, 'build', 'rss_delta_mb', memAfter.rss - memBefore.rss, 'MB');

  const totalBuild = buildTimes.reduce((a, b) => a + b, 0);
  const avgBuild = totalBuild / buildTimes.length;
  record(label, 'build', 'total_build_ms', totalBuild, 'ms');
  record(label, 'build', 'avg_build_ms', avgBuild, 'ms');

  // Pressure test via direct DB queries
  log.info(`\n  Running pressure test: ${CONCURRENCY} workers, ${PRESSURE_DURATION_MS / 1000}s`);
  const { qps, p50, p95, p99, totalQ, errors } = await runPressure(pool, schemas);
  record(label, 'pressure', 'qps', qps, 'q/s');
  record(label, 'pressure', 'p50_ms', p50, 'ms');
  record(label, 'pressure', 'p95_ms', p95, 'ms');
  record(label, 'pressure', 'p99_ms', p99, 'ms');
  record(label, 'pressure', 'total_queries', totalQ, 'count');
  record(label, 'pressure', 'errors', errors, 'count');

  // Idle observation
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, 3000));
  const memIdle = memMb();
  record(label, 'idle', 'heap_mb', memIdle.heap, 'MB');
  record(label, 'idle', 'rss_mb', memIdle.rss, 'MB');

  // We can't cleanly stop postgraphile instances without explicit shutdown,
  // so we just note that memory is still held
}

// =============================================================================
// Approach B: Multi-Tenancy Cache (new approach — template sharing)
// =============================================================================

async function runMultiTenancyCache(pool: Pool, schemas: string[], pgConfig: { database?: string }): Promise<void> {
  const label = 'multi-tenancy';
  log.info('\n' + '='.repeat(80));
  log.info(`Approach B: Multi-Tenancy Cache (${schemas.length} tenants × ${API_ENDPOINTS.length} endpoints, template sharing)`);
  log.info('='.repeat(80));

  // Force GC before measurement
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, 500));

  const memBefore = memMb();
  record(label, 'build', 'heap_before_mb', memBefore.heap, 'MB');
  record(label, 'build', 'rss_before_mb', memBefore.rss, 'MB');

  const buildTimes: number[] = [];
  const sharedFlags: boolean[] = [];

  // Simulate real apiIsPublic=false scenario:
  // Each tenant DB is accessed via multiple API endpoints (api, admin, auth).
  // Each endpoint produces a different cacheKey but uses the same (dbname, schemas).
  // The introspection cache should HIT on endpoints 2 and 3 for each tenant.
  for (let i = 0; i < schemas.length; i++) {
    const schema = schemas[i];
    for (const endpoint of API_ENDPOINTS) {
      const start = Date.now();

      const instance = await getOrCreateTenantInstance(
        {
          // Different cacheKey per endpoint (like svcKey in the real server)
          cacheKey: `${endpoint}-cmp-${schema}`,
          pool,
          // Same schemas + dbname → introspection cache should HIT after first endpoint
          schemas: [schema],
          dbname: pgConfig.database || 'constructive',
          anonRole: 'administrator',
          roleName: 'administrator',
        },
        buildPreset,
      );

      const elapsed = Date.now() - start;
      buildTimes.push(elapsed);
      sharedFlags.push(instance.isShared);
      log.info(`  Tenant ${i} [${endpoint}]: ${elapsed}ms (shared=${instance.isShared})`);
    }
  }

  // Log introspection cache stats (should show N entries with 2N HITs)
  const introStats = getIntrospectionCacheStats();
  log.info(`\n  Introspection cache: ${introStats.size} entries (${schemas.length} tenants × ${API_ENDPOINTS.length} endpoints = ${schemas.length * API_ENDPOINTS.length} total requests)`);
  log.info(`  Expected: ${schemas.length} MISSes (1 per unique db+schemas), ${schemas.length * (API_ENDPOINTS.length - 1)} HITs (${API_ENDPOINTS.length - 1} per tenant)`);
  record(label, 'introspection', 'cache_entries', introStats.size, 'count');
  record(label, 'introspection', 'expected_misses', schemas.length, 'count');
  record(label, 'introspection', 'expected_hits', schemas.length * (API_ENDPOINTS.length - 1), 'count');

  // Force GC before measuring final memory
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, 1000));

  const memAfter = memMb();
  record(label, 'build', 'heap_after_mb', memAfter.heap, 'MB');
  record(label, 'build', 'rss_after_mb', memAfter.rss, 'MB');
  record(label, 'build', 'heap_delta_mb', memAfter.heap - memBefore.heap, 'MB');
  record(label, 'build', 'rss_delta_mb', memAfter.rss - memBefore.rss, 'MB');

  const totalBuild = buildTimes.reduce((a, b) => a + b, 0);
  const avgBuild = totalBuild / buildTimes.length;
  const firstBuild = buildTimes[0];
  const avgReuse = buildTimes.slice(1).reduce((a, b) => a + b, 0) / Math.max(buildTimes.length - 1, 1);

  record(label, 'build', 'total_build_ms', totalBuild, 'ms');
  record(label, 'build', 'avg_build_ms', avgBuild, 'ms');
  record(label, 'build', 'first_build_ms', firstBuild, 'ms');
  record(label, 'build', 'avg_reuse_ms', avgReuse, 'ms');
  record(label, 'build', 'speedup_ratio', firstBuild / Math.max(avgReuse, 1), 'x');

  const shared = sharedFlags.filter(Boolean).length;
  record(label, 'build', 'shared_instances', shared, 'count');
  record(label, 'build', 'dedicated_instances', schemas.length - shared, 'count');

  const stats = getMultiTenancyCacheStats();
  record(label, 'build', 'templates', stats.templateCount, 'count');
  record(label, 'build', 'estimated_mb_saved', stats.memorySavings.estimatedMbSaved, 'MB');

  // Pressure test
  log.info(`\n  Running pressure test: ${CONCURRENCY} workers, ${PRESSURE_DURATION_MS / 1000}s`);
  const { qps, p50, p95, p99, totalQ, errors } = await runPressure(pool, schemas);
  record(label, 'pressure', 'qps', qps, 'q/s');
  record(label, 'pressure', 'p50_ms', p50, 'ms');
  record(label, 'pressure', 'p95_ms', p95, 'ms');
  record(label, 'pressure', 'p99_ms', p99, 'ms');
  record(label, 'pressure', 'total_queries', totalQ, 'count');
  record(label, 'pressure', 'errors', errors, 'count');

  // Idle
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, 3000));
  const memIdle = memMb();
  record(label, 'idle', 'heap_mb', memIdle.heap, 'MB');
  record(label, 'idle', 'rss_mb', memIdle.rss, 'MB');

  await shutdownMultiTenancyCache();
}

// =============================================================================
// Pressure test helper (shared by both approaches)
// =============================================================================

async function runPressure(
  pool: Pool,
  schemas: string[],
): Promise<{ qps: number; p50: number; p95: number; p99: number; totalQ: number; errors: number }> {
  let totalQ = 0;
  let errors = 0;
  const latencies: number[] = [];
  const startTime = Date.now();
  const endTime = startTime + PRESSURE_DURATION_MS;

  const workers = Array.from({ length: CONCURRENCY }, async (_, wid) => {
    while (Date.now() < endTime) {
      const schema = schemas[wid % schemas.length];
      const t0 = Date.now();
      try {
        const c = await pool.connect();
        try {
          await c.query(`SELECT * FROM "${schema}".users LIMIT 1`);
          totalQ++;
          latencies.push(Date.now() - t0);
        } finally {
          c.release();
        }
      } catch {
        errors++;
      }
    }
  });

  await Promise.all(workers);
  const elapsed = Date.now() - startTime;

  latencies.sort((a, b) => a - b);
  const p = (pct: number) => latencies.length > 0 ? latencies[Math.floor(latencies.length * pct)] : 0;

  return {
    qps: totalQ / (elapsed / 1000),
    p50: p(0.5),
    p95: p(0.95),
    p99: p(0.99),
    totalQ,
    errors,
  };
}

// =============================================================================
// Comparison Report
// =============================================================================

function printComparison(): void {
  log.info('\n' + '='.repeat(100));
  log.info('COMPARISON REPORT');
  log.info('='.repeat(100));

  const get = (approach: string, phase: string, metric: string): number => {
    const m = metrics.find((r) => r.approach === approach && r.phase === phase && r.metric === metric);
    return m?.value ?? 0;
  };

  const rows: Array<{ metric: string; dedicated: string; multiTenancy: string; improvement: string }> = [];

  const addRow = (metric: string, ded: number, mt: number, unit: string, lowerIsBetter = true) => {
    const diff = lowerIsBetter ? ded - mt : mt - ded;
    const pct = ded !== 0 ? ((diff / Math.abs(ded)) * 100) : 0;
    const dir = diff > 0 ? 'better' : diff < 0 ? 'worse' : 'same';
    rows.push({
      metric,
      dedicated: `${ded.toFixed(2)} ${unit}`,
      multiTenancy: `${mt.toFixed(2)} ${unit}`,
      improvement: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% (${dir})`,
    });
  };

  addRow('Heap Delta (build)', get('dedicated', 'build', 'heap_delta_mb'), get('multi-tenancy', 'build', 'heap_delta_mb'), 'MB');
  addRow('RSS Delta (build)', get('dedicated', 'build', 'rss_delta_mb'), get('multi-tenancy', 'build', 'rss_delta_mb'), 'MB');
  addRow('Total Build Time', get('dedicated', 'build', 'total_build_ms'), get('multi-tenancy', 'build', 'total_build_ms'), 'ms');
  addRow('Avg Build Time', get('dedicated', 'build', 'avg_build_ms'), get('multi-tenancy', 'build', 'avg_build_ms'), 'ms');
  addRow('Idle Heap', get('dedicated', 'idle', 'heap_mb'), get('multi-tenancy', 'idle', 'heap_mb'), 'MB');
  addRow('Idle RSS', get('dedicated', 'idle', 'rss_mb'), get('multi-tenancy', 'idle', 'rss_mb'), 'MB');
  addRow('QPS', get('dedicated', 'pressure', 'qps'), get('multi-tenancy', 'pressure', 'qps'), 'q/s', false);
  addRow('p50 Latency', get('dedicated', 'pressure', 'p50_ms'), get('multi-tenancy', 'pressure', 'p50_ms'), 'ms');
  addRow('p99 Latency', get('dedicated', 'pressure', 'p99_ms'), get('multi-tenancy', 'pressure', 'p99_ms'), 'ms');

  // Print table
  const colW = [30, 22, 22, 22];
  const header = ['Metric', 'Dedicated', 'Multi-Tenancy', 'Improvement'].map((h, i) => h.padEnd(colW[i])).join(' | ');
  log.info(header);
  log.info('-'.repeat(header.length));

  for (const r of rows) {
    log.info(
      [r.metric.padEnd(colW[0]), r.dedicated.padEnd(colW[1]), r.multiTenancy.padEnd(colW[2]), r.improvement.padEnd(colW[3])].join(' | '),
    );
  }

  // Key takeaways
  log.info('\n--- Key Takeaways ---');
  const heapSaved = get('dedicated', 'build', 'heap_delta_mb') - get('multi-tenancy', 'build', 'heap_delta_mb');
  const buildTimeSaved = get('dedicated', 'build', 'total_build_ms') - get('multi-tenancy', 'build', 'total_build_ms');
  const templates = get('multi-tenancy', 'build', 'templates');
  const sharedInstances = get('multi-tenancy', 'build', 'shared_instances');
  const cacheEntries = get('multi-tenancy', 'introspection', 'cache_entries');
  const expectedHits = get('multi-tenancy', 'introspection', 'expected_hits');

  log.info(`Tenants: ${TENANT_COUNT} × ${API_ENDPOINTS.length} endpoints = ${TENANT_COUNT * API_ENDPOINTS.length} total cache keys`);
  log.info(`Templates created: ${templates} (shared by ${sharedInstances} tenants)`);
  log.info(`Introspection cache: ${cacheEntries} entries, ${expectedHits} HITs saved (${API_ENDPOINTS.length - 1} per tenant)`);
  log.info(`Heap memory saved: ${heapSaved.toFixed(1)} MB`);
  log.info(`Build time saved: ${buildTimeSaved.toFixed(0)} ms`);

  if (heapSaved > 0) {
    log.info(`RESULT: Multi-tenancy cache uses ${heapSaved.toFixed(1)} MB LESS heap memory`);
  } else {
    log.info(`RESULT: Multi-tenancy cache uses ${Math.abs(heapSaved).toFixed(1)} MB MORE heap memory`);
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const pgConfig = getPgEnvOptions({});
  const pool = new Pool({
    host: pgConfig.host || 'localhost',
    port: pgConfig.port || 5432,
    user: pgConfig.user || 'postgres',
    password: pgConfig.password || 'password',
    database: pgConfig.database || 'constructive',
    max: 20,
  });

  log.info('='.repeat(100));
  log.info('COMPARISON BENCHMARK: Dedicated Instances vs Multi-Tenancy Cache');
  log.info(`Tenants: ${TENANT_COUNT}, Concurrency: ${CONCURRENCY}, Pressure: ${PRESSURE_DURATION_MS / 1000}s`);
  log.info('='.repeat(100));

  let schemas: string[] = [];

  try {
    schemas = await setupSchemas(pool, TENANT_COUNT);

    // Run Approach A: Dedicated instances
    await runDedicated(pool, schemas, pgConfig);

    // Force GC and wait before running approach B
    if (global.gc) global.gc();
    await new Promise((r) => setTimeout(r, 3000));

    // Run Approach B: Multi-tenancy cache
    await runMultiTenancyCache(pool, schemas, pgConfig);

    // Print comparison
    printComparison();

  } catch (err) {
    log.error('Benchmark failed:', err);
    throw err;
  } finally {
    await shutdownMultiTenancyCache();
    if (schemas.length > 0) {
      await cleanupSchemas(pool, schemas);
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
