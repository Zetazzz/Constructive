import type {
  ConstructiveNodeEnv,
  ConstructiveOptions,
  KnativeRuntimeOptions,
  StorageProvider,
  TestEnvironmentOptions,
} from '@constructive-io/graphql-types';
import { readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';

export const parseEnvNumber = (value?: string): number | undefined => {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseEnvBoolean = (value?: string): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return undefined;
};

export const getNodeEnv = (
  env: NodeJS.ProcessEnv = process.env
): ConstructiveNodeEnv => {
  const value = env.NODE_ENV?.toLowerCase();
  if (value === 'production' || value === 'test') return value;
  return 'development';
};

const getPort = (
  defaultPort: number,
  env: NodeJS.ProcessEnv = process.env,
  allowZero = true
): number => {
  const port = parseEnvNumber(env.PORT);
  if (port === undefined || (!allowZero && port <= 0)) return defaultPort;
  return port;
};

/** Resolve PORT using the default of the process that consumes it. */
export const getGraphQLServerPort = (
  env: NodeJS.ProcessEnv = process.env
): number => getPort(3000, env);

export const getSendEmailPort = (
  env: NodeJS.ProcessEnv = process.env
): number => getPort(8080, env);

export const getSendVerificationLinkPort = (
  env: NodeJS.ProcessEnv = process.env
): number => getPort(8080, env);

export const getKnativeJobExamplePort = (
  env: NodeJS.ProcessEnv = process.env
): number => getPort(10101, env, false);

const parseStringArray = (value?: string): string[] | undefined => {
  if (!value) return undefined;
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
};

const parseStringRecord = (
  value?: string
): Record<string, string> | undefined => {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return undefined;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    );
  } catch {
    return undefined;
  }
};

const parsePortMap = (value?: string): Record<string, number> | undefined => {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const entries = Object.entries(parsed).flatMap(([name, rawPort]) => {
        const port = parseEnvNumber(String(rawPort));
        return port !== undefined ? [[name, port] as const] : [];
      });
      return entries.length ? Object.fromEntries(entries) : undefined;
    } catch {
      return undefined;
    }
  }

  const entries = trimmed.split(',').flatMap((pair) => {
    const [name, rawPort] = pair.split(/[:=]/).map((item) => item.trim());
    const port = parseEnvNumber(rawPort);
    return name && port !== undefined ? [[name, port] as const] : [];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
};

export const getSecretFileCandidates = (
  env: NodeJS.ProcessEnv,
  fileVariable: string,
  conventionalName?: string
): string[] => {
  const configuredSecretsPath = env.ENV_SECRETS_PATH?.trim() || undefined;
  const secretsPath = configuredSecretsPath ?? '/run/secrets';
  const configuredPath = env[fileVariable];
  const allowConventionalSecret =
    env === process.env || configuredSecretsPath !== undefined;
  return [
    configuredPath &&
      (isAbsolute(configuredPath)
        ? configuredPath
        : resolve(secretsPath, configuredPath)),
    allowConventionalSecret &&
      conventionalName &&
      resolve(secretsPath, conventionalName),
  ].filter((value): value is string => Boolean(value));
};

const readSecret = (
  env: NodeJS.ProcessEnv,
  fileVariable: string,
  conventionalName?: string
): string | undefined => {
  const candidates = getSecretFileCandidates(
    env,
    fileVariable,
    conventionalName
  );

  for (const candidate of candidates) {
    try {
      const value = readFileSync(candidate, 'utf8').trim();
      if (value) return value;
    } catch {
      // Missing secret files are treated as unset and validated by consumers.
    }
  }
  return undefined;
};

const normalizeDirectSecret = (value?: string): string | undefined =>
  value?.trim() || undefined;

const resolveMailgunKey = (env: NodeJS.ProcessEnv): string | undefined =>
  readSecret(env, 'MAILGUN_KEY_FILE', 'MAILGUN_KEY') ??
  normalizeDirectSecret(env.MAILGUN_KEY) ??
  readSecret(env, 'MAILGUN_API_KEY_FILE', 'MAILGUN_API_KEY') ??
  normalizeDirectSecret(env.MAILGUN_API_KEY);

const parseKnativeFunctions = (
  value?: string
): KnativeRuntimeOptions['functions'] => {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized === '*' || normalized.toLowerCase() === 'all') return 'all';
  return parseStringArray(normalized);
};

