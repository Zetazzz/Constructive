/**
 * Multi-Tenancy Cache Demo Script
 *
 * Demonstrates the template-based multi-tenancy approach with crystal-level
 * dynamic SQL identifiers:
 *
 * 1. Initialize Instance A (Schemas: t_1_app, t_1_perf) -> Performs full build
 *    with `pgIdentifiers: "dynamic"` so SQL contains opaque schema placeholders.
 * 2. Initialize Instance B (Schemas: t_2_app, t_2_perf, identical structure)
 *    -> Skips build, reuses A's registry + gets a sqlTextTransform.
 * 3. Verify the sqlTextTransform correctly rewrites placeholders to t_2_app
 *    and t_2_perf.
 *
 * This demonstrates the multi-schema-per-tenant case where both schemas have
 * tables with the same name (e.g., both t_1_app.users and t_1_perf.users).
 *
 * Prerequisites:
 * - PostgreSQL running with the constructive database deployed
 *
 * Usage:
 *   cd graphile/graphile-multi-tenancy-cache
 *   PGDATABASE=constructive ts-node src/demo.ts
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
import { getSchemaFingerprint } from './fingerprint';
import { fetchAndParseIntrospection } from './introspection';
import { buildSchemaRemapTransform, buildSchemaMap, wrapSchemaPlaceholder } from './dynamic-schema';

const log = new Logger('demo');

// =============================================================================
// Demo: Setup multi-schema tenant schemas
// =============================================================================

async function setupDemoSchemas(
  pool: Pool,
): Promise<{
  tenant1Schemas: string[];
  tenant2Schemas: string[];
}> {
  const tenant1Schemas = ['t_1_app', 't_1_perf'];
  const tenant2Schemas = ['t_2_app', 't_2_perf'];

  log.info('Setting up demo tenant schemas (multi-schema per tenant)...');

  const client = await pool.connect();
  try {
    for (const schemas of [tenant1Schemas, tenant2Schemas]) {
      for (const schema of schemas) {
        await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await client.query(`CREATE SCHEMA "${schema}"`);

        // Each schema has a "users" table — demonstrating the overlapping-name case
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

        // Grant access
        await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO administrator`);
        await client.query(`GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO administrator`);

        log.info(`  Created schema "${schema}" with users, posts tables`);
      }
    }

    // Insert test data
    for (const schemas of [tenant1Schemas, tenant2Schemas]) {
      for (const schema of schemas) {
        await client.query(`
          INSERT INTO "${schema}".users (display_name, email)
          VALUES ('User from ${schema}', '${schema}@example.com')
        `);
      }
    }

    log.info('Demo schemas created successfully');
  } finally {
    client.release();
  }

  return { tenant1Schemas, tenant2Schemas };
}

async function cleanupDemoSchemas(pool: Pool, schemas: string[]): Promise<void> {
  const client = await pool.connect();
  try {
    for (const schema of schemas) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
    log.info('Demo schemas cleaned up');
  } finally {
    client.release();
  }
}

// =============================================================================
// Demo: Build a preset with pgIdentifiers: "dynamic"
// =============================================================================

function buildDemoPreset(
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
    gather: {
      // CRITICAL: "dynamic" mode wraps schema names in opaque placeholders
      // so they can be remapped per-tenant at execution time.
      // Note: requires crystal PR (Zetazzz/crystal#5) for the "dynamic" type
      pgIdentifiers: 'dynamic' as 'qualified',
    },
    grafserv: {
      graphqlPath: '/graphql',
      graphiqlPath: '/graphiql',
      graphiql: true,
    },
    grafast: {
      explain: true,
    },
  };
}

// =============================================================================
// Main Demo
// =============================================================================

async function main(): Promise<void> {
  const pgConfig = getPgEnvOptions({});
  const pool = new Pool({
    host: pgConfig.host || 'localhost',
    port: pgConfig.port || 5432,
    user: pgConfig.user || 'postgres',
    password: pgConfig.password || 'password',
    database: pgConfig.database || 'constructive',
  });

  log.info('='.repeat(80));
  log.info('Multi-Tenancy Cache Demo (Multi-Schema + Dynamic Identifiers)');
  log.info('='.repeat(80));

  let allSchemas: string[] = [];

  try {
    // Step 1: Setup demo schemas
    log.info('\n--- Step 1: Setup Multi-Schema Tenants ---');
    const { tenant1Schemas, tenant2Schemas } = await setupDemoSchemas(pool);
    allSchemas = [...tenant1Schemas, ...tenant2Schemas];

    log.info(`Tenant 1 schemas: ${tenant1Schemas.join(', ')}`);
    log.info(`Tenant 2 schemas: ${tenant2Schemas.join(', ')}`);
    log.info('Both have "users" and "posts" tables in each schema (overlapping names)');

    // Step 2: Fingerprint both tenants
    log.info('\n--- Step 2: Fingerprinting ---');
    const result1 = await fetchAndParseIntrospection(pool, tenant1Schemas);
    const result2 = await fetchAndParseIntrospection(pool, tenant2Schemas);

    const fingerprint1 = getSchemaFingerprint(result1.parsed, tenant1Schemas);
    const fingerprint2 = getSchemaFingerprint(result2.parsed, tenant2Schemas);

    log.info(`Tenant 1 fingerprint: ${fingerprint1.substring(0, 32)}...`);
    log.info(`Tenant 2 fingerprint: ${fingerprint2.substring(0, 32)}...`);
    log.info(`Fingerprints match: ${fingerprint1 === fingerprint2}`);

    if (fingerprint1 !== fingerprint2) {
      log.error('FAIL: Fingerprints should match for structurally identical schemas!');
      process.exit(1);
    }
    log.info('PASS: Identical schema structures produce the same fingerprint');

    // Step 3: Initialize Tenant 1 (full build with dynamic identifiers)
    log.info('\n--- Step 3: Initialize Tenant 1 (full build, pgIdentifiers=dynamic) ---');
    const start1 = Date.now();
    const instance1 = await getOrCreateTenantInstance(
      {
        cacheKey: 'demo-tenant-1',
        pool,
        schemas: tenant1Schemas,
        dbname: pgConfig.database || 'constructive',
        anonRole: 'administrator',
        roleName: 'administrator',
      },
      buildDemoPreset,
    );
    const time1 = Date.now() - start1;
    log.info(`Tenant 1: isShared=${instance1.isShared}, time=${time1}ms`);

    // Step 4: Initialize Tenant 2 (should reuse Tenant 1's template)
    log.info('\n--- Step 4: Initialize Tenant 2 (should reuse template) ---');
    const start2 = Date.now();
    const instance2 = await getOrCreateTenantInstance(
      {
        cacheKey: 'demo-tenant-2',
        pool,
        schemas: tenant2Schemas,
        dbname: pgConfig.database || 'constructive',
        anonRole: 'administrator',
        roleName: 'administrator',
      },
      buildDemoPreset,
    );
    const time2 = Date.now() - start2;
    log.info(`Tenant 2: isShared=${instance2.isShared}, time=${time2}ms`);

    if (instance2.isShared) {
      log.info(`PASS: Tenant 2 reused Tenant 1's template! (${time1}ms -> ${time2}ms)`);
      log.info(`Speedup: ${(time1 / Math.max(time2, 1)).toFixed(1)}x`);
    } else {
      log.info('INFO: Tenant 2 created its own instance (first tenant for this fingerprint)');
    }

    // Step 5: Verify SQL text transformation
    log.info('\n--- Step 5: Verify Dynamic SQL Identifier Transformation ---');

    // Simulate SQL that PostGraphile would generate with dynamic mode
    const p1 = wrapSchemaPlaceholder('t_1_app');
    const p2 = wrapSchemaPlaceholder('t_1_perf');
    const templateSql = `SELECT * FROM "${p1}"."users" u JOIN "${p2}"."users" p ON u.id = p.id`;
    log.info(`Template SQL (with placeholders):`);
    log.info(`  ${templateSql}`);

    // Tenant 1's transform: should map t_1_app -> t_1_app, t_1_perf -> t_1_perf (identity)
    if (instance1.sqlTextTransform) {
      const transformedSql1 = instance1.sqlTextTransform(templateSql);
      log.info(`Tenant 1 transformed SQL:`);
      log.info(`  ${transformedSql1}`);

      if (transformedSql1.includes('"t_1_app"') && transformedSql1.includes('"t_1_perf"')) {
        log.info('PASS: Tenant 1 SQL correctly points to t_1_app and t_1_perf');
      } else {
        log.error('FAIL: Tenant 1 SQL does not contain expected schema names!');
      }
    }

    // Tenant 2's transform: should map t_1_app -> t_2_app, t_1_perf -> t_2_perf
    if (instance2.sqlTextTransform) {
      const transformedSql2 = instance2.sqlTextTransform(templateSql);
      log.info(`Tenant 2 transformed SQL:`);
      log.info(`  ${transformedSql2}`);

      if (transformedSql2.includes('"t_2_app"') && transformedSql2.includes('"t_2_perf"')) {
        log.info('PASS: Tenant 2 SQL correctly points to t_2_app and t_2_perf');
      } else {
        log.error('FAIL: Tenant 2 SQL does not contain expected schema names!');
        log.error(`Expected "t_2_app" and "t_2_perf" in: ${transformedSql2}`);
      }

      // Verify the original tenant 1 schemas are NOT present
      if (!transformedSql2.includes('"t_1_app"') && !transformedSql2.includes('"t_1_perf"')) {
        log.info('PASS: Tenant 2 SQL does NOT contain Tenant 1 schema names');
      } else {
        log.error('FAIL: Tenant 2 SQL still contains Tenant 1 schema names!');
      }
    }

    // Step 6: Show cache statistics
    log.info('\n--- Step 6: Cache Statistics ---');
    const stats = getMultiTenancyCacheStats();
    log.info(`Templates: ${stats.templateCount}`);
    log.info(`Tenants: ${stats.tenantCount}`);
    log.info(`Shared tenants: ${stats.memorySavings.sharedTenants}`);
    log.info(`Estimated memory saved: ~${stats.memorySavings.estimatedMbSaved}MB`);

    for (const t of stats.templates) {
      log.info(`  Template ${t.fingerprint.substring(0, 16)}...: refCount=${t.refCount}, schemas=${t.templateSchemas.join(',')}`);
    }

    // Step 7: Memory comparison
    log.info('\n--- Step 7: Memory Comparison ---');
    const memUsage = process.memoryUsage();
    log.info(`Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    log.info(`RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
    log.info(`External: ${(memUsage.external / 1024 / 1024).toFixed(2)} MB`);

    log.info('\n' + '='.repeat(80));
    log.info('Demo completed successfully!');
    log.info('='.repeat(80));

  } catch (err) {
    log.error('Demo failed:', err);
    throw err;
  } finally {
    // Cleanup
    await shutdownMultiTenancyCache();
    if (allSchemas.length > 0) {
      await cleanupDemoSchemas(pool, allSchemas);
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
