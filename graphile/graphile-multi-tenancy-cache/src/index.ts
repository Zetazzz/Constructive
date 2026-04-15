// Main exports from graphile-multi-tenancy-cache package
//
// Public API: only the orchestrator functions and types that consumers need.
// Internal state management (template map, tenant registration) is kept private
// to prevent consumers from bypassing the orchestrator and corrupting state.

// Core multi-tenancy cache — the primary consumer-facing API
export {
  getMultiTenancyCacheStats,
  getOrCreateTenantInstance,
  MultiTenancyCacheStats,
  onTenantEvicted,
  shutdownMultiTenancyCache,
  TenantConfig,
  TenantInstance
} from './multi-tenancy-cache';

// PgMultiTenancyWrapperPlugin — Grafast middleware plugin that intercepts
// client.query() to apply per-request SQL schema remapping.
// No Crystal source modifications required.
export { PgMultiTenancyWrapperPlugin } from './pg-client-wrapper-plugin';

// Schema fingerprinting — needed by consumers who want to pre-compute or cache fingerprints
export {
  fingerprintsMatch,
  getSchemaFingerprint,
  MinimalIntrospection
} from './fingerprint';

// Introspection utilities — needed by consumers who want to cache raw introspection
export {
  fetchAndParseIntrospection,
  fetchIntrospection,
  parseIntrospection
} from './introspection';

// Introspection cache — in-memory cache to avoid redundant pg_catalog queries
// Supports LRU eviction (idle TTL + max entries cap), same pattern as template eviction.
export {
  CachedIntrospection,
  clearIntrospectionCache,
  getIntrospectionCacheStats,
  getOrCreateIntrospection,
  IntrospectionCacheStats,
  invalidateIntrospection,
  sweepIntrospectionCache
} from './introspection-cache';

// Dynamic schema resolution — public helpers only
// The placeholder-encoding utilities (wrapSchemaPlaceholder, isSchemaPlaceholder,
// extractOriginalName, buildSchemaRemapTransform) originate from the Crystal-mimic
// shim at ./compat/crystal/multiTenancy and are re-exported through dynamic-schema.
export {
  buildSchemaMap,
  buildSchemaRemapTransform,
  buildTenantPgSettings,
  extractOriginalName,
  extractTemplateSchemaNames,
  isSchemaPlaceholder,
  remapSchemas,
  SchemaMapping,
  wrapSchemaPlaceholder
} from './dynamic-schema';

// Template eviction — allows consumers to trigger a manual sweep or monitor idle templates
export { sweepIdleTemplates } from './registry-template-map';
// NOTE: sweepIntrospectionCache is exported above from './introspection-cache'

// NOTE: The following are intentionally NOT exported:
// - getTemplate, setTemplate, registerTenant, deregisterTenant (internal state management)
// - getTemplateStats, getTenantFingerprint (internal — use getMultiTenancyCacheStats instead)
// - clearAllTemplates (internal — use shutdownMultiTenancyCache instead)
// - RegistryTemplate (internal type — exposes pgl, serv, httpServer, refCount)
