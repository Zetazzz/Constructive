jest.mock('pg-cache', () => ({
  getPgPool: () => ({})
}));

import { PgpmMigrate } from '../../src/migrate/client';

const resolvedHashMethod = (client: PgpmMigrate): string => {
  return (client as unknown as { hashMethod: string }).hashMethod;
};

describe('PgpmMigrate hash method resolution', () => {
  const previousHashMethod = process.env.DEPLOYMENT_HASH_METHOD;

  afterEach(() => {
    if (previousHashMethod === undefined) {
      delete process.env.DEPLOYMENT_HASH_METHOD;
    } else {
      process.env.DEPLOYMENT_HASH_METHOD = previousHashMethod;
    }
  });

  it('prefers an explicitly resolved PGPM option', () => {
    process.env.DEPLOYMENT_HASH_METHOD = 'content';

    const client = new PgpmMigrate({} as any, { hashMethod: 'ast' });

    expect(resolvedHashMethod(client)).toBe('ast');
  });

  it('ignores unsupported direct environment values', () => {
    process.env.DEPLOYMENT_HASH_METHOD = 'unsupported';

    const client = new PgpmMigrate({} as any);

    expect(resolvedHashMethod(client)).toBe('content');
  });
});
