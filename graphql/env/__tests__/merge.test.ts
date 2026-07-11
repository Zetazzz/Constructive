import { getConstructiveEnvOptions, getEnvOptions } from '../src/merge';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const writeConfig = (dir: string, config: Record<string, unknown>): void => {
  fs.writeFileSync(
    path.join(dir, 'pgpm.json'),
    JSON.stringify(config, null, 2)
  );
};

describe('getEnvOptions', () => {
  let tempDir = '';

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('exports getEnvOptions as the exact Constructive resolver alias', () => {
    expect(getEnvOptions).toBe(getConstructiveEnvOptions);
  });

  it('merges pgpm defaults, graphql defaults, config, env, and overrides', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphql-env-'));
    writeConfig(tempDir, {
      pg: {
        host: 'config-host',
        database: 'config-db',
      },
      server: {
        port: 4000,
      },
      graphile: {
        schema: ['config_schema'],
      },
      features: {
        simpleInflection: false,
      },
      api: {
        enableServicesApi: false,
        isPublic: false,
        metaSchemas: ['config_meta'],
      },
    });

    const testEnv: NodeJS.ProcessEnv = {
      PGHOST: 'env-host',
      PGUSER: 'env-user',
      GRAPHILE_SCHEMA: 'env_schema_a,env_schema_b',
      FEATURES_SIMPLE_INFLECTION: 'true',
      FEATURES_POSTGIS: 'false',
      API_ENABLE_SERVICES: 'true',
      API_IS_PUBLIC: 'true',
      API_EXPOSED_SCHEMAS: 'public,app',
      API_META_SCHEMAS: 'env_meta1,env_meta2',
      API_ANON_ROLE: 'env_anon',
      API_ROLE_NAME: 'env_role',
      API_DEFAULT_DATABASE_ID: 'env_db',
    };

    const result = getEnvOptions(
      {
        db: {
          cwd: '<CWD>',
        },
        pg: {
          host: 'override-host',
        },
        server: {
          port: 5000,
        },
        graphile: {
          schema: ['override_schema'],
        },
        features: {
          oppositeBaseNames: false,
        },
        api: {
          enableServicesApi: false,
          defaultDatabaseId: 'override_db',
        },
      },
      tempDir,
      testEnv
    );

    expect(result).toMatchSnapshot();
  });

  it('replaces graphql array fields with later values (overrides win)', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphql-env-replace-'));
    writeConfig(tempDir, {
      graphile: {
        schema: ['config_schema', 'shared_schema'],
      },
      api: {
        exposedSchemas: ['public', 'shared'],
        metaSchemas: ['metaschema_public', 'services_public', 'config_meta'],
      },
    });

    const testEnv: NodeJS.ProcessEnv = {
      GRAPHILE_SCHEMA: 'shared_schema,env_schema',
      API_EXPOSED_SCHEMAS: 'shared,env_schema',
      API_META_SCHEMAS: 'services_public,env_meta',
    };

    const result = getEnvOptions(
      {
        graphile: {
          schema: ['override_schema', 'shared_schema'],
        },
        api: {
          exposedSchemas: ['public', 'override_schema'],
          metaSchemas: ['env_meta', 'override_meta'],
        },
      },
      tempDir,
      testEnv
    );

    // Arrays are replaced, not merged - overrides win completely
    expect(result.graphile?.schema).toEqual([
      'override_schema',
      'shared_schema',
    ]);
    expect(result.api?.exposedSchemas).toEqual(['public', 'override_schema']);
    expect(result.api?.metaSchemas).toEqual(['env_meta', 'override_meta']);
  });

  it('composes server, storage, jobs, and SMTP ownership layers', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphql-env-domains-'));
    writeConfig(tempDir, {
      server: {
        host: 'config-server',
        port: 4000,
      },
      cdn: {
        bucketName: 'config-bucket',
      },
      jobs: {
        schema: {
          schema: 'config_jobs',
        },
      },
      smtp: {
        host: 'config-smtp',
      },
    });

    const result = getConstructiveEnvOptions(
      {
        server: {
          port: 6000,
        },
        cdn: {
          publicUrlPrefix: 'https://override.example.test',
        },
      },
      tempDir,
      {
        SERVER_HOST: 'env-server',
        PORT: '5000',
        BUCKET_NAME: 'env-bucket',
        JOBS_SCHEMA: 'env_jobs',
        SMTP_HOST: 'env-smtp',
      }
    );

    expect(result.server?.host).toBe('env-server');
    expect(result.server?.port).toBe(6000);
    expect(result.cdn?.bucketName).toBe('env-bucket');
    expect(result.cdn?.publicUrlPrefix).toBe('https://override.example.test');
    expect(result.jobs?.schema?.schema).toBe('env_jobs');
    expect(result.smtp?.host).toBe('env-smtp');
  });

  it.each([
    ['empty', '', 3000],
    ['invalid', 'not-a-port', 3000],
    ['zero', '0', 0],
  ])('handles %s PORT values', (_label, port, expected) => {
    const result = getConstructiveEnvOptions({}, process.cwd(), { PORT: port });

    expect(result.server?.port).toBe(expected);
  });
});
