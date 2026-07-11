import { getConstructiveEnvOptions } from '@constructive-io/graphql-env';
import { jobsDefaults } from '@constructive-io/graphql-types';
import { defaultPgConfig, type PgConfig } from 'pg-env';
import { buildConnectionString, getPgPool } from 'pg-cache';
import type { Pool } from 'pg';

// ---- PG config ----
export const getJobPgConfig = (): PgConfig => {
  const opts = getConstructiveEnvOptions();

  return {
    ...defaultPgConfig,
    ...(opts.pg ?? {}),
  };
};

export const getJobPool = (): Pool => getPgPool(getJobPgConfig());

export const getJobConnectionString = (): string => {
  const cfg = getJobPgConfig();
  return buildConnectionString(
    cfg.user,
    cfg.password,
    cfg.host,
    cfg.port,
    cfg.database
  );
};

// ---- Schema ----
export const getJobSchema = (): string => {
  const opts = getConstructiveEnvOptions().jobs ?? {};
  const fromOpts: string | undefined = opts.schema?.schema;
  return fromOpts || jobsDefaults.schema?.schema || 'app_jobs';
};

// ---- SupportAny / Supported ----
export const getJobSupportAny = (): boolean => {
  const opts = getConstructiveEnvOptions().jobs ?? {};
  const worker: boolean | undefined = opts.worker?.supportAny;
  const scheduler: boolean | undefined = opts.scheduler?.supportAny;

  return worker ?? scheduler ?? jobsDefaults.worker?.supportAny ?? true;
};

export const getJobSupported = (): string[] => {
  const opts = getConstructiveEnvOptions().jobs ?? {};
  const worker: string[] | undefined = opts.worker?.supported;
  const scheduler: string[] | undefined = opts.scheduler?.supported;

  return worker ?? scheduler ?? jobsDefaults.worker?.supported ?? [];
};

// ---- Hostnames ----
export const getWorkerHostname = (): string => {
  const opts = getConstructiveEnvOptions().jobs ?? {};
  return opts.worker?.hostname || jobsDefaults.worker?.hostname || 'worker-0';
};

export const getSchedulerHostname = (): string => {
  const opts = getConstructiveEnvOptions().jobs ?? {};
  return (
    opts.scheduler?.hostname ||
    jobsDefaults.scheduler?.hostname ||
    'scheduler-0'
  );
};

// ---- Job gateway config (generic HTTP gateway) ----
export const getJobGatewayConfig = () => {
  const opts = getConstructiveEnvOptions().jobs ?? {};
  const gateway = opts.gateway ?? {};
  const defaults = jobsDefaults.gateway ?? {
    gatewayUrl: 'http://gateway:8080',
    callbackUrl: 'http://jobs-callback:12345/callback',
    callbackPort: 12345,
  };

  return {
    gatewayUrl: gateway.gatewayUrl || defaults.gatewayUrl,
    callbackUrl: gateway.callbackUrl || defaults.callbackUrl,
    callbackPort: gateway.callbackPort ?? defaults.callbackPort,
  };
};

export const getJobGatewayDevMap = (): Record<string, string> | null => {
  return getConstructiveEnvOptions().jobs?.gateway?.developmentMap ?? null;
};

export const getNodeEnvironment = () =>
  getConstructiveEnvOptions().runtime?.nodeEnv ?? 'development';

// Neutral callback helpers (generic HTTP callback)
export const getJobsCallbackPort = (): number => {
  const { callbackPort } = getJobGatewayConfig();
  return callbackPort;
};

export const getCallbackBaseUrl = (): string => {
  const gateway = getConstructiveEnvOptions().jobs?.gateway;
  return gateway?.callbackUrl ?? 'http://jobs-callback:12345/callback';
};
