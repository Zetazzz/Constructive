import {
  PGMT_PREFIX,
  PGMT_SUFFIX,
  TENANT_SCHEMA_CONTEXT_KEY,
  buildSchemaRemapTransform,
  buildTenantPgSettings,
  buildSchemaMap,
  remapSchemas,
} from '../dynamic-schema';

describe('dynamic-schema', () => {
  describe('constants', () => {
    it('should define PGMT_PREFIX', () => {
      expect(PGMT_PREFIX).toBe('__pgmt_');
    });

    it('should define PGMT_SUFFIX', () => {
      expect(PGMT_SUFFIX).toBe('__');
    });

    it('should define TENANT_SCHEMA_CONTEXT_KEY', () => {
      expect(TENANT_SCHEMA_CONTEXT_KEY).toBe('tenantSchemaMap');
    });
  });

  describe('buildSchemaRemapTransform', () => {
    it('should return identity function for empty map', () => {
      const transform = buildSchemaRemapTransform({});
      const sql = 'SELECT * FROM "app_public"."users"';
      expect(transform(sql)).toBe(sql);
    });

    it('should replace single schema placeholder', () => {
      const transform = buildSchemaRemapTransform({
        app_public: 'tenant_42_public',
      });
      const sql = `SELECT * FROM "${PGMT_PREFIX}app_public${PGMT_SUFFIX}"."users"`;
      const result = transform(sql);
      expect(result).toBe('SELECT * FROM "tenant_42_public"."users"');
    });

    it('should replace multiple schema placeholders', () => {
      const transform = buildSchemaRemapTransform({
        t_1_app: 't_2_app',
        t_1_perf: 't_2_perf',
      });
      const sql = `SELECT * FROM "${PGMT_PREFIX}t_1_app${PGMT_SUFFIX}"."users" u JOIN "${PGMT_PREFIX}t_1_perf${PGMT_SUFFIX}"."metrics" m ON u.id = m.user_id`;
      const result = transform(sql);
      expect(result).toBe('SELECT * FROM "t_2_app"."users" u JOIN "t_2_perf"."metrics" m ON u.id = m.user_id');
    });

    it('should replace all occurrences of the same placeholder', () => {
      const transform = buildSchemaRemapTransform({
        app_public: 'tenant_1_public',
      });
      const sql = `SELECT * FROM "${PGMT_PREFIX}app_public${PGMT_SUFFIX}"."users" WHERE id IN (SELECT user_id FROM "${PGMT_PREFIX}app_public${PGMT_SUFFIX}"."posts")`;
      const result = transform(sql);
      expect(result).toContain('"tenant_1_public"."users"');
      expect(result).toContain('"tenant_1_public"."posts"');
      expect(result).not.toContain(PGMT_PREFIX);
    });

    it('should not modify text that does not contain placeholders', () => {
      const transform = buildSchemaRemapTransform({
        app_public: 'tenant_1_public',
      });
      const sql = 'SELECT 1 + 1';
      expect(transform(sql)).toBe(sql);
    });

    it('should handle identity mapping (template schema == tenant schema)', () => {
      const transform = buildSchemaRemapTransform({
        t_1_app: 't_1_app',
      });
      const sql = `SELECT * FROM "${PGMT_PREFIX}t_1_app${PGMT_SUFFIX}"."users"`;
      const result = transform(sql);
      expect(result).toBe('SELECT * FROM "t_1_app"."users"');
    });
  });

  describe('buildTenantPgSettings', () => {
    it('should set search_path with all schemas', () => {
      const settings = buildTenantPgSettings(['schema_a', 'schema_b']);
      expect(settings['search_path']).toBe('"schema_a", "schema_b"');
    });

    it('should handle single schema', () => {
      const settings = buildTenantPgSettings(['my_schema']);
      expect(settings['search_path']).toBe('"my_schema"');
    });

    it('should handle empty schemas', () => {
      const settings = buildTenantPgSettings([]);
      expect(settings['search_path']).toBeUndefined();
    });
  });

  describe('buildSchemaMap', () => {
    it('should create a mapping from template to tenant schemas', () => {
      const map = buildSchemaMap(['t_1_app', 't_1_perf'], ['t_2_app', 't_2_perf']);
      expect(map).toEqual({
        t_1_app: 't_2_app',
        t_1_perf: 't_2_perf',
      });
    });

    it('should handle single schema', () => {
      const map = buildSchemaMap(['app_public'], ['tenant_42_public']);
      expect(map).toEqual({ app_public: 'tenant_42_public' });
    });

    it('should handle empty arrays', () => {
      const map = buildSchemaMap([], []);
      expect(map).toEqual({});
    });

    it('should handle mismatched lengths (template longer)', () => {
      const map = buildSchemaMap(['a', 'b', 'c'], ['x', 'y']);
      expect(map).toEqual({ a: 'x', b: 'y' });
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
