// --- Orchestrator (primary API) ---
export {
  configureMultiTenancyCache,
  getOrCreateTenantInstance,
  getTenantInstance,
  flushTenantInstance,
  getMultiTenancyCacheStats,
  shutdownMultiTenancyCache,
} from './multi-tenancy-cache';

export type {
  TenantConfig,
  TenantInstance,
  MultiTenancyCacheStats,
  MultiTenancyCacheConfig,
} from './multi-tenancy-cache';

// --- Plugin ---
export { PgMultiTenancyWrapperPlugin } from './plugins/pg-client-wrapper-plugin';

// --- Introspection cache ---
export {
  getOrCreateIntrospection,
  invalidateIntrospection,
  clearIntrospectionCache,
  getIntrospectionCacheStats,
  getConnectionKey,
} from './introspection-cache';

export type {
  CachedIntrospection,
  IntrospectionCacheStats,
} from './introspection-cache';

// --- Template registry ---
export {
  getTemplate,
  setTemplate,
  registerTenant,
  deregisterTenant,
  sweepIdleTemplates,
  clearAllTemplates,
  getTemplateStats,
} from './registry-template-map';

export type {
  RegistryTemplate,
  TemplateStats,
} from './registry-template-map';

// --- Utilities ---
export { buildSchemaRemapTransform, SqlRemapError } from './utils/sql-transform';
export { buildSchemaMap, buildTenantPgSettings, remapSchemas } from './utils/schema-map';
export type { SchemaMapping } from './utils/schema-map';
export { getSchemaFingerprint, fingerprintsMatch } from './utils/fingerprint';
export type { MinimalIntrospection } from './utils/fingerprint';
export { fetchIntrospection, parseIntrospection, fetchAndParseIntrospection } from './utils/introspection-query';
