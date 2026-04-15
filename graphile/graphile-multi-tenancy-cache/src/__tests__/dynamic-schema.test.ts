import {
  buildSchemaRemapTransform,
  isSchemaPlaceholder,
  wrapSchemaPlaceholder,
  buildTenantPgSettings,
  buildSchemaMap,
  remapSchemas,
} from '../dynamic-schema';

describe('dynamic-schema', () => {
  describe('wrapSchemaPlaceholder', () => {
    it('should wrap a schema name in placeholder markers', () => {
      const result = wrapSchemaPlaceholder('app_public');
      expect(isSchemaPlaceholder(result)).toBe(true);
    });

    it('should handle empty string', () => {
      const result = wrapSchemaPlaceholder('');
      expect(isSchemaPlaceholder(result)).toBe(true);
    });
  });

  describe('buildSchemaRemapTransform (direct replacement)', () => {
    it('should return identity function for empty map', () => {
      const transform = buildSchemaRemapTransform({});
      const sql = 'SELECT * FROM "app_public"."users"';
      expect(transform(sql)).toBe(sql);
    });

    it('should replace single schema name directly', () => {
      const transform = buildSchemaRemapTransform({
        app_public: 'tenant_42_public',
      });
      const sql = 'SELECT * FROM "app_public"."users"';
      const result = transform(sql);
      expect(result).toBe('SELECT * FROM "tenant_42_public"."users"');
    });

    it('should replace multiple schema names in one pass', () => {
      const transform = buildSchemaRemapTransform({
        t_1_app: 't_2_app',
        t_1_perf: 't_2_perf',
      });
      const sql = 'SELECT * FROM "t_1_app"."users" u JOIN "t_1_perf"."metrics" m ON u.id = m.user_id';
      const result = transform(sql);
      expect(result).toBe('SELECT * FROM "t_2_app"."users" u JOIN "t_2_perf"."metrics" m ON u.id = m.user_id');
    });

    it('should replace all occurrences of the same schema', () => {
      const transform = buildSchemaRemapTransform({
        app_public: 'tenant_1_public',
      });
      const sql = 'SELECT * FROM "app_public"."users" WHERE id IN (SELECT user_id FROM "app_public"."posts")';
      const result = transform(sql);
      expect(result).toContain('"tenant_1_public"."users"');
      expect(result).toContain('"tenant_1_public"."posts"');
      expect(result).not.toContain('"app_public"');
    });

    it('should not modify text that does not contain mapped schemas', () => {
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
      const sql = 'SELECT * FROM "t_1_app"."users"';
      const result = transform(sql);
      expect(result).toBe('SELECT * FROM "t_1_app"."users"');
    });

    it('should safely handle schema names with double quotes', () => {
      const transform = buildSchemaRemapTransform({
        app_public: 'my"schema',
      });
      const sql = 'SELECT * FROM "app_public"."users"';
      const result = transform(sql);
      // pg-sql2's escapeSqlIdentifier doubles internal quotes
      expect(result).toBe('SELECT * FROM "my""schema"."users"');
    });

    it('should handle realistic multi-schema tenant SQL', () => {
      const transform = buildSchemaRemapTransform({
        t_1_services_public: 't_5_services_public',
        t_1_services_private: 't_5_services_private',
        t_1_services_admin: 't_5_services_admin',
      });
      const sql = [
        'SELECT a.id, a.name FROM "t_1_services_public"."apis" a',
        'LEFT JOIN "t_1_services_admin"."api_keys" k ON a.id = k.api_id',
        'WHERE a.schema_name = "t_1_services_private"."config"."default_schema"',
      ].join(' ');
      const result = transform(sql);
      expect(result).toContain('"t_5_services_public"."apis"');
      expect(result).toContain('"t_5_services_admin"."api_keys"');
      expect(result).toContain('"t_5_services_private"."config"');
      expect(result).not.toContain('t_1_');
    });

    it('should not replace partial matches in column/table names', () => {
      // Schema identifier is always quoted — so "t_1_app" only matches
      // the exact quoted form, not substrings in other identifiers
      const transform = buildSchemaRemapTransform({
        t_1_app: 't_2_app',
      });
      // The column name happens to contain "t_1_app" as a substring
      // but since pg-sql2 quotes identifiers, only the exact quoted
      // schema reference is matched
      const sql = 'SELECT * FROM "t_1_app"."users" WHERE t_1_app_name = \'foo\'';
      const result = transform(sql);
      expect(result).toBe('SELECT * FROM "t_2_app"."users" WHERE t_1_app_name = \'foo\'');
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

    it('should escape schema names with double quotes', () => {
      const settings = buildTenantPgSettings(['my"schema']);
      expect(settings['search_path']).toBe('"my""schema"');
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

    it('should handle mismatched lengths (template longer) and log warning', () => {
      const map = buildSchemaMap(['a', 'b', 'c'], ['x', 'y']);
      expect(map).toEqual({ a: 'x', b: 'y' });
    });

    it('should handle mismatched lengths (tenant longer)', () => {
      const map = buildSchemaMap(['a'], ['x', 'y']);
      expect(map).toEqual({ a: 'x' });
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
