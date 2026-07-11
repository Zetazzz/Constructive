import {
  getConnEnvOptions,
  getEnvOptions,
  getEnvVars,
  getPgpmEnvOptions,
} from '../src';
import { pgpmDefaults } from '@pgpmjs/types';
import type { PgpmOptions } from '@pgpmjs/types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const writeConfig = (dir: string, config: Record<string, unknown>): void => {
  fs.writeFileSync(
    path.join(dir, 'pgpm.json'),
    JSON.stringify(config, null, 2)
  );
};

describe('getConnEnvOptions', () => {
  describe('roles resolution', () => {
    it('should always return roles with default values when no overrides provided', () => {
      const result = getConnEnvOptions();

      expect(result.roles).toBeDefined();
      expect(result.roles?.anonymous).toBe('anonymous');
      expect(result.roles?.authenticated).toBe('authenticated');
      expect(result.roles?.administrator).toBe('administrator');
    });

    it('should preserve default roles even when roles is explicitly undefined in overrides', () => {
      const result = getConnEnvOptions({ roles: undefined });

      expect(result.roles).toBeDefined();
      expect(result.roles?.anonymous).toBe('anonymous');
      expect(result.roles?.authenticated).toBe('authenticated');
      expect(result.roles?.administrator).toBe('administrator');
    });

    it('should allow overriding individual role names while preserving others', () => {
      const result = getConnEnvOptions({
        roles: {
          anonymous: 'custom_anon',
        },
      });

      expect(result.roles?.anonymous).toBe('custom_anon');
      expect(result.roles?.authenticated).toBe('authenticated');
      expect(result.roles?.administrator).toBe('administrator');
    });

    it('should allow overriding all role names', () => {
      const result = getConnEnvOptions({
        roles: {
          anonymous: 'custom_anon',
          authenticated: 'custom_auth',
          administrator: 'custom_admin',
        },
      });

      expect(result.roles?.anonymous).toBe('custom_anon');
      expect(result.roles?.authenticated).toBe('custom_auth');
      expect(result.roles?.administrator).toBe('custom_admin');
    });
  });

  describe('connections resolution', () => {
    it('should always return connections with default values when no overrides provided', () => {
      const result = getConnEnvOptions();

      expect(result.connections).toBeDefined();
      expect(result.connections?.app?.user).toBe('app_user');
      expect(result.connections?.app?.password).toBe('app_password');
      expect(result.connections?.admin?.user).toBe('app_admin');
      expect(result.connections?.admin?.password).toBe('admin_password');
    });

    it('should preserve default connections even when connections is explicitly undefined', () => {
      const result = getConnEnvOptions({ connections: undefined });

      expect(result.connections).toBeDefined();
      expect(result.connections?.app?.user).toBe('app_user');
      expect(result.connections?.admin?.user).toBe('app_admin');
    });

    it('should allow overriding individual connection properties while preserving others', () => {
      const result = getConnEnvOptions({
        connections: {
          app: {
            user: 'custom_app_user',
          },
        },
      });

      expect(result.connections?.app?.user).toBe('custom_app_user');
      expect(result.connections?.app?.password).toBe('app_password');
      expect(result.connections?.admin?.user).toBe('app_admin');
    });
  });

  describe('other properties', () => {
    it('should preserve other db properties from defaults', () => {
      const result = getConnEnvOptions();

      expect(result.rootDb).toBe(pgpmDefaults.db?.rootDb);
      expect(result.prefix).toBe(pgpmDefaults.db?.prefix);
    });

    it('should allow overriding other db properties', () => {
      const result = getConnEnvOptions({
        rootDb: 'custom_root',
        prefix: 'custom-',
      });

      expect(result.rootDb).toBe('custom_root');
      expect(result.prefix).toBe('custom-');
    });
  });
});

