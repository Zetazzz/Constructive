// Main exports from graphile-multi-tenancy-cache package

// Core multi-tenancy cache
export {
  getOrCreateTenantInstance,
  onTenantEvicted,
  getMultiTenancyCacheStats,
  shutdownMultiTenancyCache,
  TenantConfig,
  TenantInstance,
  MultiTenancyCacheStats,
} from './multi-tenancy-cache';

// Schema fingerprinting
export {
  getSchemaFingerprint,
  fingerprintsMatch,
  MinimalIntrospection,
} from './fingerprint';

// Registry template map
export {
  getTemplate,
  setTemplate,
  registerTenant,
  deregisterTenant,
  getTemplateStats,
  clearAllTemplates,
  RegistryTemplate,
} from './registry-template-map';

// Introspection utilities
export {
  fetchIntrospection,
  parseIntrospection,
  fetchAndParseIntrospection,
} from './introspection';

// Dynamic schema resolution
export {
  wrapSchemaPlaceholder,
  isSchemaPlaceholder,
  extractTemplateSchemaNames,
  buildSchemaRemapTransform,
  SchemaMapping,
  buildTenantPgSettings,
  buildSchemaMap,
  remapSchemas,
} from './dynamic-schema';
