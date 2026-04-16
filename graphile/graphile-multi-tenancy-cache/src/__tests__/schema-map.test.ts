import { buildSchemaMap, buildTenantPgSettings, remapSchemas } from '../utils/schema-map';

describe('buildSchemaMap', () => {
  it('maps template schemas to tenant schemas positionally', () => {
    const map = buildSchemaMap(
      ['t_1_services_public', 't_1_services_private'],
      ['t_2_services_public', 't_2_services_private'],
    );

    expect(map).toEqual({
      t_1_services_public: 't_2_services_public',
      t_1_services_private: 't_2_services_private',
    });
  });

  it('omits entries where template and tenant schemas are identical', () => {
    const map = buildSchemaMap(
      ['t_1_services_public', 'shared_schema'],
      ['t_2_services_public', 'shared_schema'],
    );

    expect(map).toEqual({
      t_1_services_public: 't_2_services_public',
    });
    expect(map).not.toHaveProperty('shared_schema');
  });

  it('returns empty map when all schemas match', () => {
    const map = buildSchemaMap(
      ['public', 'extensions'],
      ['public', 'extensions'],
    );

    expect(map).toEqual({});
  });

  it('throws when schema count mismatches', () => {
    expect(() =>
      buildSchemaMap(['a', 'b'], ['x']),
    ).toThrow('Schema count mismatch');
  });

  it('handles empty arrays', () => {
    const map = buildSchemaMap([], []);
    expect(map).toEqual({});
  });
});

describe('buildTenantPgSettings', () => {
  it('builds search_path from tenant schemas', () => {
    const settings = buildTenantPgSettings(['t_2_services_public', 't_2_services_private']);
    expect(settings).toEqual({
      search_path: 't_2_services_public,t_2_services_private',
    });
  });

  it('handles single schema', () => {
    const settings = buildTenantPgSettings(['public']);
    expect(settings).toEqual({
      search_path: 'public',
    });
  });
});

describe('remapSchemas', () => {
  it('replaces template prefix with tenant prefix', () => {
    const result = remapSchemas(
      ['t_1_services_public', 't_1_services_private'],
      't_1_',
      't_2_',
    );

    expect(result).toEqual(['t_2_services_public', 't_2_services_private']);
  });

  it('leaves schemas without matching prefix unchanged', () => {
    const result = remapSchemas(
      ['t_1_services_public', 'shared_extensions'],
      't_1_',
      't_2_',
    );

    expect(result).toEqual(['t_2_services_public', 'shared_extensions']);
  });

  it('handles empty array', () => {
    const result = remapSchemas([], 't_1_', 't_2_');
    expect(result).toEqual([]);
  });
});
