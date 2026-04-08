import {
  TENANT_SCHEMA_CONTEXT_KEY,
  buildTenantPgSettings,
  remapSchemas,
} from '../dynamic-schema';

describe('dynamic-schema', () => {
  describe('TENANT_SCHEMA_CONTEXT_KEY', () => {
    it('should be defined', () => {
      expect(TENANT_SCHEMA_CONTEXT_KEY).toBe('tenantSchema');
    });
  });

  describe('buildTenantPgSettings', () => {
    it('should set the primary tenant schema', () => {
      const settings = buildTenantPgSettings(['my_schema']);
      expect(settings[`app.${TENANT_SCHEMA_CONTEXT_KEY}`]).toBe('my_schema');
    });

    it('should set search_path with all schemas', () => {
      const settings = buildTenantPgSettings(['schema_a', 'schema_b']);
      expect(settings['search_path']).toBe('"schema_a", "schema_b"');
    });

    it('should handle empty schemas', () => {
      const settings = buildTenantPgSettings([]);
      expect(settings[`app.${TENANT_SCHEMA_CONTEXT_KEY}`]).toBeUndefined();
      expect(settings['search_path']).toBe('');
    });

    it('should use the first schema as the primary', () => {
      const settings = buildTenantPgSettings(['primary', 'secondary', 'tertiary']);
      expect(settings[`app.${TENANT_SCHEMA_CONTEXT_KEY}`]).toBe('primary');
    });
  });

  describe('remapSchemas', () => {
    it('should replace prefix in schema names', () => {
      const result = remapSchemas(
        ['template_public', 'template_private'],
        'template',
        'tenant_abc',
      );
      expect(result).toEqual(['tenant_abc_public', 'tenant_abc_private']);
    });

    it('should leave non-matching schemas unchanged', () => {
      const result = remapSchemas(
        ['template_public', 'shared_config'],
        'template',
        'tenant_abc',
      );
      expect(result).toEqual(['tenant_abc_public', 'shared_config']);
    });

    it('should handle empty arrays', () => {
      const result = remapSchemas([], 'template', 'tenant');
      expect(result).toEqual([]);
    });

    it('should handle exact prefix match', () => {
      const result = remapSchemas(['app'], 'app', 'tenant_1');
      expect(result).toEqual(['tenant_1']);
    });
  });
});
