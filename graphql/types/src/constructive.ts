import deepmerge from 'deepmerge';
import { PgConfig } from 'pg-env';
import {
  PgpmOptions,
  pgpmDefaults,
  PgTestConnectionOptions,
  DeploymentOptions,
  MigrationOptions,
} from '@pgpmjs/types';
import {
  GraphileOptions,
  GraphileFeatureOptions,
  ApiOptions,
  graphileDefaults,
  graphileFeatureDefaults,
  apiDefaults,
} from './graphile';
import {
  CaptchaOptions,
  CDNOptions,
  cdnDefaults,
  CodegenEnvironmentOptions,
  FunctionRuntimeOptions,
  functionRuntimeDefaults,
  GraphileRuntimeOptions,
  graphileRuntimeDefaults,
  GraphqlObservabilityOptions,
  graphqlObservabilityDefaults,
  JobsConfig,
  jobsDefaults,
  KnativeRuntimeOptions,
  knativeRuntimeDefaults,
  MailgunOptions,
  OutboundGraphQLClientOptions,
  RuntimeOptions,
  runtimeDefaults,
  SmtpOptions,
  smtpDefaults,
} from './environment';
import { LlmOptions, llmDefaults } from './llm';

/**
 * GraphQL HTTP server configuration.
 */
export interface ServerOptions {
  /** Server host address */
  host?: string;
  /** Server port number */
  port?: number;
  /** Whether to trust proxy headers */
  trustProxy?: boolean;
  /** CORS origin configuration */
  origin?: string;
  /** Whether to enforce strict authentication */
  strictAuth?: boolean;
}

/**
 * GraphQL-specific options for Constructive
 */
export interface ConstructiveGraphQLOptions {
  /** PostGraphile/Graphile configuration */
  graphile?: GraphileOptions;
  /** Feature flags and toggles for GraphQL */
  features?: GraphileFeatureOptions;
  /** API configuration options */
  api?: ApiOptions;
  /** GraphQL HTTP server configuration */
  server?: ServerOptions;
}

/**
 * Full Constructive configuration options
 * Extends PgpmOptions with GraphQL/Graphile configuration
 */
export interface ConstructiveOptions
  extends PgpmOptions, ConstructiveGraphQLOptions {
  /** Test database configuration options */
  db?: Partial<PgTestConnectionOptions>;
  /** PostgreSQL connection configuration */
  pg?: Partial<PgConfig>;
  /** PostGraphile/Graphile configuration */
  graphile?: GraphileOptions;
  /** HTTP server configuration */
  server?: ServerOptions;
  /** Feature flags and toggles for GraphQL */
  features?: GraphileFeatureOptions;
  /** API configuration options */
  api?: ApiOptions;
  /** CDN and file storage configuration */
  cdn?: CDNOptions;
  /** Module deployment configuration */
  deployment?: DeploymentOptions;
  /** Migration and code generation options */
  migrations?: MigrationOptions;
  /** Job system configuration */
  jobs?: JobsConfig;
  /** SMTP email configuration */
  smtp?: SmtpOptions;
  /** Mailgun provider configuration */
  mailgun?: MailgunOptions;
  /** Outbound GraphQL client configuration used by functions and jobs */
  graphqlClient?: OutboundGraphQLClientOptions;
  /** Function behavior and provider-selection configuration */
  functions?: FunctionRuntimeOptions;
  /** Shared process runtime values */
  runtime?: RuntimeOptions;
  /** Knative host-process configuration */
  knative?: KnativeRuntimeOptions;
  /** GraphQL observability and sampler configuration */
  observability?: GraphqlObservabilityOptions;
  /** CAPTCHA server configuration */
  captcha?: CaptchaOptions;
  /** Graphile cache and plugin switches */
  graphileRuntime?: GraphileRuntimeOptions;
  /** GraphQL code-generation environment switches */
  codegen?: CodegenEnvironmentOptions;
  /** LLM provider configuration (embeddings, chat, RAG) */
  llm?: LlmOptions;
}

/**
 * Default GraphQL-specific configuration values
 */
export const constructiveGraphqlDefaults: ConstructiveGraphQLOptions = {
  graphile: graphileDefaults,
  features: graphileFeatureDefaults,
  api: apiDefaults,
  server: {
    host: 'localhost',
    port: 3000,
    trustProxy: false,
    strictAuth: false,
  },
};

/**
 * Full default configuration values for Constructive framework
 * Combines PGPM core defaults with GraphQL/Graphile defaults
 */
export const constructiveDefaults: ConstructiveOptions = deepmerge.all([
  pgpmDefaults,
  constructiveGraphqlDefaults,
  {
    cdn: cdnDefaults,
    jobs: jobsDefaults,
    smtp: smtpDefaults,
    functions: functionRuntimeDefaults,
    runtime: runtimeDefaults,
    knative: knativeRuntimeDefaults,
    observability: graphqlObservabilityDefaults,
    graphileRuntime: graphileRuntimeDefaults,
    llm: llmDefaults,
  },
]) as ConstructiveOptions;