describe('getEnvOptions', () => {
  let tempDir = '';

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('is an exact alias of getPgpmEnvOptions', () => {
    expect(getEnvOptions).toBe(getPgpmEnvOptions);
  });

  it('merges defaults, config, env, and overrides', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgpm-env-'));
    writeConfig(tempDir, {
      pg: {
        host: 'config-host',
        database: 'config-db',
      },
      server: {
        port: 4000,
      },
      db: {
        prefix: 'config-',
        connections: {
          app: {
            user: 'config_app',
          },
        },
      },
      deployment: {
        fast: true,
      },
    });

    const testEnv: NodeJS.ProcessEnv = {
      PGHOST: 'env-host',
      PGPORT: '6543',
      PGUSER: 'env-user',
      PGPASSWORD: 'env-pass',
      DB_PREFIX: 'env-',
      DB_CONNECTIONS_APP_PASSWORD: 'env-app-pass',
      DB_CONNECTIONS_ADMIN_USER: 'env-admin-user',
      PORT: '7777',
      DEPLOYMENT_FAST: 'false',
      JOBS_SUPPORT_ANY: 'false',
      JOBS_SUPPORTED: 'alpha,beta',
      SMTP_HOST: 'smtp.example.com',
    };

    const result = getEnvOptions(
      {
        db: {
          prefix: 'override-',
          cwd: '<CWD>',
        },
        pg: {
          host: 'override-host',
        },
        deployment: {
          cache: true,
        },
      },
      tempDir,
      testEnv
    );

    expect(result).toMatchSnapshot();
  });

  it('replaces array fields with later values (overrides win)', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgpm-env-replace-'));
    writeConfig(tempDir, {
      db: {
        extensions: ['uuid', 'postgis'],
      },
      packages: ['testing/*', 'packages/*'],
    });

    const testEnv: NodeJS.ProcessEnv = {
      DB_EXTENSIONS: 'postgis,pgcrypto',
    };

    const overrides: PgpmOptions = {
      db: {
        extensions: ['uuid', 'hstore'],
      },
      packages: ['testing/*', 'extensions/*'],
    };

    const result = getEnvOptions(overrides, tempDir, testEnv) as PgpmOptions;

    // Arrays are replaced, not merged - overrides win completely
    expect(result.db?.extensions).toEqual(['uuid', 'hstore']);
    expect(result.packages).toEqual(['testing/*', 'extensions/*']);
  });

  it('projects config and untyped overrides to PGPM-owned keys', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgpm-env-projection-'));
    writeConfig(tempDir, {
      packages: ['config/*'],
      name: 'config-workspace',
      version: '1.2.3',
      settings: {
        fromConfig: true,
      },
      server: { port: 4000 },
      cdn: { bucketName: 'config-bucket' },
      jobs: { schema: { schema: 'config_jobs' } },
      smtp: { host: 'config-smtp' },
      graphile: { schema: 'config_graphile' },
    });

    const untypedOverrides = {
      packages: ['override/*'],
      name: 'override-workspace',
      settings: {
        fromOverride: true,
      },
      server: { port: 9999 },
      cdn: { bucketName: 'override-bucket' },
      jobs: { schema: { schema: 'override_jobs' } },
      smtp: { host: 'override-smtp' },
      api: { isPublic: true },
    } as unknown as PgpmOptions;

    const result = getPgpmEnvOptions(untypedOverrides, tempDir, {
      PORT: '7777',
      BUCKET_NAME: 'env-bucket',
      JOBS_SCHEMA: 'env_jobs',
      SMTP_HOST: 'env-smtp',
    }) as PgpmOptions;

    expect(result.packages).toEqual(['override/*']);
    expect(result.name).toBe('override-workspace');
    expect(result.version).toBe('1.2.3');
    expect(result.settings).toEqual({
      fromConfig: true,
      fromOverride: true,
    });
    expect(result).not.toHaveProperty('server');
    expect(result).not.toHaveProperty('cdn');
    expect(result).not.toHaveProperty('jobs');
    expect(result).not.toHaveProperty('smtp');
    expect(result).not.toHaveProperty('graphile');
    expect(result).not.toHaveProperty('api');
  });

  it('applies config, env, and runtime precedence to deployment hash method', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pgpm-env-hash-'));
    writeConfig(tempDir, {
      deployment: {
        hashMethod: 'ast',
      },
    });

    expect(getPgpmEnvOptions({}, tempDir, {}).deployment?.hashMethod).toBe(
      'ast'
    );
    expect(
      getPgpmEnvOptions({}, tempDir, {
        DEPLOYMENT_HASH_METHOD: 'content',
      }).deployment?.hashMethod
    ).toBe('content');
    expect(
      getPgpmEnvOptions(
        {
          deployment: {
            hashMethod: 'ast',
          },
        },
        tempDir,
        {
          DEPLOYMENT_HASH_METHOD: 'content',
        }
      ).deployment?.hashMethod
    ).toBe('ast');
    expect(
      getPgpmEnvOptions({}, tempDir, {
        DEPLOYMENT_HASH_METHOD: 'invalid',
      }).deployment?.hashMethod
    ).toBe('ast');
  });
});

describe('getEnvVars', () => {
  it('ignores non-PGPM and obsolete singular connection variables', () => {
    const result = getEnvVars({
      PORT: '7777',
      SERVER_HOST: 'server.example.com',
      BUCKET_PROVIDER: 's3',
      BUCKET_NAME: 'bucket',
      JOBS_SCHEMA: 'app_jobs',
      SMTP_HOST: 'smtp.example.com',
      DB_CONNECTION_USER: 'obsolete-user',
      DB_CONNECTION_PASSWORD: 'obsolete-password',
      DB_CONNECTION_ROLE: 'obsolete-role',
    });

    expect(result).toEqual({
      db: {},
      pg: {},
      deployment: {},
      migrations: {},
      errorOutput: {},
    });
  });
});
