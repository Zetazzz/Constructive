# @constructive-io/graphql-env

<p align="center" width="100%">
  <img height="250" src="https://raw.githubusercontent.com/constructive-io/constructive/refs/heads/main/assets/outline-logo.svg" />
</p>

The single environment-configuration entrypoint for Constructive applications and runtimes.

`@constructive-io/graphql-env` calls the lower-level `@pgpmjs/env` resolver and returns one complete `ConstructiveOptions` object. It owns parsing for GraphQL plus the surrounding Constructive runtime domains; it does not create separate storage, jobs, SMTP, function, or provider env packages.

## Usage

```typescript
import { getConstructiveEnvOptions } from '@constructive-io/graphql-env';

const options = getConstructiveEnvOptions({
  graphile: { schema: ['public', 'app'] },
  features: { simpleInflection: true }
});
```

`getEnvOptions` is the exact short-name alias of `getConstructiveEnvOptions`.

The merge order is:

```text
Constructive and PGPM defaults
→ PGPM-owned config and environment values
→ Constructive sections from pgpm.json
→ Constructive environment values
→ runtime overrides
```

Arrays are replaced by the later layer rather than concatenated.

## Ownership boundary

- `@pgpmjs/env` owns PostgreSQL connections, test databases, PGPM workspace/package settings, deployment, migrations, and PGPM error formatting.
- `@constructive-io/graphql-env` owns all remaining Constructive environment parsing, including server/API, storage, jobs, email providers, functions, observability, Graphile switches, codegen, and LLM settings.
- Types and defaults for the complete result live in `@constructive-io/graphql-types`.

This intentionally means a jobs, storage, SMTP, or function runtime may depend on this package. The accepted tradeoff is a somewhat broader resolver dependency in exchange for one source of truth and no additional env packages.

## Configuration groups

The aggregate recognizes these groups:

- GraphQL and API: `GRAPHILE_*`, `FEATURES_*`, `API_*`, `SERVER_*`, and GraphQL server `PORT`.
- Storage/CDN: `BUCKET_*`, `AWS_REGION`, AWS access-key aliases, `CDN_ENDPOINT`, and `CDN_PUBLIC_URL_PREFIX`.
- Jobs: `JOBS_*`, `HOSTNAME`, `INTERNAL_GATEWAY_*`, `INTERNAL_JOBS_CALLBACK_*`, `JOBS_CALLBACK_HOST`, and `KNATIVE_SERVICE_URL`.
- Knative host startup: `CONSTRUCTIVE_JOBS_ENABLED`, `CONSTRUCTIVE_FUNCTIONS`, and `CONSTRUCTIVE_FUNCTION_PORTS`.
- SMTP: all `SMTP_*` transport, authentication, TLS, pool, and debug settings.
- Mailgun: `MAILGUN_KEY`, `MAILGUN_API_KEY`, their `_FILE` forms, `MAILGUN_DOMAIN`, `MAILGUN_FROM`, `MAILGUN_REPLY`, `MAILGUN_DEV_EMAIL`, and `ENV_SECRETS_PATH`.
- Outbound GraphQL clients: `GRAPHQL_URL`, `META_GRAPHQL_URL`, `GRAPHQL_AUTH_TOKEN`, routing host headers, API name, and schemata.
- Functions: dry-run aliases, `EMAIL_SEND_USE_SMTP`, `DEFAULT_DATABASE_ID`, and `LOCAL_APP_PORT`.
- Runtime: `NODE_ENV`, `PORT`, and `LOG_SCOPE`.
- LLM: `EMBEDDER_*` and `CHAT_*`.
- GraphQL diagnostics: observability, debug sampler, and `RECAPTCHA_SECRET_KEY`.
- Graphile/tooling: cache settings, signature verification, inflector logging, and `JITI_DEBUG`.

Provider credentials and function-required URLs remain optional in the aggregate. The provider or function validates them only on a code path that actually needs them, so selecting SMTP does not require Mailgun and importing a function does not require an outbound GraphQL URL.

Resolving the complete aggregate applies `runtime.logScope` to the shared logger, so config-file and runtime overrides have the same effect as `LOG_SCOPE`.

## Process-specific `PORT`

`PORT` is parsed once as a raw runtime value, but its default belongs to the process that binds the socket. Use the exported helpers:

```typescript
import {
  getGraphQLServerPort,
  getSendEmailPort,
  getSendVerificationLinkPort,
  getKnativeJobExamplePort
} from '@constructive-io/graphql-env';
```

The defaults are respectively `3000`, `8080`, `8080`, and `10101`. Embedded Knative functions continue receiving explicit host-service ports instead of consulting global `PORT`.

## Test-only variables

Test harness inputs are parsed separately so they do not become production defaults:

```typescript
import { getTestEnvOptions } from '@constructive-io/graphql-env';

const testOptions = getTestEnvOptions();
```

This covers `SMTP_TEST_*`, jobs GraphQL test routing, live GraphQL test credentials, `TESTING_URL`, and `TEST_DB`. Callers must not log or snapshot password/token fields.

## Parsing helpers

The package also exports `parseEnvBoolean`, `parseEnvNumber`, and `getNodeEnv`. PGPM retains its own lower-level helpers because `@pgpmjs/env` cannot depend upward on this package.
