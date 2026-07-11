/** Supported object-storage providers. */
export type StorageProvider = 's3' | 'minio' | 'r2' | 'gcs' | 'spaces';

/** Connection details consumed by S3-compatible storage clients. */
export interface StorageConnectionConfig {
  provider: StorageProvider;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

/** CDN and S3-compatible storage configuration. */
export interface CDNOptions {
  provider?: StorageProvider;
  bucketName?: string;
  awsRegion?: string;
  awsAccessKey?: string;
  awsSecretKey?: string;
  endpoint?: string;
  publicUrlPrefix?: string;
}

export const cdnDefaults: Required<CDNOptions> = {
  provider: 'minio',
  bucketName: 'test-bucket',
  awsRegion: 'us-east-1',
  awsAccessKey: 'minioadmin',
  awsSecretKey: 'minioadmin',
  endpoint: 'http://localhost:9000',
  publicUrlPrefix: 'http://localhost:9000',
};

export interface JobSchemaConfig {
  schema: string;
}

export interface JobHostnameConfig {
  hostname: string;
}

export interface JobTaskSupportConfig {
  supportAny: boolean;
  supported: string[];
}

export interface JobGatewayConfig {
  gatewayUrl: string;
  callbackUrl: string;
  callbackPort: number;
  callbackHost?: string;
  developmentMap?: Record<string, string>;
  knativeServiceUrl?: string;
}

export interface JobWorkerConfig
  extends JobSchemaConfig, JobHostnameConfig, JobTaskSupportConfig {
  pollInterval?: number;
  gracefulShutdown?: boolean;
}

export interface JobSchedulerConfig
  extends JobSchemaConfig, JobHostnameConfig, JobTaskSupportConfig {
  pollInterval?: number;
  gracefulShutdown?: boolean;
}

export interface JobsConfig {
  schema?: Partial<JobSchemaConfig>;
  worker?: Partial<JobWorkerConfig>;
  scheduler?: Partial<JobSchedulerConfig>;
  gateway?: Partial<JobGatewayConfig>;
}

export const jobsDefaults: JobsConfig = {
  schema: { schema: 'app_jobs' },
  worker: {
    schema: 'app_jobs',
    hostname: 'worker-0',
    supportAny: true,
    supported: [],
    pollInterval: 1000,
    gracefulShutdown: true,
  },
  scheduler: {
    schema: 'app_jobs',
    hostname: 'scheduler-0',
    supportAny: true,
    supported: [],
    pollInterval: 1000,
    gracefulShutdown: true,
  },
  gateway: {
    gatewayUrl: 'http://gateway:8080',
    callbackPort: 12345,
    callbackHost: 'jobs-callback',
  },
};

/** Job operation DTOs shared by the jobs runtime helpers. */
export interface FailJobParams {
  workerId: string;
  jobId: number | string;
  message: string;
}

export interface CompleteJobParams {
  workerId: string;
  jobId: number | string;
}

export interface GetJobParams {
  workerId: string;
  supportedTaskNames: string[] | null;
}

export type GetScheduledJobParams = GetJobParams;

export interface RunScheduledJobParams {
  jobId: number | string;
}

export interface ReleaseScheduledJobsParams {
  workerId: string;
  ids?: Array<number | string>;
}

export interface ReleaseJobsParams {
  workerId: string;
}

export interface Job {
  id: number | string;
  task_name: string;
  payload?: unknown;
  worker_id?: string;
  max_attempts?: number;
  attempts?: number;
  priority?: number;
  created_at?: Date | string;
  updated_at?: Date | string;
  run_at?: Date | string;
  last_error?: string;
}

export interface SmtpOptions {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
  replyTo?: string;
  requireTLS?: boolean;
  tlsRejectUnauthorized?: boolean;
  pool?: boolean;
  maxConnections?: number;
  maxMessages?: number;
  name?: string;
  logger?: boolean;
  debug?: boolean;
}

export const smtpDefaults: SmtpOptions = {
  port: 587,
  secure: false,
  pool: false,
  logger: false,
  debug: false,
};

export interface MailgunOptions {
  key?: string;
  domain?: string;
  from?: string;
  replyTo?: string;
  devEmail?: string;
}

export interface OutboundGraphQLClientOptions {
  url?: string;
  metaUrl?: string;
  authToken?: string;
  hostHeader?: string;
  metaHostHeader?: string;
  apiName?: string;
  schemata?: string;
}

export interface EmailFunctionOptions {
  dryRun?: boolean;
}

export interface VerificationFunctionOptions extends EmailFunctionOptions {
  defaultDatabaseId?: string;
  localAppPort?: number;
}

export interface FunctionRuntimeOptions {
  useSmtp?: boolean;
  sendEmail?: EmailFunctionOptions;
  sendVerificationLink?: VerificationFunctionOptions;
}

export const functionRuntimeDefaults: FunctionRuntimeOptions = {
  useSmtp: false,
  sendEmail: { dryRun: false },
  sendVerificationLink: { dryRun: false },
};

export type ConstructiveNodeEnv = 'development' | 'production' | 'test';

export interface RuntimeOptions {
  nodeEnv?: ConstructiveNodeEnv;
  port?: number;
  envSecretsPath?: string;
  logScope?: string;
}

export const runtimeDefaults: RuntimeOptions = {
  nodeEnv: 'development',
};

export interface KnativeRuntimeOptions {
  jobsEnabled?: boolean;
  functions?: 'all' | string[];
  functionPorts?: Record<string, number>;
}

export const knativeRuntimeDefaults: KnativeRuntimeOptions = {
  jobsEnabled: true,
};

export interface GraphqlObservabilityOptions {
  enabled?: boolean;
  debugSamplerEnabled?: boolean;
  debugSamplerIntervalMs?: number;
  debugSamplerDir?: string;
}

export const graphqlObservabilityDefaults: GraphqlObservabilityOptions = {
  enabled: false,
  debugSamplerEnabled: true,
  debugSamplerIntervalMs: 10000,
};

export interface CaptchaOptions {
  recaptchaSecretKey?: string;
}

export interface GraphileRuntimeOptions {
  cacheMax?: number;
  cacheTtlMs?: number;
  signatureVerification?: boolean;
  inflectorLog?: boolean;
}

export const graphileRuntimeDefaults: GraphileRuntimeOptions = {
  cacheMax: 50,
  signatureVerification: false,
  inflectorLog: false,
};

export interface CodegenEnvironmentOptions {
  jitiDebug?: boolean;
}

/** Test-harness inputs parsed separately by graphql-env. */
export interface TestEnvironmentOptions {
  smtpUseCatcher?: boolean;
  smtpFrom?: string;
  smtpTo?: string;
  smtpSubject?: string;
  smtpHtml?: string;
  smtpText?: string;
  graphqlUrl?: string;
  graphqlHost?: string;
  databaseId?: string;
  liveGraphqlEndpoint?: string;
  liveGraphqlEmail?: string;
  liveGraphqlPassword?: string;
  liveGraphqlRequired?: boolean;
  testingUrl?: string;
  testDb?: string;
  jobsGraphqlHost?: string;
}
