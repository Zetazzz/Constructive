/**
 * Performance Benchmark: Multi-Tenancy Cache vs Graphile Cache
 *
 * Follows the methodology from:
 *   Prompts-collection/constructive/graphql-server/perf/find-graphile-cache-potential-leak.md
 *
 * Phases:
 *   Phase 1: Baseline — measure single-tenant build time and memory
 *   Phase 2: Scale — create N tenants, measure shared vs dedicated instances
 *   Phase 3: Concurrent pressure — simulate concurrent requests across tenants
 *   Phase 4: Idle observation — measure memory after load
 *   Phase 5: Analysis — compare metrics
 *
 * Usage:
 *   cd graphile/graphile-multi-tenancy-cache
 *   PGDATABASE=constructive ts-node src/benchmark.ts
 */

import { Pool } from 'pg';
import { Logger } from '@pgpmjs/logger';
import { getPgEnvOptions } from 'pg-env';
import { makePgService } from 'postgraphile/adaptors/pg';
import { PostGraphileAmberPreset } from 'postgraphile/presets/amber';
import type { GraphileConfig } from 'graphile-config';
import {
  getOrCreateTenantInstance,
  getMultiTenancyCacheStats,
  shutdownMultiTenancyCache,
} from './multi-tenancy-cache';
import type { TenantInstance } from './multi-tenancy-cache';
import { getSchemaFingerprint } from './fingerprint';
import { fetchAndParseIntrospection } from './introspection';

const log = new Logger('benchmark');

// =============================================================================
// Configuration
// =============================================================================

const TENANT_COUNT = parseInt(process.env.BENCHMARK_TENANTS || '10', 10);
const CONCURRENT_REQUESTS = parseInt(process.env.BENCHMARK_CONCURRENCY || '4', 10);
const PRESSURE_DURATION_MS = parseInt(process.env.BENCHMARK_PRESSURE_MS || '30000', 10);
const IDLE_OBSERVATION_MS = parseInt(process.env.BENCHMARK_IDLE_MS || '10000', 10);

interface BenchmarkResult {
  phase: string;
  metric: string;
  value: number;
  unit: string;
}

const results: BenchmarkResult[] = [];

function record(phase: string, metric: string, value: number, unit: string): void {
  results.push({ phase, metric, value, unit });
  log.info(`  [${phase}] ${metric}: ${value.toFixed(2)} ${unit}`);
}

function getMemoryMb(): { heapUsedMb: number; rssMb: number; externalMb: number } {
  const mem = process.memoryUsage();
  return {
    heapUsedMb: mem.heapUsed / 1024 / 1024,
    rssMb: mem.rss / 1024 / 1024,
    externalMb: mem.external / 1024 / 1024,
  };
}

// =============================================================================
// Schema Setup
// =============================================================================

async function setupBenchmarkSchemas(pool: Pool, count: number): Promise<string[]> {
  const schemas: string[] = [];
  const client = await pool.connect();

  try {
    for (let i = 0; i < count; i++) {
      const schema = `bench_tenant_${i}`;
      schemas.push(schema);

      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.query(`CREATE SCHEMA "${schema}"`);

      // Create identical table structures across all tenants
      await client.query(`
        CREATE TABLE "${schema}".users (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          display_name text NOT NULL,
          email text UNIQUE NOT NULL,
          status text NOT NULL DEFAULT 'active',
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
          view_count integer NOT NULL DEFAULT 0,
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

      await client.query(`
        CREATE TABLE "${schema}".tags (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          name text UNIQUE NOT NULL
        )
      `);

      await client.query(`
        CREATE TABLE "${schema}".post_tags (
          post_id uuid NOT NULL REFERENCES "${schema}".posts(id),
          tag_id uuid NOT NULL REFERENCES "${schema}".tags(id),
          PRIMARY KEY (post_id, tag_id)
        )
      `);

      // Grant access
      await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO administrator`);
      await client.query(`GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO administrator`);

      // Insert sample data
      await client.query(`
        INSERT INTO "${schema}".users (display_name, email)
        VALUES ('Tenant ${i} User', 'user@tenant${i}.example.com')
      `);
    }

    log.info(`Created ${count} benchmark tenant schemas`);
  } finally {
    client.release();
  }

  return schemas;
}

