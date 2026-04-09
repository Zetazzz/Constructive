// Main exports from graphile-multi-tenancy-cache package
//
// Public API: only the orchestrator functions and types that consumers need.
// Internal state management (template map, tenant registration) is kept private
// to prevent consumers from bypassing the orchestrator and corrupting state.

// Core multi-tenancy cache — the primary consumer-facing API
export {
  getOrCreateTenantInstance,
  onTenantEvicted,
  getMultiTenancyCacheStats,
  shutdownMultiTenancyCache,
  TenantConfig,
  TenantInstance,
  MultiTenancyCacheStats,
} from './multi-tenancy-cache';

// Schema fingerprinting — needed by consumers who want to pre-compute or cache fingerprints
export {
  getSchemaFingerprint,
  fingerprintsMatch,
  MinimalIntrospection,
} from './fingerprint';

// Introspection utilities — needed by consumers who want to cache raw introspection
export {
  fetchIntrospection,
  parseIntrospection,
  fetchAndParseIntrospection,
} from './introspection';

// Dynamic schema resolution — public helpers only
export {
  wrapSchemaPlaceholder,
  isSchemaPlaceholder,
  extractTemplateSchemaNames,
  buildSchemaRemapTransform,
  buildTenantPgSettings,
  buildSchemaMap,
  remapSchemas,
  SchemaMapping,
} from './dynamic-schema';

// NOTE: The following are intentionally NOT exported:
// - getTemplate, setTemplate, registerTenant, deregisterTenant (internal state management)
// - getTemplateStats, getTenantFingerprint (internal — use getMultiTenancyCacheStats instead)
// - clearAllTemplates (internal — use shutdownMultiTenancyCache instead)
// - RegistryTemplate (internal type — exposes pgl, serv, httpServer, refCount)
