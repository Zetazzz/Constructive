import deepmerge from 'deepmerge';
import {
  ConstructiveOptions,
  constructiveDefaults,
} from '@constructive-io/graphql-types';
import { getPgpmEnvOptions, loadConfigSync, replaceArrays } from '@pgpmjs/env';
import { setLogScopes } from '@pgpmjs/logger';
import { getGraphQLEnvVars } from './env';

const CONSTRUCTIVE_OPTION_KEYS = [
  'graphile',
  'features',
  'api',
  'server',
  'cdn',
  'jobs',
  'smtp',
  'mailgun',
  'graphqlClient',
  'functions',
  'runtime',
  'knative',
  'observability',
  'captcha',
  'graphileRuntime',
  'codegen',
  'llm',
] as const;

const LOG_SCOPE_SOURCE_PRIORITY = {
  config: 1,
  env: 2,
  override: 3,
} as const;

let appliedLogScopePriority = 0;

const applyResolvedLogScope = (
  logScope: string | undefined,
  priority: number
): void => {
  if (logScope === undefined || priority < appliedLogScopePriority) return;

  setLogScopes(
    logScope
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean)
  );
  appliedLogScopePriority = priority;
};

const projectConstructiveOptions = (
  options: unknown
): Partial<ConstructiveOptions> => {
  if (!options || typeof options !== 'object') return {};

  const source = options as Record<string, unknown>;
  const projected: Record<string, unknown> = {};

  for (const key of CONSTRUCTIVE_OPTION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      projected[key] = source[key];
    }
  }

  return projected as Partial<ConstructiveOptions>;
};

const normalizeRuntimeSecretsPath = (
  options: Partial<ConstructiveOptions>
): Partial<ConstructiveOptions> => {
  const configuredPath = options.runtime?.envSecretsPath;
  if (configuredPath === undefined) return options;

  const runtime = { ...options.runtime };
  const normalizedPath = configuredPath.trim() || undefined;
  if (normalizedPath === undefined) {
    delete runtime.envSecretsPath;
  } else {
    runtime.envSecretsPath = normalizedPath;
  }

  return { ...options, runtime };
};

const resolveDerivedOptions = (
  options: ConstructiveOptions
): ConstructiveOptions => {
  const gateway = options.jobs?.gateway;
  if (gateway && gateway.callbackUrl === undefined) {
    const host = gateway.callbackHost ?? 'jobs-callback';
    const port = gateway.callbackPort ?? 12345;
    gateway.callbackUrl = `http://${host}:${port}/callback`;
  }

  const graphqlClient = options.graphqlClient;
  if (graphqlClient?.url && graphqlClient.metaUrl === undefined) {
    graphqlClient.metaUrl = graphqlClient.url;
  }

  const samplerInterval = options.observability?.debugSamplerIntervalMs;
  if (
    samplerInterval !== undefined &&
    (!Number.isFinite(samplerInterval) || samplerInterval < 1000)
  ) {
    options.observability!.debugSamplerIntervalMs = 10000;
  }

  const graphileRuntime = (options.graphileRuntime ??= {});
  if (graphileRuntime.cacheTtlMs === undefined) {
    graphileRuntime.cacheTtlMs =
      options.runtime?.nodeEnv === 'development'
        ? 5 * 60 * 1000
        : 366 * 24 * 60 * 60 * 1000;
  }

  return options;
};

/**
 * Resolve the complete Constructive configuration.
 *
 * Precedence, from lowest to highest:
 * 1. PGPM and Constructive defaults
 * 2. PGPM-owned config file and environment values
 * 3. Constructive-owned config file values
 * 4. Constructive environment values
 * 5. Runtime overrides
 */
const resolveConstructiveEnvOptions = (
  overrides: Partial<ConstructiveOptions> = {},
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): ConstructiveOptions => {
  const coreOptions = getPgpmEnvOptions({}, cwd, env);
  const configOptions = normalizeRuntimeSecretsPath(
    projectConstructiveOptions(loadConfigSync(cwd))
  );
  const normalizedOverrides = normalizeRuntimeSecretsPath(overrides);
  const overrideSecretsPath = normalizedOverrides.runtime?.envSecretsPath;
  const environmentSecretsPath = env.ENV_SECRETS_PATH?.trim() || undefined;
  const configSecretsPath = configOptions.runtime?.envSecretsPath;
  const secretsPath =
    overrideSecretsPath ?? environmentSecretsPath ?? configSecretsPath;
  const envOptions = getGraphQLEnvVars(
    secretsPath === undefined ? env : { ...env, ENV_SECRETS_PATH: secretsPath }
  );

  const logScopePriority =
    overrides.runtime?.logScope !== undefined
      ? LOG_SCOPE_SOURCE_PRIORITY.override
      : envOptions.runtime?.logScope !== undefined
        ? LOG_SCOPE_SOURCE_PRIORITY.env
        : configOptions.runtime?.logScope !== undefined
          ? LOG_SCOPE_SOURCE_PRIORITY.config
          : 0;

  const merged = deepmerge.all(
    [
      constructiveDefaults,
      coreOptions,
      configOptions,
      envOptions,
      normalizedOverrides,
    ],
    { arrayMerge: replaceArrays }
  ) as ConstructiveOptions;

  const resolved = resolveDerivedOptions(merged);
  applyResolvedLogScope(resolved.runtime?.logScope, logScopePriority);
  return resolved;
};

/** Canonical Constructive resolver and its short-name alias. */
export const getConstructiveEnvOptions = resolveConstructiveEnvOptions;
export const getEnvOptions = getConstructiveEnvOptions;
