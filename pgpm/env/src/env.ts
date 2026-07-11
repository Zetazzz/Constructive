import { DeploymentOptions, PgpmOptions } from '@pgpmjs/types';

export const parseEnvNumber = (val?: string): number | undefined => {
  const num = Number(val);
  return !isNaN(num) ? num : undefined;
};

export const parseEnvBoolean = (val?: string): boolean | undefined => {
  if (val === undefined) return undefined;
  return ['true', '1', 'yes'].includes(val.toLowerCase());
};

const parseDeploymentHashMethod = (
  val?: string
): DeploymentOptions['hashMethod'] | undefined => {
  return val === 'content' || val === 'ast' ? val : undefined;
};

/**
 * Parse core PGPM environment variables.
 * GraphQL-related env vars (GRAPHILE_*, FEATURES_*, API_*) are handled by @constructive-io/graphql-env.
 *
 * @param env - Environment object to read from (defaults to process.env)
 */
export const getEnvVars = (
  env: NodeJS.ProcessEnv = process.env
): PgpmOptions => {
  const {
    PGROOTDATABASE,
    PGTEMPLATE,
    DB_PREFIX,
    DB_EXTENSIONS,
    DB_CWD,
    DB_CONNECTIONS_APP_USER,
    DB_CONNECTIONS_APP_PASSWORD,
    DB_CONNECTIONS_ADMIN_USER,
    DB_CONNECTIONS_ADMIN_PASSWORD,

    PGHOST,
    PGPORT,
    PGUSER,
    PGPASSWORD,
    PGDATABASE,

    DEPLOYMENT_USE_TX,
    DEPLOYMENT_FAST,
    DEPLOYMENT_USE_PLAN,
    DEPLOYMENT_CACHE,
    DEPLOYMENT_TO_CHANGE,
    DEPLOYMENT_HASH_METHOD,

    MIGRATIONS_CODEGEN_USE_TX,

    // Error output formatting env vars
    PGPM_ERROR_QUERY_HISTORY_LIMIT,
    PGPM_ERROR_MAX_LENGTH,
    PGPM_ERROR_VERBOSE,
  } = env;

  const hashMethod = parseDeploymentHashMethod(DEPLOYMENT_HASH_METHOD);

  return {
    db: {
      ...(PGROOTDATABASE && { rootDb: PGROOTDATABASE }),
      ...(PGTEMPLATE && { template: PGTEMPLATE }),
      ...(DB_PREFIX && { prefix: DB_PREFIX }),
      ...(DB_EXTENSIONS && {
        extensions: DB_EXTENSIONS.split(',').map((ext) => ext.trim()),
      }),
      ...(DB_CWD && { cwd: DB_CWD }),
      ...((DB_CONNECTIONS_APP_USER ||
        DB_CONNECTIONS_APP_PASSWORD ||
        DB_CONNECTIONS_ADMIN_USER ||
        DB_CONNECTIONS_ADMIN_PASSWORD) && {
        connections: {
          ...((DB_CONNECTIONS_APP_USER || DB_CONNECTIONS_APP_PASSWORD) && {
            app: {
              ...(DB_CONNECTIONS_APP_USER && { user: DB_CONNECTIONS_APP_USER }),
              ...(DB_CONNECTIONS_APP_PASSWORD && {
                password: DB_CONNECTIONS_APP_PASSWORD,
              }),
            },
          }),
          ...((DB_CONNECTIONS_ADMIN_USER || DB_CONNECTIONS_ADMIN_PASSWORD) && {
            admin: {
              ...(DB_CONNECTIONS_ADMIN_USER && {
                user: DB_CONNECTIONS_ADMIN_USER,
              }),
              ...(DB_CONNECTIONS_ADMIN_PASSWORD && {
                password: DB_CONNECTIONS_ADMIN_PASSWORD,
              }),
            },
          }),
        },
      }),
    },
    pg: {
      ...(PGHOST && { host: PGHOST }),
      ...(PGPORT && { port: parseEnvNumber(PGPORT) }),
      ...(PGUSER && { user: PGUSER }),
      ...(PGPASSWORD && { password: PGPASSWORD }),
      ...(PGDATABASE && { database: PGDATABASE }),
    },
    deployment: {
      ...(DEPLOYMENT_USE_TX && { useTx: parseEnvBoolean(DEPLOYMENT_USE_TX) }),
      ...(DEPLOYMENT_FAST && { fast: parseEnvBoolean(DEPLOYMENT_FAST) }),
      ...(DEPLOYMENT_USE_PLAN && {
        usePlan: parseEnvBoolean(DEPLOYMENT_USE_PLAN),
      }),
      ...(DEPLOYMENT_CACHE && { cache: parseEnvBoolean(DEPLOYMENT_CACHE) }),
      ...(DEPLOYMENT_TO_CHANGE && { toChange: DEPLOYMENT_TO_CHANGE }),
      ...(hashMethod && { hashMethod }),
    },
    migrations: {
      ...(MIGRATIONS_CODEGEN_USE_TX && {
        codegen: {
          useTx: parseEnvBoolean(MIGRATIONS_CODEGEN_USE_TX),
        },
      }),
    },
    errorOutput: {
      ...(PGPM_ERROR_QUERY_HISTORY_LIMIT && {
        queryHistoryLimit: parseEnvNumber(PGPM_ERROR_QUERY_HISTORY_LIMIT),
      }),
      ...(PGPM_ERROR_MAX_LENGTH && {
        maxLength: parseEnvNumber(PGPM_ERROR_MAX_LENGTH),
      }),
      ...(PGPM_ERROR_VERBOSE && {
        verbose: parseEnvBoolean(PGPM_ERROR_VERBOSE),
      }),
    },
  };
};
