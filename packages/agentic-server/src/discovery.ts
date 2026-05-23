/**
 * discovery — Runtime resolution of agent and billing module tables
 *
 * Queries metaschema_modules_public to find:
 *   - agent_chat_module: thread/message/task table names
 *   - billing_module: billing function names (check_quota, record_usage)
 *   - inference_log_module: inference log table name
 *
 * Results are cached with a TTL to avoid per-request database hits.
 */

import type { Pool } from 'pg';

import { TtlCache } from './cache';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentTableInfo {
  schemaName: string;
  tableName: string;
}

export interface AgentDiscovery {
  thread: AgentTableInfo | null;
  message: AgentTableInfo | null;
  task: AgentTableInfo | null;
}

export interface BillingConfig {
  privateSchema: string;
  publicSchema: string;
  recordUsageFunction: string;
  checkBillingQuotaFunction: string;
}

export interface InferenceLogConfig {
  schema: string;
  tableName: string;
}

export interface DatabaseConfig {
  billing: BillingConfig | null;
  inferenceLog: InferenceLogConfig | null;
}

// ─── SQL ────────────────────────────────────────────────────────────────────

const AGENT_DISCOVERY_SQL = `
  SELECT
    s.schema_name,
    acm.thread_table_name,
    acm.message_table_name,
    acm.task_table_name
  FROM metaschema_modules_public.agent_chat_module acm
  JOIN metaschema_public.schema s ON s.id = acm.schema_id
  LIMIT 1
`;

const SCHEMA_EXISTS_SQL = `
  SELECT 1 FROM information_schema.schemata WHERE schema_name = $1 LIMIT 1
`;

const BILLING_MODULE_SQL = `
  SELECT
    s.schema_name AS public_schema,
    ps.schema_name AS private_schema,
    bm.record_usage_function
  FROM metaschema_modules_public.billing_module bm
  JOIN metaschema_public.schema s ON bm.schema_id = s.id
  JOIN metaschema_public.schema ps ON bm.private_schema_id = ps.id
  WHERE bm.database_id = $1
  LIMIT 1
`;

const INFERENCE_LOG_MODULE_SQL = `
  SELECT
    s.schema_name AS schema,
    ilm.inference_log_table_name AS table_name
  FROM metaschema_modules_public.inference_log_module ilm
  JOIN metaschema_public.schema s ON ilm.schema_id = s.id
  WHERE ilm.database_id = $1
  LIMIT 1
`;

// ─── Caches ─────────────────────────────────────────────────────────────────

const agentCache = new TtlCache<AgentDiscovery | null>(60_000); // 1 minute
const configCache = new TtlCache<DatabaseConfig>(5 * 60_000); // 5 minutes

// ─── Agent Discovery ────────────────────────────────────────────────────────

export async function getAgentDiscovery(
  pool: Pool,
  dbname: string,
): Promise<AgentDiscovery | null> {
  const cached = agentCache.get(dbname);
  if (cached !== undefined) return cached;

  let discovery: AgentDiscovery | null = null;

  try {
    const { rows } = await pool.query(AGENT_DISCOVERY_SQL);
    if (rows.length > 0) {
      const row = rows[0];
      const schemaName: string = row.schema_name;
      discovery = {
        thread: row.thread_table_name
          ? { schemaName, tableName: row.thread_table_name }
          : null,
        message: row.message_table_name
          ? { schemaName, tableName: row.message_table_name }
          : null,
        task: row.task_table_name
          ? { schemaName, tableName: row.task_table_name }
          : null,
      };
    }
  } catch {
    // Module not provisioned in this database
  }

  agentCache.set(dbname, discovery);
  return discovery;
}

// ─── Database Config (Billing + Inference Log) ──────────────────────────────

export async function getDatabaseConfig(
  pool: Pool,
  databaseId: string,
): Promise<DatabaseConfig> {
  const cached = configCache.get(databaseId);
  if (cached !== undefined) return cached;

  let billing: BillingConfig | null = null;
  let inferenceLog: InferenceLogConfig | null = null;

  try {
    const schemaCheck = await pool.query(SCHEMA_EXISTS_SQL, ['metaschema_modules_public']);
    if (schemaCheck.rows.length > 0) {
      const [billingResult, logResult] = await Promise.all([
        pool.query(BILLING_MODULE_SQL, [databaseId]).catch(() => ({ rows: [] as any[] })),
        pool.query(INFERENCE_LOG_MODULE_SQL, [databaseId]).catch(() => ({ rows: [] as any[] })),
      ]);

      const bRow = billingResult.rows[0];
      if (bRow?.record_usage_function) {
        billing = {
          publicSchema: bRow.public_schema as string,
          privateSchema: bRow.private_schema as string,
          recordUsageFunction: bRow.record_usage_function as string,
          checkBillingQuotaFunction: 'check_billing_quota',
        };
      }

      const lRow = logResult.rows[0];
      if (lRow?.schema && lRow?.table_name) {
        inferenceLog = {
          schema: lRow.schema as string,
          tableName: lRow.table_name as string,
        };
      }
    }
  } catch {
    // metaschema not provisioned
  }

  const entry: DatabaseConfig = { billing, inferenceLog };
  configCache.set(databaseId, entry);
  return entry;
}

// ─── Cache Management ───────────────────────────────────────────────────────

export function clearAgentCache(): void {
  agentCache.clear();
}

export function clearConfigCache(): void {
  configCache.clear();
}