async function cleanupBenchmarkSchemas(pool: Pool, schemas: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    for (const schema of schemas) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    log.info(`Cleaned up ${schemas.length} benchmark schemas`);
  } finally {
    client.release();
  }
}

// =============================================================================
// Preset Builder
// =============================================================================

function buildBenchPreset(
  pool: Pool,
  schemas: string[],
  _anonRole: string,
  _roleName: string,
): GraphileConfig.Preset {
  return {
    extends: [PostGraphileAmberPreset],
    pgServices: [
      makePgService({
        pool,
        schemas,
      }),
    ],
    grafserv: {
      graphqlPath: '/graphql',
    },
    grafast: {
      explain: false,
    },
  };
}

// =============================================================================
// Benchmark Phases
// =============================================================================

async function phase1Baseline(pool: Pool, schemas: string[]): Promise<void> {
  log.info('\n' + '='.repeat(80));
  log.info('Phase 1: Baseline — Fingerprinting Consistency');
  log.info('='.repeat(80));

  const fingerprints: string[] = [];

  for (const schema of schemas) {
    const { parsed } = await fetchAndParseIntrospection(pool, [schema]);
    const fp = getSchemaFingerprint(parsed, [schema]);
    fingerprints.push(fp);
  }

  // All fingerprints should be identical
  const allMatch = fingerprints.every((fp) => fp === fingerprints[0]);
  record('baseline', 'fingerprints_match', allMatch ? 1 : 0, 'bool');
  record('baseline', 'unique_fingerprints', new Set(fingerprints).size, 'count');

  if (!allMatch) {
    log.error('FAIL: Not all fingerprints match! Template sharing will not work.');
    return;
  }
  log.info('PASS: All fingerprints match — template sharing is possible');
}

async function phase2Scale(
  pool: Pool,
  schemas: string[],
  pgConfig: { database?: string },
): Promise<TenantInstance[]> {
  log.info('\n' + '='.repeat(80));
  log.info(`Phase 2: Scale — Create ${schemas.length} tenant instances`);
  log.info('='.repeat(80));

  const memBefore = getMemoryMb();
  record('scale', 'heap_before_mb', memBefore.heapUsedMb, 'MB');
  record('scale', 'rss_before_mb', memBefore.rssMb, 'MB');

  const instances: TenantInstance[] = [];
  const buildTimes: number[] = [];

  for (let i = 0; i < schemas.length; i++) {
    const schema = schemas[i];
    const start = Date.now();

    const instance = await getOrCreateTenantInstance(
      {
        cacheKey: `bench-${schema}`,
        pool,
        schemas: [schema],
        dbname: pgConfig.database || 'constructive',
        anonRole: 'administrator',
        roleName: 'administrator',
      },
      buildBenchPreset,
    );

    const elapsed = Date.now() - start;
    buildTimes.push(elapsed);
    instances.push(instance);

    log.info(`  Tenant ${i}: ${elapsed}ms (shared=${instance.isShared})`);
  }

  const memAfter = getMemoryMb();

  record('scale', 'heap_after_mb', memAfter.heapUsedMb, 'MB');
  record('scale', 'rss_after_mb', memAfter.rssMb, 'MB');
  record('scale', 'heap_delta_mb', memAfter.heapUsedMb - memBefore.heapUsedMb, 'MB');
  record('scale', 'rss_delta_mb', memAfter.rssMb - memBefore.rssMb, 'MB');

  // Build time analysis
  const firstBuild = buildTimes[0];
  const reuseTimes = buildTimes.slice(1);
  const avgReuse = reuseTimes.reduce((a, b) => a + b, 0) / reuseTimes.length;

  record('scale', 'first_build_ms', firstBuild, 'ms');
  record('scale', 'avg_reuse_ms', avgReuse, 'ms');
  record('scale', 'speedup_ratio', firstBuild / Math.max(avgReuse, 1), 'x');

  // Template stats
  const stats = getMultiTenancyCacheStats();
  record('scale', 'template_count', stats.templateCount, 'count');
  record('scale', 'shared_tenants', stats.memorySavings.sharedTenants, 'count');
  record('scale', 'estimated_mb_saved', stats.memorySavings.estimatedMbSaved, 'MB');

  const sharedCount = instances.filter((i) => i.isShared).length;
  record('scale', 'shared_instances', sharedCount, 'count');
  record('scale', 'dedicated_instances', instances.length - sharedCount, 'count');

  return instances;
}

