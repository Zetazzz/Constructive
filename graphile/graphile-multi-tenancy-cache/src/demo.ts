/**
 * Multi-Tenancy Cache Demo Script
 *
 * Demonstrates the template-based multi-tenancy approach:
 *
 * 1. Initialize Instance A (Schema: tenant_a) -> Performs full build
 * 2. Initialize Instance B (Schema: tenant_b, identical structure) -> Skips build, reuses A's registry
 * 3. Execute a query on Instance B and verify the generated SQL correctly points to tenant_b
 *
 * Prerequisites:
 * - PostgreSQL running with the constructive database deployed
 * - Two schemas with identical structure (tenant_a, tenant_b)
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

const log = new Logger('demo');

// =============================================================================
// Demo: Setup tenant schemas, fingerprint, and reuse
// =============================================================================

async function setupDemoSchemas(pool: Pool): Promise<{ schemaA: string; schemaB: string }> {
  const schemaA = 'demo_tenant_a';
  const schemaB = 'demo_tenant_b';

  log.info('Setting up demo tenant schemas...');

  const client = await pool.connect();
  try {
    // Create identical schemas for two tenants
    for (const schema of [schemaA, schemaB]) {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.query(`CREATE SCHEMA "${schema}"`);

      // Create identical table structures
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

      // Grant access to roles
      await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO administrator`);
      await client.query(`GRANT ALL ON ALL TABLES IN SCHEMA "${schema}" TO administrator`);

      log.info(`  Created schema "${schema}" with users, posts, comments tables`);
    }

    // Insert some test data into each schema
    for (const schema of [schemaA, schemaB]) {
      await client.query(`
        INSERT INTO "${schema}".users (display_name, email)
        VALUES ('User from ${schema}', '${schema}@example.com')
      `);
    }

    log.info('Demo schemas created successfully');
  } finally {
    client.release();
  }

  return { schemaA, schemaB };
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
// Demo: Build a preset (mirrors graphql/server/src/middleware/graphile.ts)
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
  log.info('Multi-Tenancy Cache Demo');
  log.info('='.repeat(80));

  let schemaA = '';
  let schemaB = '';

  try {
    // Step 1: Setup demo schemas
    const schemas = await setupDemoSchemas(pool);
    schemaA = schemas.schemaA;
    schemaB = schemas.schemaB;

    // Step 2: Fingerprint both schemas
    log.info('\n--- Step 2: Fingerprinting ---');
    const resultA = await fetchAndParseIntrospection(pool, [schemaA]);
    const resultB = await fetchAndParseIntrospection(pool, [schemaB]);

    const fingerprintA = getSchemaFingerprint(resultA.parsed, [schemaA]);
    const fingerprintB = getSchemaFingerprint(resultB.parsed, [schemaB]);

    log.info(`Tenant A fingerprint: ${fingerprintA.substring(0, 32)}...`);
    log.info(`Tenant B fingerprint: ${fingerprintB.substring(0, 32)}...`);
    log.info(`Fingerprints match: ${fingerprintA === fingerprintB}`);

    if (fingerprintA !== fingerprintB) {
      log.error('FAIL: Fingerprints should match for identical schemas!');
      process.exit(1);
    }
    log.info('PASS: Identical schema structures produce the same fingerprint');

    // Step 3: Initialize Instance A (full build)
    log.info('\n--- Step 3: Initialize Tenant A (full build) ---');
    const startA = Date.now();
    const instanceA = await getOrCreateTenantInstance(
      {
        cacheKey: `demo-${schemaA}`,
        pool,
        schemas: [schemaA],
        dbname: pgConfig.database || 'constructive',
        anonRole: 'administrator',
        roleName: 'administrator',
      },
      buildDemoPreset,
    );
    const timeA = Date.now() - startA;
    log.info(`Tenant A: isShared=${instanceA.isShared}, time=${timeA}ms`);

    // Step 4: Initialize Instance B (should reuse A's template)
    log.info('\n--- Step 4: Initialize Tenant B (should reuse template) ---');
    const startB = Date.now();
    const instanceB = await getOrCreateTenantInstance(
      {
        cacheKey: `demo-${schemaB}`,
        pool,
        schemas: [schemaB],
        dbname: pgConfig.database || 'constructive',
        anonRole: 'administrator',
        roleName: 'administrator',
      },
      buildDemoPreset,
    );
    const timeB = Date.now() - startB;
    log.info(`Tenant B: isShared=${instanceB.isShared}, time=${timeB}ms`);

    if (instanceB.isShared) {
      log.info(`PASS: Tenant B reused Tenant A's template! (${timeA}ms -> ${timeB}ms)`);
      log.info(`Speedup: ${(timeA / Math.max(timeB, 1)).toFixed(1)}x`);
    } else {
      log.info('INFO: Tenant B created its own instance (first tenant for this fingerprint)');
    }

    // Step 5: Show cache statistics
    log.info('\n--- Step 5: Cache Statistics ---');
    const stats = getMultiTenancyCacheStats();
    log.info(`Templates: ${stats.templateCount}`);
    log.info(`Tenants: ${stats.tenantCount}`);
    log.info(`Shared tenants: ${stats.memorySavings.sharedTenants}`);
    log.info(`Estimated memory saved: ~${stats.memorySavings.estimatedMbSaved}MB`);

    for (const t of stats.templates) {
      log.info(`  Template ${t.fingerprint.substring(0, 16)}...: refCount=${t.refCount}, schemas=${t.templateSchemas.join(',')}`);
    }

    // Step 6: Memory comparison
    log.info('\n--- Step 6: Memory Comparison ---');
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
    if (schemaA && schemaB) {
      await cleanupDemoSchemas(pool, [schemaA, schemaB]);
    }
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
