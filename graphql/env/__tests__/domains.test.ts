import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  getConstructiveEnvOptions,
  getSecretFileCandidates,
  getGraphQLEnvVars,
  getGraphQLServerPort,
  getKnativeJobExamplePort,
  getSendEmailPort,
  getSendVerificationLinkPort,
  getTestEnvOptions,
} from '../src';

describe('Constructive environment domains', () => {
  let tempDir = '';

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('parses storage aliases, jobs, SMTP, functions, and runtime groups', () => {
    const result = getGraphQLEnvVars({
      BUCKET_PROVIDER: 'r2',
      BUCKET_NAME: 'assets',
      AWS_ACCESS_KEY: 'preferred-access',
      AWS_ACCESS_KEY_ID: 'fallback-access',
      AWS_SECRET_KEY: 'preferred-secret',
      AWS_SECRET_ACCESS_KEY: 'fallback-secret',
      JOBS_SCHEMA: 'queue',
      JOBS_SUPPORT_ANY: 'false',
      JOBS_SUPPORTED: 'email, thumbnail',
      HOSTNAME: 'worker-a',
      KNATIVE_SERVICE_URL: 'http://knative.internal',
      INTERNAL_JOBS_CALLBACK_PORT: '4321',
      JOBS_CALLBACK_HOST: 'callback.internal',
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '2525',
      SMTP_SECURE: 'false',
      SMTP_MAX_CONNECTIONS: '4',
      SEND_EMAIL_DRY_RUN: 'true',
      EMAIL_SEND_USE_SMTP: 'yes',
      DEFAULT_DATABASE_ID: 'db-id',
      LOCAL_APP_PORT: '5173',
      PORT: '8080',
      NODE_ENV: 'development',
      LOG_SCOPE: 'jobs:*',
    });

    expect(result.cdn).toMatchObject({
      provider: 'r2',
      bucketName: 'assets',
      awsAccessKey: 'preferred-access',
      awsSecretKey: 'preferred-secret',
    });
    expect(result.jobs).toMatchObject({
      schema: { schema: 'queue' },
      worker: {
        supportAny: false,
        supported: ['email', 'thumbnail'],
        hostname: 'worker-a',
      },
      scheduler: { hostname: 'worker-a' },
      gateway: {
        gatewayUrl: 'http://knative.internal',
        callbackPort: 4321,
        callbackHost: 'callback.internal',
      },
    });
    expect(result.smtp).toMatchObject({
      host: 'smtp.example.test',
      port: 2525,
      secure: false,
      maxConnections: 4,
    });
    expect(result.functions).toEqual({
      useSmtp: true,
      sendEmail: { dryRun: true },
      sendVerificationLink: {
        defaultDatabaseId: 'db-id',
        localAppPort: 5173,
      },
    });
    expect(result.runtime).toMatchObject({
      nodeEnv: 'development',
      port: 8080,
      logScope: 'jobs:*',
    });
  });

  it('parses provider credentials and outbound GraphQL settings without requiring them globally', () => {
    expect(() =>
      getConstructiveEnvOptions({}, process.cwd(), {})
    ).not.toThrow();

    const result = getGraphQLEnvVars({
      MAILGUN_API_KEY: 'api-key-alias',
      MAILGUN_DOMAIN: 'mg.example.test',
      MAILGUN_FROM: 'sender@example.test',
      GRAPHQL_URL: 'http://graphql.internal/graphql',
      GRAPHQL_AUTH_TOKEN: 'private-token',
      GRAPHQL_API_NAME: 'tenant',
      GRAPHQL_SCHEMATA: 'app_public,app_private',
    });

    expect(result.mailgun).toEqual({
      key: 'api-key-alias',
      domain: 'mg.example.test',
      from: 'sender@example.test',
    });
    expect(result.graphqlClient).toEqual({
      url: 'http://graphql.internal/graphql',
      authToken: 'private-token',
      apiName: 'tenant',
      schemata: 'app_public,app_private',
    });
  });

  it('resolves secret files from the supplied environment and preserves precedence', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphql-env-secret-'));
    const keyFile = path.join(tempDir, 'mailgun-key');
    fs.writeFileSync(keyFile, 'file-key\n');

    const result = getGraphQLEnvVars({
      MAILGUN_KEY_FILE: keyFile,
      MAILGUN_KEY: 'inline-key',
      MAILGUN_API_KEY: 'alias-key',
    });

    expect(result.mailgun?.key).toBe('file-key');
  });

  it('treats blank inline Mailgun keys as unset while preserving alias precedence', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphql-env-secret-'));
    const aliasKeyFile = path.join(tempDir, 'mailgun-api-key');
    fs.writeFileSync(aliasKeyFile, 'alias-file-key\n');

    expect(
      getGraphQLEnvVars({
        MAILGUN_KEY: ' \t\n ',
        MAILGUN_API_KEY_FILE: aliasKeyFile,
        MAILGUN_API_KEY: 'alias-inline-key',
      }).mailgun?.key
    ).toBe('alias-file-key');
    expect(
      getGraphQLEnvVars({
        MAILGUN_KEY: ' \t\n ',
        MAILGUN_API_KEY: '  alias-inline-key  ',
      }).mailgun?.key
    ).toBe('alias-inline-key');
    expect(
      getGraphQLEnvVars({
        MAILGUN_KEY: '  primary-inline-key  ',
        MAILGUN_API_KEY_FILE: aliasKeyFile,
      }).mailgun?.key
    ).toBe('primary-inline-key');
    expect(
      getGraphQLEnvVars({ MAILGUN_API_KEY: ' \t\n ' }).mailgun
    ).toBeUndefined();
  });

  it('does not probe conventional host secret files for an injected empty environment', () => {
    expect(
      getSecretFileCandidates({}, 'MAILGUN_KEY_FILE', 'MAILGUN_KEY')
    ).toEqual([]);
  });

  it('treats blank injected secret paths as unset while preserving explicit file candidates', () => {
    const absoluteFile = path.join(os.tmpdir(), 'explicit-mailgun-key');

    for (const blankPath of ['', ' \t\n ']) {
      const blankPathEnv = { ENV_SECRETS_PATH: blankPath };

      expect(
        getSecretFileCandidates(blankPathEnv, 'MAILGUN_KEY_FILE', 'MAILGUN_KEY')
      ).toEqual([]);
      expect(getGraphQLEnvVars(blankPathEnv).runtime?.envSecretsPath).toBe(
        undefined
      );
      expect(
        getSecretFileCandidates(
          { ...blankPathEnv, MAILGUN_KEY_FILE: absoluteFile },
          'MAILGUN_KEY_FILE',
          'MAILGUN_KEY'
        )
      ).toEqual([absoluteFile]);
      expect(
        getSecretFileCandidates(
          { ...blankPathEnv, MAILGUN_KEY_FILE: 'explicit-mailgun-key' },
          'MAILGUN_KEY_FILE',
          'MAILGUN_KEY'
        )
      ).toEqual(['/run/secrets/explicit-mailgun-key']);
    }
  });

  it('resolves relative and missing secret files without blocking valid fallbacks', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphql-env-secrets-'));
    fs.writeFileSync(path.join(tempDir, 'mailgun-api-key'), 'api-file-key\n');
    fs.writeFileSync(path.join(tempDir, 'empty-key'), '  \n');

    expect(
      getGraphQLEnvVars({
        ENV_SECRETS_PATH: tempDir,
        MAILGUN_API_KEY_FILE: 'mailgun-api-key',
      }).mailgun?.key
    ).toBe('api-file-key');

    expect(
      getGraphQLEnvVars({
        ENV_SECRETS_PATH: tempDir,
        MAILGUN_KEY_FILE: 'missing-key',
        MAILGUN_KEY: 'inline-fallback',
      }).mailgun?.key
    ).toBe('inline-fallback');

    expect(
      getGraphQLEnvVars({
        ENV_SECRETS_PATH: tempDir,
        MAILGUN_KEY_FILE: 'empty-key',
        MAILGUN_KEY: 'empty-file-fallback',
      }).mailgun?.key
    ).toBe('empty-file-fallback');
  });

  it('uses config and runtime override secret paths before reading relative files', () => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'graphql-env-secret-layers-')
    );
    const configSecrets = path.join(tempDir, 'config-secrets');
    const overrideSecrets = path.join(tempDir, 'override-secrets');
    fs.mkdirSync(configSecrets);
    fs.mkdirSync(overrideSecrets);
    fs.writeFileSync(path.join(configSecrets, 'mailgun-key'), 'config-key\n');
    fs.writeFileSync(
      path.join(overrideSecrets, 'mailgun-key'),
      'override-key\n'
    );
    fs.writeFileSync(
      path.join(tempDir, 'pgpm.json'),
      JSON.stringify({ runtime: { envSecretsPath: `  ${configSecrets}\n` } })
    );

    expect(
      getConstructiveEnvOptions({}, tempDir, {
        MAILGUN_KEY_FILE: 'mailgun-key',
      }).mailgun?.key
    ).toBe('config-key');

    for (const blankPath of ['', ' \t\n ']) {
      const result = getConstructiveEnvOptions({}, tempDir, {
        ENV_SECRETS_PATH: blankPath,
        MAILGUN_KEY_FILE: 'mailgun-key',
      });

      expect(result.mailgun?.key).toBe('config-key');
      expect(result.runtime?.envSecretsPath).toBe(configSecrets);
    }

    const blankOverrideResult = getConstructiveEnvOptions(
      { runtime: { envSecretsPath: ' \t\n ', port: 4321 } },
      tempDir,
      { MAILGUN_KEY_FILE: 'mailgun-key' }
    );
    expect(blankOverrideResult.mailgun?.key).toBe('config-key');
    expect(blankOverrideResult.runtime?.envSecretsPath).toBe(configSecrets);
    expect(blankOverrideResult.runtime?.port).toBe(4321);

    const spacedOverrideResult = getConstructiveEnvOptions(
      { runtime: { envSecretsPath: `  ${overrideSecrets}\n` } },
      tempDir,
      { MAILGUN_KEY_FILE: 'mailgun-key' }
    );
    expect(spacedOverrideResult.mailgun?.key).toBe('override-key');
    expect(spacedOverrideResult.runtime?.envSecretsPath).toBe(overrideSecrets);

    expect(
      getConstructiveEnvOptions(
        { runtime: { envSecretsPath: overrideSecrets } },
        tempDir,
        { MAILGUN_KEY_FILE: 'mailgun-key' }
      ).mailgun?.key
    ).toBe('override-key');

    fs.writeFileSync(
      path.join(tempDir, 'pgpm.json'),
      JSON.stringify({ runtime: { envSecretsPath: ' \t\n ' } })
    );
    expect(
      getConstructiveEnvOptions({}, tempDir, {}).runtime?.envSecretsPath
    ).toBeUndefined();
  });

  it('parses Knative, LLM, observability, Graphile, CAPTCHA, and tooling switches', () => {
    const result = getGraphQLEnvVars({
      CONSTRUCTIVE_JOBS_ENABLED: 'false',
      CONSTRUCTIVE_FUNCTIONS: 'send-email, send-verification-link',
      CONSTRUCTIVE_FUNCTION_PORTS:
        '{"send-email":8081,"send-verification-link":"8082","bad":"x"}',
      EMBEDDER_MODEL: 'model-without-provider',
      CHAT_BASE_URL: 'https://chat.example.test',
      GRAPHQL_OBSERVABILITY_ENABLED: 'true',
      GRAPHQL_DEBUG_SAMPLER_ENABLED: 'false',
      GRAPHQL_DEBUG_SAMPLER_INTERVAL_MS: '500',
      GRAPHQL_DEBUG_SAMPLER_DIR: './debug-output',
      RECAPTCHA_SECRET_KEY: 'captcha-secret',
      GRAPHILE_CACHE_MAX: '75',
      GRAPHILE_CACHE_TTL_MS: '60000',
      ENABLE_SIGNATURE_VERIFICATION: 'true',
      INFLECTOR_LOG: '1',
      JITI_DEBUG: 'yes',
    });

    expect(result.knative).toEqual({
      jobsEnabled: false,
      functions: ['send-email', 'send-verification-link'],
      functionPorts: {
        'send-email': 8081,
        'send-verification-link': 8082,
      },
    });
    expect(result.llm).toEqual({
      embedder: { model: 'model-without-provider' },
      chat: { baseUrl: 'https://chat.example.test' },
    });
    expect(result.observability).toEqual({
      enabled: true,
      debugSamplerEnabled: false,
      debugSamplerIntervalMs: 10000,
      debugSamplerDir: './debug-output',
    });
    expect(result.captcha).toEqual({ recaptchaSecretKey: 'captcha-secret' });
    expect(result.graphileRuntime).toEqual({
      cacheMax: 75,
      cacheTtlMs: 60000,
      signatureVerification: true,
      inflectorLog: true,
    });
    expect(result.codegen).toEqual({ jitiDebug: true });
  });

  it('ignores invalid provider, number, boolean, map, and port-map values', () => {
    const result = getGraphQLEnvVars({
      BUCKET_PROVIDER: 'unknown',
      SMTP_PORT: 'not-a-number',
      SMTP_SECURE: 'maybe',
      INTERNAL_GATEWAY_DEVELOPMENT_MAP: 'not-json',
      CONSTRUCTIVE_FUNCTION_PORTS: 'send-email=bad',
      GRAPHILE_CACHE_MAX: 'NaN',
    });

    expect(result.cdn?.provider).toBeUndefined();
    expect(result.smtp?.port).toBeUndefined();
    expect(result.smtp?.secure).toBeUndefined();
    expect(result.jobs?.gateway?.developmentMap).toBeUndefined();
    expect(result.knative?.functionPorts).toBeUndefined();
    expect(result.graphileRuntime?.cacheMax).toBeUndefined();
  });

  it('preserves aliases and resolves cross-layer gateway and client fallbacks after merging', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphql-env-derived-'));
    fs.writeFileSync(
      path.join(tempDir, 'pgpm.json'),
      JSON.stringify({
        jobs: { gateway: { callbackPort: 9999 } },
        graphqlClient: {
          metaUrl: 'http://config-meta/graphql',
        },
      })
    );

    const result = getConstructiveEnvOptions({}, tempDir, {
      AWS_ACCESS_KEY_ID: 'fallback-access',
      AWS_SECRET_ACCESS_KEY: 'fallback-secret',
      INTERNAL_GATEWAY_URL: 'http://canonical-gateway',
      KNATIVE_SERVICE_URL: 'http://gateway-alias',
      JOBS_CALLBACK_HOST: 'callback.internal',
      GRAPHQL_URL: 'http://env/graphql',
      SIMPLE_EMAIL_DRY_RUN: 'true',
      SEND_EMAIL_DRY_RUN: 'false',
      SEND_EMAIL_LINK_DRY_RUN: 'true',
      SEND_VERIFICATION_LINK_DRY_RUN: 'false',
    });

    expect(result.cdn).toMatchObject({
      awsAccessKey: 'fallback-access',
      awsSecretKey: 'fallback-secret',
    });
    expect(result.jobs?.gateway).toMatchObject({
      gatewayUrl: 'http://canonical-gateway',
      callbackHost: 'callback.internal',
      callbackPort: 9999,
      callbackUrl: 'http://callback.internal:9999/callback',
    });
    expect(result.graphqlClient).toEqual({
      url: 'http://env/graphql',
      metaUrl: 'http://config-meta/graphql',
    });
    expect(result.functions).toMatchObject({
      sendEmail: { dryRun: false },
      sendVerificationLink: { dryRun: false },
    });
  });

  it('lets an explicit callback URL win over derived host and port fields', () => {
    const result = getConstructiveEnvOptions({}, process.cwd(), {
      INTERNAL_JOBS_CALLBACK_URL: 'https://callback.example.test/done',
      INTERNAL_JOBS_CALLBACK_PORT: '9999',
      JOBS_CALLBACK_HOST: 'ignored-host',
    });

    expect(result.jobs?.gateway?.callbackUrl).toBe(
      'https://callback.example.test/done'
    );
  });

  it('merges every Constructive config section before env and overrides', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphql-env-config-'));
    fs.writeFileSync(
      path.join(tempDir, 'pgpm.json'),
      JSON.stringify({
        cdn: { bucketName: 'config-bucket' },
        jobs: { worker: { supported: ['config-job'] } },
        smtp: { host: 'config-smtp' },
        mailgun: { domain: 'config-mailgun' },
        graphqlClient: { url: 'http://config/graphql' },
        functions: { sendEmail: { dryRun: true } },
        knative: { jobsEnabled: false },
        observability: { enabled: true },
        graphileRuntime: { cacheMax: 20 },
        llm: { chat: { model: 'config-chat' } },
      })
    );

    const result = getConstructiveEnvOptions(
      {
        jobs: { worker: { supported: ['override-job'] } },
        smtp: { host: 'override-smtp' },
      },
      tempDir,
      {
        BUCKET_NAME: 'env-bucket',
        GRAPHILE_CACHE_MAX: '30',
      }
    );

    expect(result.cdn?.bucketName).toBe('env-bucket');
    expect(result.jobs?.worker?.supported).toEqual(['override-job']);
    expect(result.smtp?.host).toBe('override-smtp');
    expect(result.mailgun?.domain).toBe('config-mailgun');
    expect(result.graphqlClient?.url).toBe('http://config/graphql');
    expect(result.functions?.sendEmail?.dryRun).toBe(true);
    expect(result.knative?.jobsEnabled).toBe(false);
    expect(result.observability?.enabled).toBe(true);
    expect(result.graphileRuntime?.cacheMax).toBe(30);
    expect(result.llm?.chat?.model).toBe('config-chat');
  });

  it('keeps PORT defaults process-specific', () => {
    expect(getGraphQLServerPort({})).toBe(3000);
    expect(getSendEmailPort({})).toBe(8080);
    expect(getSendVerificationLinkPort({})).toBe(8080);
    expect(getKnativeJobExamplePort({})).toBe(10101);
    expect(getGraphQLServerPort({ PORT: '0' })).toBe(0);
    expect(getKnativeJobExamplePort({ PORT: '0' })).toBe(10101);
  });

  it('keeps the Graphile cache TTL default runtime-sensitive', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphql-env-runtime-'));
    fs.writeFileSync(
      path.join(tempDir, 'pgpm.json'),
      JSON.stringify({ runtime: { nodeEnv: 'production' } })
    );

    expect(
      getConstructiveEnvOptions({}, process.cwd(), {
        NODE_ENV: 'development',
      }).graphileRuntime?.cacheTtlMs
    ).toBe(5 * 60 * 1000);
    expect(
      getConstructiveEnvOptions({}, tempDir, {}).graphileRuntime?.cacheTtlMs
    ).toBe(366 * 24 * 60 * 60 * 1000);
    expect(
      getConstructiveEnvOptions(
        { runtime: { nodeEnv: 'production' } },
        process.cwd(),
        { NODE_ENV: 'development' }
      ).graphileRuntime?.cacheTtlMs
    ).toBe(366 * 24 * 60 * 60 * 1000);
    expect(
      getConstructiveEnvOptions({}, process.cwd(), {
        NODE_ENV: 'production',
      }).graphileRuntime?.cacheTtlMs
    ).toBe(366 * 24 * 60 * 60 * 1000);
    expect(
      getConstructiveEnvOptions({}, process.cwd(), {
        NODE_ENV: 'development',
        GRAPHILE_CACHE_TTL_MS: 'invalid',
      }).graphileRuntime?.cacheTtlMs
    ).toBe(5 * 60 * 1000);
  });

  it('enforces the debug sampler minimum after config and overrides merge', () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graphql-env-sampler-'));
    fs.writeFileSync(
      path.join(tempDir, 'pgpm.json'),
      JSON.stringify({
        observability: { debugSamplerIntervalMs: 500 },
      })
    );

    expect(
      getConstructiveEnvOptions({}, tempDir, {}).observability
        ?.debugSamplerIntervalMs
    ).toBe(10000);
    expect(
      getConstructiveEnvOptions(
        { observability: { debugSamplerIntervalMs: 999 } },
        process.cwd(),
        {}
      ).observability?.debugSamplerIntervalMs
    ).toBe(10000);
  });

  it('keeps test-only parsing in a separate resolver', () => {
    const result = getTestEnvOptions({
      SMTP_TEST_USE_CATCHER: 'true',
      SMTP_TEST_FROM: 'sender@example.test',
      SMTP_TEST_TO: 'recipient@example.test',
      SMTP_TEST_SUBJECT: 'subject',
      SMTP_TEST_HTML: '<p>html</p>',
      SMTP_TEST_TEXT: 'text',
      TEST_GRAPHQL_URL: 'http://test/graphql',
      GRAPHQL_HOST: 'tenant.example.test',
      TEST_DATABASE_ID: 'database-id',
      GRAPHQL_TEST_ENDPOINT: 'http://live/graphql',
      GRAPHQL_TEST_EMAIL: 'live@example.test',
      GRAPHQL_TEST_PASSWORD: 'test-secret',
      GRAPHQL_TEST_LIVE_REQUIRED: '1',
      TESTING_URL: 'http://react/graphql',
      TEST_DB: 'existing_test_db',
    });

    expect(result).toMatchObject({
      smtpUseCatcher: true,
      smtpFrom: 'sender@example.test',
      smtpTo: 'recipient@example.test',
      smtpSubject: 'subject',
      smtpHtml: '<p>html</p>',
      smtpText: 'text',
      graphqlUrl: 'http://test/graphql',
      graphqlHost: 'tenant.example.test',
      databaseId: 'database-id',
      liveGraphqlEndpoint: 'http://live/graphql',
      liveGraphqlEmail: 'live@example.test',
      liveGraphqlPassword: 'test-secret',
      liveGraphqlRequired: true,
      testingUrl: 'http://react/graphql',
      testDb: 'existing_test_db',
    });
  });
});