const parseStorageProvider = (value?: string): StorageProvider | undefined => {
  if (
    value === 's3' ||
    value === 'minio' ||
    value === 'r2' ||
    value === 'gcs' ||
    value === 'spaces'
  ) {
    return value;
  }
  return undefined;
};

/** Parse every production environment group owned by graphql-env. */
export const getGraphQLEnvVars = (
  env: NodeJS.ProcessEnv = process.env
): Partial<ConstructiveOptions> => {
  const {
    GRAPHILE_SCHEMA,
    FEATURES_SIMPLE_INFLECTION,
    FEATURES_OPPOSITE_BASE_NAMES,
    FEATURES_POSTGIS,
    API_ENABLE_SERVICES,
    API_IS_PUBLIC,
    API_EXPOSED_SCHEMAS,
    API_META_SCHEMAS,
    API_ANON_ROLE,
    API_ROLE_NAME,
    API_DEFAULT_DATABASE_ID,
    PORT,
    SERVER_HOST,
    SERVER_TRUST_PROXY,
    SERVER_ORIGIN,
    SERVER_STRICT_AUTH,
    BUCKET_PROVIDER,
    BUCKET_NAME,
    AWS_REGION,
    AWS_ACCESS_KEY,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_KEY,
    AWS_SECRET_ACCESS_KEY,
    CDN_ENDPOINT,
    CDN_PUBLIC_URL_PREFIX,
    JOBS_SCHEMA,
    JOBS_SUPPORT_ANY,
    JOBS_SUPPORTED,
    HOSTNAME,
    INTERNAL_GATEWAY_URL,
    INTERNAL_GATEWAY_DEVELOPMENT_MAP,
    INTERNAL_JOBS_CALLBACK_URL,
    INTERNAL_JOBS_CALLBACK_PORT,
    JOBS_CALLBACK_HOST,
    KNATIVE_SERVICE_URL,
    SMTP_HOST,
    SMTP_PORT,
    SMTP_SECURE,
    SMTP_USER,
    SMTP_PASS,
    SMTP_FROM,
    SMTP_REPLY_TO,
    SMTP_REQUIRE_TLS,
    SMTP_TLS_REJECT_UNAUTHORIZED,
    SMTP_POOL,
    SMTP_MAX_CONNECTIONS,
    SMTP_MAX_MESSAGES,
    SMTP_NAME,
    SMTP_LOGGER,
    SMTP_DEBUG,
    MAILGUN_DOMAIN,
    MAILGUN_FROM,
    MAILGUN_REPLY,
    MAILGUN_DEV_EMAIL,
    GRAPHQL_URL,
    META_GRAPHQL_URL,
    GRAPHQL_AUTH_TOKEN,
    GRAPHQL_HOST_HEADER,
    META_GRAPHQL_HOST_HEADER,
    GRAPHQL_API_NAME,
    GRAPHQL_SCHEMATA,
    SEND_EMAIL_DRY_RUN,
    SIMPLE_EMAIL_DRY_RUN,
    SEND_VERIFICATION_LINK_DRY_RUN,
    SEND_EMAIL_LINK_DRY_RUN,
    EMAIL_SEND_USE_SMTP,
    DEFAULT_DATABASE_ID,
    LOCAL_APP_PORT,
    CONSTRUCTIVE_JOBS_ENABLED,
    CONSTRUCTIVE_FUNCTIONS,
    CONSTRUCTIVE_FUNCTION_PORTS,
    EMBEDDER_PROVIDER,
    EMBEDDER_MODEL,
    EMBEDDER_BASE_URL,
    CHAT_PROVIDER,
    CHAT_MODEL,
    CHAT_BASE_URL,
    GRAPHQL_OBSERVABILITY_ENABLED,
    GRAPHQL_DEBUG_SAMPLER_ENABLED,
    GRAPHQL_DEBUG_SAMPLER_INTERVAL_MS,
    GRAPHQL_DEBUG_SAMPLER_DIR,
    RECAPTCHA_SECRET_KEY,
    GRAPHILE_CACHE_MAX,
    GRAPHILE_CACHE_TTL_MS,
    ENABLE_SIGNATURE_VERIFICATION,
    INFLECTOR_LOG,
    JITI_DEBUG,
    ENV_SECRETS_PATH,
    LOG_SCOPE,
  } = env;

  const runtimePort = parseEnvNumber(PORT);
  const storageProvider = parseStorageProvider(BUCKET_PROVIDER);
  const jobsSupportAny = parseEnvBoolean(JOBS_SUPPORT_ANY);
  const jobsSupported = parseStringArray(JOBS_SUPPORTED);
  const gatewayUrl = INTERNAL_GATEWAY_URL || KNATIVE_SERVICE_URL;
  const developmentMap = parseStringRecord(INTERNAL_GATEWAY_DEVELOPMENT_MAP);
  const jobsCallbackPort = parseEnvNumber(INTERNAL_JOBS_CALLBACK_PORT);
  const mailgunKey = resolveMailgunKey(env);
  const sendEmailDryRun = parseEnvBoolean(
    SEND_EMAIL_DRY_RUN ?? SIMPLE_EMAIL_DRY_RUN
  );
  const verificationDryRun = parseEnvBoolean(
    SEND_VERIFICATION_LINK_DRY_RUN ?? SEND_EMAIL_LINK_DRY_RUN
  );
  const useSmtp = parseEnvBoolean(EMAIL_SEND_USE_SMTP);
  const samplerInterval = parseEnvNumber(GRAPHQL_DEBUG_SAMPLER_INTERVAL_MS);
  const envSecretsPath = ENV_SECRETS_PATH?.trim() || undefined;
  const featuresSimpleInflection = parseEnvBoolean(FEATURES_SIMPLE_INFLECTION);
  const featuresOppositeBaseNames = parseEnvBoolean(
    FEATURES_OPPOSITE_BASE_NAMES
  );
  const featuresPostgis = parseEnvBoolean(FEATURES_POSTGIS);
  const apiEnableServices = parseEnvBoolean(API_ENABLE_SERVICES);
  const apiIsPublic = parseEnvBoolean(API_IS_PUBLIC);
  const serverTrustProxy = parseEnvBoolean(SERVER_TRUST_PROXY);
  const serverStrictAuth = parseEnvBoolean(SERVER_STRICT_AUTH);
  const smtpPort = parseEnvNumber(SMTP_PORT);
  const smtpSecure = parseEnvBoolean(SMTP_SECURE);
  const smtpRequireTls = parseEnvBoolean(SMTP_REQUIRE_TLS);
  const smtpRejectUnauthorized = parseEnvBoolean(SMTP_TLS_REJECT_UNAUTHORIZED);
  const smtpPool = parseEnvBoolean(SMTP_POOL);
  const smtpMaxConnections = parseEnvNumber(SMTP_MAX_CONNECTIONS);
  const smtpMaxMessages = parseEnvNumber(SMTP_MAX_MESSAGES);
  const smtpLogger = parseEnvBoolean(SMTP_LOGGER);
  const smtpDebug = parseEnvBoolean(SMTP_DEBUG);
  const localAppPort = parseEnvNumber(LOCAL_APP_PORT);
  const knativeJobsEnabled = parseEnvBoolean(CONSTRUCTIVE_JOBS_ENABLED);
  const observabilityEnabled = parseEnvBoolean(GRAPHQL_OBSERVABILITY_ENABLED);
  const samplerEnabled = parseEnvBoolean(GRAPHQL_DEBUG_SAMPLER_ENABLED);
  const graphileCacheMax = parseEnvNumber(GRAPHILE_CACHE_MAX);
  const graphileCacheTtlMs = parseEnvNumber(GRAPHILE_CACHE_TTL_MS);
  const signatureVerification = parseEnvBoolean(ENABLE_SIGNATURE_VERIFICATION);
  const inflectorLog = parseEnvBoolean(INFLECTOR_LOG);
  const jitiDebug = parseEnvBoolean(JITI_DEBUG);

  return {
    graphile: {
      ...(GRAPHILE_SCHEMA && {
        schema: GRAPHILE_SCHEMA.includes(',')
          ? GRAPHILE_SCHEMA.split(',').map((value) => value.trim())
          : GRAPHILE_SCHEMA,
      }),
    },
    features: {
      ...(featuresSimpleInflection !== undefined && {
        simpleInflection: featuresSimpleInflection,
      }),
      ...(featuresOppositeBaseNames !== undefined && {
        oppositeBaseNames: featuresOppositeBaseNames,
      }),
      ...(featuresPostgis !== undefined && { postgis: featuresPostgis }),
    },
    api: {
      ...(apiEnableServices !== undefined && {
        enableServicesApi: apiEnableServices,
      }),
      ...(apiIsPublic !== undefined && { isPublic: apiIsPublic }),
      ...(API_EXPOSED_SCHEMAS && {
        exposedSchemas: parseStringArray(API_EXPOSED_SCHEMAS),
      }),
      ...(API_META_SCHEMAS && {
        metaSchemas: parseStringArray(API_META_SCHEMAS),
      }),
      ...(API_ANON_ROLE && { anonRole: API_ANON_ROLE }),
      ...(API_ROLE_NAME && { roleName: API_ROLE_NAME }),
      ...(API_DEFAULT_DATABASE_ID && {
        defaultDatabaseId: API_DEFAULT_DATABASE_ID,
      }),
    },
    server: {
      ...(runtimePort !== undefined && { port: runtimePort }),
      ...(SERVER_HOST && { host: SERVER_HOST }),
      ...(serverTrustProxy !== undefined && { trustProxy: serverTrustProxy }),
      ...(SERVER_ORIGIN && { origin: SERVER_ORIGIN }),
      ...(serverStrictAuth !== undefined && { strictAuth: serverStrictAuth }),
    },
    cdn: {
      ...(storageProvider && { provider: storageProvider }),
      ...(BUCKET_NAME && { bucketName: BUCKET_NAME }),
      ...(AWS_REGION && { awsRegion: AWS_REGION }),
      ...((AWS_ACCESS_KEY || AWS_ACCESS_KEY_ID) && {
        awsAccessKey: AWS_ACCESS_KEY || AWS_ACCESS_KEY_ID,
      }),
      ...((AWS_SECRET_KEY || AWS_SECRET_ACCESS_KEY) && {
        awsSecretKey: AWS_SECRET_KEY || AWS_SECRET_ACCESS_KEY,
      }),
      ...(CDN_ENDPOINT && { endpoint: CDN_ENDPOINT }),
      ...(CDN_PUBLIC_URL_PREFIX && { publicUrlPrefix: CDN_PUBLIC_URL_PREFIX }),
    },
    jobs: {
      ...(JOBS_SCHEMA && { schema: { schema: JOBS_SCHEMA } }),
      ...((jobsSupportAny !== undefined || jobsSupported || HOSTNAME) && {
        worker: {
          ...(jobsSupportAny !== undefined && { supportAny: jobsSupportAny }),
          ...(jobsSupported && { supported: jobsSupported }),
          ...(HOSTNAME && { hostname: HOSTNAME }),
        },
        scheduler: {
          ...(jobsSupportAny !== undefined && { supportAny: jobsSupportAny }),
          ...(jobsSupported && { supported: jobsSupported }),
          ...(HOSTNAME && { hostname: HOSTNAME }),
        },
      }),
      ...((gatewayUrl ||
        INTERNAL_JOBS_CALLBACK_URL ||
        INTERNAL_JOBS_CALLBACK_PORT ||
        JOBS_CALLBACK_HOST ||
        developmentMap ||
        KNATIVE_SERVICE_URL) && {
        gateway: {
          ...(gatewayUrl && { gatewayUrl }),
          ...(INTERNAL_JOBS_CALLBACK_URL && {
            callbackUrl: INTERNAL_JOBS_CALLBACK_URL,
          }),
          ...(jobsCallbackPort !== undefined && {
            callbackPort: jobsCallbackPort,
          }),
          ...(JOBS_CALLBACK_HOST && { callbackHost: JOBS_CALLBACK_HOST }),
          ...(developmentMap && { developmentMap }),
          ...(KNATIVE_SERVICE_URL && {
            knativeServiceUrl: KNATIVE_SERVICE_URL,
          }),
        },
      }),
    },
    smtp: {
      ...(SMTP_HOST && { host: SMTP_HOST }),
      ...(smtpPort !== undefined && { port: smtpPort }),
      ...(smtpSecure !== undefined && { secure: smtpSecure }),
      ...(SMTP_USER && { user: SMTP_USER }),
      ...(SMTP_PASS && { pass: SMTP_PASS }),
      ...(SMTP_FROM && { from: SMTP_FROM }),
      ...(SMTP_REPLY_TO && { replyTo: SMTP_REPLY_TO }),
      ...(smtpRequireTls !== undefined && { requireTLS: smtpRequireTls }),
      ...(smtpRejectUnauthorized !== undefined && {
        tlsRejectUnauthorized: smtpRejectUnauthorized,
      }),
      ...(smtpPool !== undefined && { pool: smtpPool }),
      ...(smtpMaxConnections !== undefined && {
        maxConnections: smtpMaxConnections,
      }),
      ...(smtpMaxMessages !== undefined && { maxMessages: smtpMaxMessages }),
      ...(SMTP_NAME && { name: SMTP_NAME }),
      ...(smtpLogger !== undefined && { logger: smtpLogger }),
      ...(smtpDebug !== undefined && { debug: smtpDebug }),
    },
    ...((mailgunKey ||
      MAILGUN_DOMAIN ||
      MAILGUN_FROM ||
      MAILGUN_REPLY ||
      MAILGUN_DEV_EMAIL) && {
      mailgun: {
        ...(mailgunKey && { key: mailgunKey }),
        ...(MAILGUN_DOMAIN && { domain: MAILGUN_DOMAIN }),
        ...(MAILGUN_FROM && { from: MAILGUN_FROM }),
        ...(MAILGUN_REPLY && { replyTo: MAILGUN_REPLY }),
        ...(MAILGUN_DEV_EMAIL && { devEmail: MAILGUN_DEV_EMAIL }),
      },
    }),
    ...((GRAPHQL_URL ||
      META_GRAPHQL_URL ||
      GRAPHQL_AUTH_TOKEN ||
      GRAPHQL_HOST_HEADER ||
      META_GRAPHQL_HOST_HEADER ||
      GRAPHQL_API_NAME ||
      GRAPHQL_SCHEMATA) && {
      graphqlClient: {
        ...(GRAPHQL_URL && { url: GRAPHQL_URL }),
        ...(META_GRAPHQL_URL && { metaUrl: META_GRAPHQL_URL }),
        ...(GRAPHQL_AUTH_TOKEN && { authToken: GRAPHQL_AUTH_TOKEN }),
        ...(GRAPHQL_HOST_HEADER && { hostHeader: GRAPHQL_HOST_HEADER }),
        ...(META_GRAPHQL_HOST_HEADER && {
          metaHostHeader: META_GRAPHQL_HOST_HEADER,
        }),
        ...(GRAPHQL_API_NAME && { apiName: GRAPHQL_API_NAME }),
        ...(GRAPHQL_SCHEMATA && { schemata: GRAPHQL_SCHEMATA }),
      },
    }),
    functions: {
      ...(useSmtp !== undefined && { useSmtp }),
      ...(sendEmailDryRun !== undefined && {
        sendEmail: { dryRun: sendEmailDryRun },
      }),
      ...((verificationDryRun !== undefined ||
        DEFAULT_DATABASE_ID ||
        LOCAL_APP_PORT) && {
        sendVerificationLink: {
          ...(verificationDryRun !== undefined && {
            dryRun: verificationDryRun,
          }),
          ...(DEFAULT_DATABASE_ID && {
            defaultDatabaseId: DEFAULT_DATABASE_ID,
          }),
          ...(localAppPort !== undefined && { localAppPort }),
        },
      }),
    },
    runtime: {
      ...(env.NODE_ENV !== undefined && { nodeEnv: getNodeEnv(env) }),
      ...(runtimePort !== undefined && { port: runtimePort }),
      ...(envSecretsPath && { envSecretsPath }),
      ...(LOG_SCOPE && { logScope: LOG_SCOPE }),
    },
    knative: {
      ...(knativeJobsEnabled !== undefined && {
        jobsEnabled: knativeJobsEnabled,
      }),
      ...(CONSTRUCTIVE_FUNCTIONS && {
        functions: parseKnativeFunctions(CONSTRUCTIVE_FUNCTIONS),
      }),
      ...(CONSTRUCTIVE_FUNCTION_PORTS && {
        functionPorts: parsePortMap(CONSTRUCTIVE_FUNCTION_PORTS),
      }),
    },
    llm: {
      ...((EMBEDDER_PROVIDER || EMBEDDER_MODEL || EMBEDDER_BASE_URL) && {
        embedder: {
          ...(EMBEDDER_PROVIDER && { provider: EMBEDDER_PROVIDER }),
          ...(EMBEDDER_MODEL && { model: EMBEDDER_MODEL }),
          ...(EMBEDDER_BASE_URL && { baseUrl: EMBEDDER_BASE_URL }),
        },
      }),
      ...((CHAT_PROVIDER || CHAT_MODEL || CHAT_BASE_URL) && {
        chat: {
          ...(CHAT_PROVIDER && { provider: CHAT_PROVIDER }),
          ...(CHAT_MODEL && { model: CHAT_MODEL }),
          ...(CHAT_BASE_URL && { baseUrl: CHAT_BASE_URL }),
        },
      }),
    },
    observability: {
      ...(observabilityEnabled !== undefined && {
        enabled: observabilityEnabled,
      }),
      ...(samplerEnabled !== undefined && {
        debugSamplerEnabled: samplerEnabled,
      }),
      ...(samplerInterval !== undefined && {
        debugSamplerIntervalMs:
          samplerInterval >= 1000 ? samplerInterval : 10000,
      }),
      ...(GRAPHQL_DEBUG_SAMPLER_DIR && {
        debugSamplerDir: GRAPHQL_DEBUG_SAMPLER_DIR,
      }),
    },
    ...(RECAPTCHA_SECRET_KEY && {
      captcha: { recaptchaSecretKey: RECAPTCHA_SECRET_KEY },
    }),
    graphileRuntime: {
      ...(graphileCacheMax !== undefined && { cacheMax: graphileCacheMax }),
      ...(graphileCacheTtlMs !== undefined && {
        cacheTtlMs: graphileCacheTtlMs,
      }),
      ...(signatureVerification !== undefined && { signatureVerification }),
      ...(inflectorLog !== undefined && { inflectorLog }),
    },
    ...(jitiDebug !== undefined && { codegen: { jitiDebug } }),
  };
};

