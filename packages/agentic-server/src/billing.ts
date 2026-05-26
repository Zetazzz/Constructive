/**
 * billing — Quota check and usage recording via tenant database
 *
 * Calls the billing functions discovered from billing_module.
 * Gracefully allows requests if billing is not provisioned or errors.
 */

import { Logger } from '@pgpmjs/logger';
import type { BillingConfig, ConstructiveContext, InferenceLogConfig } from '@constructive-io/express-context';

const log = new Logger('agentic-server:billing');

// ─── Quota Check ────────────────────────────────────────────────────────────

export async function checkQuota(
  ctx: ConstructiveContext,
  billing: BillingConfig,
  entityId: string,
  meterSlug: string,
): Promise<boolean> {
  try {
    return await ctx.withPgClient(async (client) => {
      const sql = `SELECT "${billing.privateSchema}"."${billing.checkBillingQuotaFunction}"($1, $2::uuid, $3) AS allowed`;
      const result = await client.query(sql, [meterSlug, entityId, 1]);
      return result.rows[0]?.allowed !== false;
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn(`check_billing_quota failed (allowing): ${message}`);
    return true;
  }
}

// ─── Usage Recording ────────────────────────────────────────────────────────

export async function recordUsage(
  ctx: ConstructiveContext,
  billing: BillingConfig,
  entityId: string,
  meterSlug: string,
  amount: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await ctx.withPgClient(async (client) => {
      const sql = `SELECT "${billing.privateSchema}"."${billing.recordUsageFunction}"($1, $2::uuid, $3, $4::jsonb)`;
      await client.query(sql, [meterSlug, entityId, amount, JSON.stringify(metadata)]);
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn(`record_usage failed (non-fatal): ${message}`);
  }
}

// ─── Inference Logging ──────────────────────────────────────────────────────

export interface InferenceLogEntry {
  entityId: string;
  actorId: string;
  model: string;
  provider: string;
  service: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: string;
}

export async function logInference(
  ctx: ConstructiveContext,
  logConfig: InferenceLogConfig,
  entry: InferenceLogEntry,
): Promise<void> {
  try {
    await ctx.withPgClient(async (client) => {
      await client.query(
        `INSERT INTO "${logConfig.schema}"."${logConfig.tableName}"
         (entity_id, actor_id, model, provider, service, operation,
          input_tokens, output_tokens, total_tokens, latency_ms, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          entry.entityId, entry.actorId, entry.model,
          entry.provider, entry.service, entry.operation,
          entry.inputTokens, entry.outputTokens, entry.totalTokens,
          entry.latencyMs, entry.status,
        ],
      );
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn(`inference log INSERT failed (non-fatal): ${message}`);
  }
}
