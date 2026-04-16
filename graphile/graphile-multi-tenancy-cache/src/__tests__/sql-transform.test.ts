import { buildSchemaRemapTransform, SqlRemapError, clearRewriteCache } from '../utils/sql-transform';

afterEach(() => {
  clearRewriteCache();
});

describe('buildSchemaRemapTransform', () => {
  const schemaMap = {
    t_1_services_public: 't_2_services_public',
    t_1_services_private: 't_2_services_private',
  };

  it('returns identity function for empty schema map', async () => {
    const transform = buildSchemaRemapTransform({});
    const sql = 'SELECT * FROM "t_1_services_public"."users"';
    expect(await transform(sql)).toBe(sql);
  });

  it('rewrites schema names in a simple SELECT', async () => {
    const transform = buildSchemaRemapTransform(schemaMap);
    const sql = 'SELECT * FROM "t_1_services_public"."users"';
    const result = await transform(sql);

    expect(result).toContain('t_2_services_public');
    expect(result).not.toContain('t_1_services_public');
  });

  it('rewrites schema names in JOINs', async () => {
    const transform = buildSchemaRemapTransform(schemaMap);
    const sql = `
      SELECT u.id, p.title
      FROM "t_1_services_public"."users" u
      JOIN "t_1_services_public"."posts" p ON u.id = p.user_id
    `;
    const result = await transform(sql);

    expect(result).toContain('t_2_services_public');
    expect(result).not.toContain('t_1_services_public');
  });

  it('rewrites multiple different schemas in one query', async () => {
    const transform = buildSchemaRemapTransform(schemaMap);
    const sql = `
      SELECT *
      FROM "t_1_services_public"."users" u
      JOIN "t_1_services_private"."sessions" s ON u.id = s.user_id
    `;
    const result = await transform(sql);

    expect(result).toContain('t_2_services_public');
    expect(result).toContain('t_2_services_private');
    expect(result).not.toContain('t_1_services_public');
    expect(result).not.toContain('t_1_services_private');
  });

  it('does not rewrite schema names that are not in the map', async () => {
    const transform = buildSchemaRemapTransform(schemaMap);
    const sql = 'SELECT * FROM "pg_catalog"."pg_class"';
    const result = await transform(sql);

    expect(result).toContain('pg_catalog');
  });

  it('caches results for identical SQL + schema map', async () => {
    const transform = buildSchemaRemapTransform(schemaMap);
    const sql = 'SELECT * FROM "t_1_services_public"."users"';

    const result1 = await transform(sql);
    const result2 = await transform(sql);

    expect(result1).toBe(result2);
  });

  it('rewrites INSERT statements', async () => {
    const transform = buildSchemaRemapTransform(schemaMap);
    const sql = 'INSERT INTO "t_1_services_public"."users" (name) VALUES (\'test\')';
    const result = await transform(sql);

    expect(result).toContain('t_2_services_public');
    expect(result).not.toContain('t_1_services_public');
  });

  it('rewrites UPDATE statements', async () => {
    const transform = buildSchemaRemapTransform(schemaMap);
    const sql = 'UPDATE "t_1_services_public"."users" SET name = \'test\' WHERE id = 1';
    const result = await transform(sql);

    expect(result).toContain('t_2_services_public');
    expect(result).not.toContain('t_1_services_public');
  });

  it('rewrites DELETE statements', async () => {
    const transform = buildSchemaRemapTransform(schemaMap);
    const sql = 'DELETE FROM "t_1_services_public"."users" WHERE id = 1';
    const result = await transform(sql);

    expect(result).toContain('t_2_services_public');
    expect(result).not.toContain('t_1_services_public');
  });

  it('does not touch string literals containing schema names', async () => {
    const transform = buildSchemaRemapTransform(schemaMap);
    const sql = `SELECT 't_1_services_public' AS schema_name FROM "t_1_services_public"."users"`;
    const result = await transform(sql);

    // The schema reference in FROM should be rewritten
    expect(result).toContain('t_2_services_public');
    // String literal should be preserved as-is
    expect(result).toContain("'t_1_services_public'");
  });
});

describe('SqlRemapError', () => {
  it('has the correct name and properties', () => {
    const err = new SqlRemapError('test error', 'hash1', 'hash2');
    expect(err.name).toBe('SqlRemapError');
    expect(err.message).toBe('test error');
    expect(err.sqlHash).toBe('hash1');
    expect(err.schemaMapHash).toBe('hash2');
    expect(err instanceof Error).toBe(true);
  });
});
