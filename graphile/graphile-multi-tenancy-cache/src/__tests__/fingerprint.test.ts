import { getSchemaFingerprint, fingerprintsMatch } from '../fingerprint';
import type { MinimalIntrospection } from '../fingerprint';

describe('getSchemaFingerprint', () => {
  const baseIntrospection: MinimalIntrospection = {
    namespaces: [
      { _id: '1', nspname: 'tenant_a' },
    ],
    classes: [
      { _id: '100', relname: 'users', relnamespace: '1', relkind: 'r' },
      { _id: '101', relname: 'posts', relnamespace: '1', relkind: 'r' },
    ],
    attributes: [
      { attrelid: '100', attname: 'id', atttypid: '200', attnum: 1, attnotnull: true },
      { attrelid: '100', attname: 'name', atttypid: '201', attnum: 2, attnotnull: true },
      { attrelid: '100', attname: 'email', atttypid: '201', attnum: 3, attnotnull: false },
      { attrelid: '101', attname: 'id', atttypid: '200', attnum: 1, attnotnull: true },
      { attrelid: '101', attname: 'title', atttypid: '201', attnum: 2, attnotnull: true },
      { attrelid: '101', attname: 'author_id', atttypid: '200', attnum: 3, attnotnull: true },
    ],
    constraints: [
      { _id: '300', conname: 'users_pkey', connamespace: '1', conrelid: '100', contype: 'p', conkey: [1], confrelid: '', confkey: null },
      { _id: '301', conname: 'posts_pkey', connamespace: '1', conrelid: '101', contype: 'p', conkey: [1], confrelid: '', confkey: null },
      { _id: '302', conname: 'posts_author_id_fkey', connamespace: '1', conrelid: '101', contype: 'f', conkey: [3], confrelid: '100', confkey: [1] },
    ],
    types: [
      { _id: '200', typname: 'uuid', typnamespace: '1', typtype: 'b' },
      { _id: '201', typname: 'text', typnamespace: '1', typtype: 'b' },
    ],
  };

  it('should produce a consistent fingerprint for the same schema', () => {
    const fp1 = getSchemaFingerprint(baseIntrospection, ['tenant_a']);
    const fp2 = getSchemaFingerprint(baseIntrospection, ['tenant_a']);
    expect(fp1).toBe(fp2);
    expect(fp1).toHaveLength(64); // SHA-256 hex
  });

  it('should produce the SAME fingerprint for structurally identical schemas with different names', () => {
    // Create tenant_b with identical structure but different namespace
    const tenantB: MinimalIntrospection = {
      namespaces: [
        { _id: '2', nspname: 'tenant_b' },
      ],
      classes: [
        { _id: '110', relname: 'users', relnamespace: '2', relkind: 'r' },
        { _id: '111', relname: 'posts', relnamespace: '2', relkind: 'r' },
      ],
      attributes: [
        { attrelid: '110', attname: 'id', atttypid: '200', attnum: 1, attnotnull: true },
        { attrelid: '110', attname: 'name', atttypid: '201', attnum: 2, attnotnull: true },
        { attrelid: '110', attname: 'email', atttypid: '201', attnum: 3, attnotnull: false },
        { attrelid: '111', attname: 'id', atttypid: '200', attnum: 1, attnotnull: true },
        { attrelid: '111', attname: 'title', atttypid: '201', attnum: 2, attnotnull: true },
        { attrelid: '111', attname: 'author_id', atttypid: '200', attnum: 3, attnotnull: true },
      ],
      constraints: [
        { _id: '310', conname: 'users_pkey', connamespace: '2', conrelid: '110', contype: 'p', conkey: [1], confrelid: '', confkey: null },
        { _id: '311', conname: 'posts_pkey', connamespace: '2', conrelid: '111', contype: 'p', conkey: [1], confrelid: '', confkey: null },
        { _id: '312', conname: 'posts_author_id_fkey', connamespace: '2', conrelid: '111', contype: 'f', conkey: [3], confrelid: '110', confkey: [1] },
      ],
      types: [
        { _id: '200', typname: 'uuid', typnamespace: '2', typtype: 'b' },
        { _id: '201', typname: 'text', typnamespace: '2', typtype: 'b' },
      ],
    };

    const fpA = getSchemaFingerprint(baseIntrospection, ['tenant_a']);
    const fpB = getSchemaFingerprint(tenantB, ['tenant_b']);

    expect(fpA).toBe(fpB);
  });

  it('should produce DIFFERENT fingerprints for structurally different schemas', () => {
    // Create a schema with an extra column
    const differentSchema: MinimalIntrospection = {
      ...baseIntrospection,
      attributes: [
        ...baseIntrospection.attributes,
        { attrelid: '100', attname: 'phone', atttypid: '201', attnum: 4, attnotnull: false },
      ],
    };

    const fp1 = getSchemaFingerprint(baseIntrospection, ['tenant_a']);
    const fp2 = getSchemaFingerprint(differentSchema, ['tenant_a']);

    expect(fp1).not.toBe(fp2);
  });

  it('should produce DIFFERENT fingerprints when constraint types differ', () => {
    const differentConstraints: MinimalIntrospection = {
      ...baseIntrospection,
      constraints: [
        ...baseIntrospection.constraints,
        { _id: '303', conname: 'users_email_unique', connamespace: '1', conrelid: '100', contype: 'u', conkey: [3], confrelid: '', confkey: null },
      ],
    };

    const fp1 = getSchemaFingerprint(baseIntrospection, ['tenant_a']);
    const fp2 = getSchemaFingerprint(differentConstraints, ['tenant_a']);

    expect(fp1).not.toBe(fp2);
  });

  it('should filter to specified schemas only', () => {
    const multiNs: MinimalIntrospection = {
      namespaces: [
        { _id: '1', nspname: 'tenant_a' },
        { _id: '2', nspname: 'pg_catalog' },
      ],
      classes: [
        { _id: '100', relname: 'users', relnamespace: '1', relkind: 'r' },
        { _id: '200', relname: 'pg_class', relnamespace: '2', relkind: 'r' },
      ],
      attributes: [],
      constraints: [],
      types: [],
    };

    const fpAll = getSchemaFingerprint(multiNs);
    const fpFiltered = getSchemaFingerprint(multiNs, ['tenant_a']);

    // When filtering to tenant_a only, pg_catalog tables are excluded
    expect(fpAll).toBe(fpFiltered); // pg_catalog is excluded by default anyway
  });

  it('should include function signatures in the fingerprint', () => {
    const withProcs: MinimalIntrospection = {
      ...baseIntrospection,
      procs: [
        { _id: '400', proname: 'get_user', pronamespace: '1', proargtypes: ['200'], prorettype: '200' },
      ],
    };

    const fp1 = getSchemaFingerprint(baseIntrospection, ['tenant_a']);
    const fp2 = getSchemaFingerprint(withProcs, ['tenant_a']);

    expect(fp1).not.toBe(fp2);
  });
});

describe('fingerprintsMatch', () => {
  it('should return true for matching fingerprints', () => {
    expect(fingerprintsMatch('abc123', 'abc123')).toBe(true);
  });

  it('should return false for different fingerprints', () => {
    expect(fingerprintsMatch('abc123', 'def456')).toBe(false);
  });
});