/** Parse test-harness variables without adding them to production defaults. */
export const getTestEnvOptions = (
  env: NodeJS.ProcessEnv = process.env
): TestEnvironmentOptions => ({
  ...(env.SMTP_TEST_USE_CATCHER && {
    smtpUseCatcher: parseEnvBoolean(env.SMTP_TEST_USE_CATCHER),
  }),
  ...(env.SMTP_TEST_FROM && { smtpFrom: env.SMTP_TEST_FROM }),
  ...(env.SMTP_TEST_TO && { smtpTo: env.SMTP_TEST_TO }),
  ...(env.SMTP_TEST_SUBJECT && { smtpSubject: env.SMTP_TEST_SUBJECT }),
  ...(env.SMTP_TEST_HTML && { smtpHtml: env.SMTP_TEST_HTML }),
  ...(env.SMTP_TEST_TEXT && { smtpText: env.SMTP_TEST_TEXT }),
  graphqlUrl:
    env.TEST_GRAPHQL_URL ?? env.GRAPHQL_URL ?? 'http://localhost:3000/graphql',
  ...((env.TEST_GRAPHQL_HOST || env.GRAPHQL_HOST) && {
    graphqlHost: env.TEST_GRAPHQL_HOST || env.GRAPHQL_HOST,
  }),
  ...(env.TEST_DATABASE_ID && { databaseId: env.TEST_DATABASE_ID }),
  liveGraphqlEndpoint:
    env.GRAPHQL_TEST_ENDPOINT ?? 'http://api.localhost:3000/graphql',
  ...(env.GRAPHQL_TEST_EMAIL && { liveGraphqlEmail: env.GRAPHQL_TEST_EMAIL }),
  ...(env.GRAPHQL_TEST_PASSWORD && {
    liveGraphqlPassword: env.GRAPHQL_TEST_PASSWORD,
  }),
  ...(env.GRAPHQL_TEST_LIVE_REQUIRED && {
    liveGraphqlRequired: parseEnvBoolean(env.GRAPHQL_TEST_LIVE_REQUIRED),
  }),
  ...(env.TESTING_URL && { testingUrl: env.TESTING_URL }),
  ...(env.TEST_DB && { testDb: env.TEST_DB }),
  ...(env.GRAPHQL_HOST && { jobsGraphqlHost: env.GRAPHQL_HOST }),
});