async function phase3Pressure(pool: Pool): Promise<void> {
  log.info('\n' + '='.repeat(80));
  log.info(`Phase 3: Concurrent Pressure — ${CONCURRENT_REQUESTS} workers, ${PRESSURE_DURATION_MS / 1000}s`);
  log.info('='.repeat(80));

  const memBefore = getMemoryMb();
  record('pressure', 'heap_before_mb', memBefore.heapUsedMb, 'MB');

  // Simulate concurrent GraphQL queries via direct DB queries
  // (since we're testing the cache layer, not the full HTTP stack)
  let totalQueries = 0;
  let totalErrors = 0;
  const latencies: number[] = [];

  const startTime = Date.now();
  const endTime = startTime + PRESSURE_DURATION_MS;

  const workers = Array.from({ length: CONCURRENT_REQUESTS }, async (_, workerId) => {
    while (Date.now() < endTime) {
      const tenantIdx = workerId % TENANT_COUNT;
      const schema = `bench_tenant_${tenantIdx}`;
      const queryStart = Date.now();

      try {
        const client = await pool.connect();
        try {
          await client.query(`SELECT * FROM "${schema}".users LIMIT 1`);
          totalQueries++;
          latencies.push(Date.now() - queryStart);
        } finally {
          client.release();
        }
      } catch {
        totalErrors++;
      }
    }
  });

  await Promise.all(workers);

  const elapsed = Date.now() - startTime;
  const memAfter = getMemoryMb();

  record('pressure', 'total_queries', totalQueries, 'count');
  record('pressure', 'total_errors', totalErrors, 'count');
  record('pressure', 'qps', totalQueries / (elapsed / 1000), 'queries/s');

  // Latency percentiles
  latencies.sort((a, b) => a - b);
  if (latencies.length > 0) {
    record('pressure', 'p50_ms', latencies[Math.floor(latencies.length * 0.5)], 'ms');
    record('pressure', 'p95_ms', latencies[Math.floor(latencies.length * 0.95)], 'ms');
    record('pressure', 'p99_ms', latencies[Math.floor(latencies.length * 0.99)], 'ms');
  }

  record('pressure', 'heap_after_mb', memAfter.heapUsedMb, 'MB');
  record('pressure', 'heap_delta_mb', memAfter.heapUsedMb - memBefore.heapUsedMb, 'MB');
}

async function phase4Idle(): Promise<void> {
  log.info('\n' + '='.repeat(80));
  log.info(`Phase 4: Idle Observation — ${IDLE_OBSERVATION_MS / 1000}s`);
  log.info('='.repeat(80));

  const snapshots: { time: number; heapMb: number; rssMb: number }[] = [];
  const startTime = Date.now();

  while (Date.now() - startTime < IDLE_OBSERVATION_MS) {
    const mem = getMemoryMb();
    snapshots.push({
      time: Date.now() - startTime,
      heapMb: mem.heapUsedMb,
      rssMb: mem.rssMb,
    });
    // Force GC if available
    if (global.gc) {
      global.gc();
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const firstSnap = snapshots[0];
  const lastSnap = snapshots[snapshots.length - 1];

  record('idle', 'heap_start_mb', firstSnap.heapMb, 'MB');
  record('idle', 'heap_end_mb', lastSnap.heapMb, 'MB');
  record('idle', 'heap_trend_mb', lastSnap.heapMb - firstSnap.heapMb, 'MB');
  record('idle', 'rss_start_mb', firstSnap.rssMb, 'MB');
  record('idle', 'rss_end_mb', lastSnap.rssMb, 'MB');

  // Check acceptance criteria: idle tail heap trend should not be >5% sustained
  const heapTrendPct = ((lastSnap.heapMb - firstSnap.heapMb) / firstSnap.heapMb) * 100;
  record('idle', 'heap_trend_pct', heapTrendPct, '%');

  if (Math.abs(heapTrendPct) < 5) {
    log.info('PASS: Heap trend within acceptable range (<5%)');
  } else {
    log.warn(`WARN: Heap trend ${heapTrendPct.toFixed(1)}% exceeds 5% threshold`);
  }
}

async function phase5Analysis(): Promise<void> {
  log.info('\n' + '='.repeat(80));
  log.info('Phase 5: Analysis Summary');
  log.info('='.repeat(80));

  log.info('\n--- Full Results ---');
  log.info(
    ['Phase', 'Metric', 'Value', 'Unit']
      .map((h) => h.padEnd(25))
      .join(' | '),
  );
  log.info('-'.repeat(110));

  for (const r of results) {
    log.info(
      [r.phase.padEnd(25), r.metric.padEnd(25), r.value.toFixed(2).padStart(12), r.unit.padEnd(15)]
        .join(' | '),
    );
  }

  // Key takeaways
  log.info('\n--- Key Findings ---');

  const templateCount = results.find((r) => r.metric === 'template_count')?.value || 0;
  const sharedTenants = results.find((r) => r.metric === 'shared_tenants')?.value || 0;
  const firstBuild = results.find((r) => r.metric === 'first_build_ms')?.value || 0;
  const avgReuse = results.find((r) => r.metric === 'avg_reuse_ms')?.value || 0;
  const heapDelta = results.find((r) => r.phase === 'scale' && r.metric === 'heap_delta_mb')?.value || 0;
  const savedMb = results.find((r) => r.metric === 'estimated_mb_saved')?.value || 0;

  log.info(`Templates created: ${templateCount} (for ${TENANT_COUNT} tenants)`);
  log.info(`Tenants sharing templates: ${sharedTenants}`);
  log.info(`First build: ${firstBuild.toFixed(0)}ms, Average reuse: ${avgReuse.toFixed(0)}ms`);
  log.info(`Heap growth for ${TENANT_COUNT} tenants: ${heapDelta.toFixed(1)}MB`);
  log.info(`Estimated memory saved: ~${savedMb.toFixed(0)}MB`);
  log.info(`Without multi-tenancy: ~${(TENANT_COUNT * 50).toFixed(0)}MB (${TENANT_COUNT} * 50MB)`);
  log.info(`With multi-tenancy: ~${(templateCount * 50).toFixed(0)}MB (${templateCount} * 50MB)`);
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

  log.info('='.repeat(80));
  log.info('Multi-Tenancy Cache Benchmark');
  log.info(`Tenants: ${TENANT_COUNT}, Concurrency: ${CONCURRENT_REQUESTS}`);
  log.info('='.repeat(80));

  let schemas: string[] = [];

  try {
    // Setup
    schemas = await setupBenchmarkSchemas(pool, TENANT_COUNT);

    // Run phases
    await phase1Baseline(pool, schemas);
    await phase2Scale(pool, schemas, pgConfig);
    await phase3Pressure(pool);
    await phase4Idle();
    await phase5Analysis();

  } catch (err) {
    log.error('Benchmark failed:', err);
    throw err;
  } finally {
    await shutdownMultiTenancyCache();
    if (schemas.length > 0) {
      await cleanupBenchmarkSchemas(pool, schemas);
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
