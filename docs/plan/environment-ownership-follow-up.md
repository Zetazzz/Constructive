# Environment Ownership Decision

**Status:** Accepted and implemented on `refactor/env-ownership`

**Base:** `main` at `a3d87386c`

**Decision date:** 2026-07-11

## Decision

Constructive keeps the existing two-level relationship:

```text
@pgpmjs/env
  └─ @constructive-io/graphql-env
       └─ Constructive applications and runtimes
```

`@pgpmjs/env` remains the lower-level PostgreSQL/PGPM resolver. `@constructive-io/graphql-env` calls it and owns every non-PGPM Constructive environment group.

We intentionally do not add storage, jobs, SMTP, function, provider, or neutral aggregate env packages. Jobs, storage, email, functions, Graphile, tests, and other Constructive runtimes may depend on `graphql-env`. The accepted cost is extra parsing and a broader package dependency; the benefit is one parser, one precedence model, and no ownership ambiguity.

## PGPM boundary

`@pgpmjs/env` owns only:

- PostgreSQL connection defaults and `PG*` variables;
- test-database settings, roles, and app/admin connections;
- PGPM workspace/package configuration;
- deployment and migration options;
- PGPM error-output formatting.

Its canonical resolver is `getPgpmEnvOptions()`. Existing `getEnvOptions()` is the exact same function reference. PGPM projects config, env, and overrides to PGPM-owned keys so a `server`, `cdn`, `jobs`, `smtp`, or GraphQL section cannot leak into a pure PGPM result.

`@pgpmjs/env` must not import `@constructive-io/graphql-env`.

## Constructive boundary

`getConstructiveEnvOptions()` and its alias `getEnvOptions()` return the complete `ConstructiveOptions` object. Callers do not manually combine PGPM and GraphQL results.

Merge precedence is:

```text
Constructive and PGPM defaults
→ PGPM-owned config and environment values
→ Constructive sections from pgpm.json
→ Constructive environment values
→ runtime overrides
```

Later arrays replace earlier arrays.

Types and defaults live in the existing `@constructive-io/graphql-types` package. Parser and merge behavior live in the existing `@constructive-io/graphql-env` package.

## Variables moved into the Constructive aggregate

### Server, GraphQL, and API

- `PORT`, `SERVER_HOST`, `SERVER_TRUST_PROXY`, `SERVER_ORIGIN`, `SERVER_STRICT_AUTH`
- `GRAPHILE_SCHEMA`
- `FEATURES_SIMPLE_INFLECTION`, `FEATURES_OPPOSITE_BASE_NAMES`, `FEATURES_POSTGIS`
- all maintained `API_*` routing, schema, role, visibility, and database defaults

### Storage and CDN

- `BUCKET_PROVIDER`, `BUCKET_NAME`, `AWS_REGION`
- `AWS_ACCESS_KEY` with `AWS_ACCESS_KEY_ID` fallback
- `AWS_SECRET_KEY` with `AWS_SECRET_ACCESS_KEY` fallback
- `CDN_ENDPOINT`, `CDN_PUBLIC_URL_PREFIX`

### Jobs and Knative

- `JOBS_SCHEMA`, `JOBS_SUPPORT_ANY`, `JOBS_SUPPORTED`, `HOSTNAME`
- `INTERNAL_GATEWAY_URL`, `INTERNAL_GATEWAY_DEVELOPMENT_MAP`
- `INTERNAL_JOBS_CALLBACK_URL`, `INTERNAL_JOBS_CALLBACK_PORT`, `JOBS_CALLBACK_HOST`
- `KNATIVE_SERVICE_URL` as the lower-priority gateway URL alias
- `CONSTRUCTIVE_JOBS_ENABLED`, `CONSTRUCTIVE_FUNCTIONS`, `CONSTRUCTIVE_FUNCTION_PORTS`

Gateway precedence is `INTERNAL_GATEWAY_URL` before `KNATIVE_SERVICE_URL`. An explicit callback URL wins; otherwise host and port produce `http://<host>:<port>/callback`. Invalid development maps are ignored without logging the raw value.

### SMTP and Mailgun

- all SMTP host, port, authentication, TLS, pool, client-name, logger, and debug variables;
- `MAILGUN_KEY`, `MAILGUN_KEY_FILE`, `MAILGUN_API_KEY`, `MAILGUN_API_KEY_FILE`;
- `MAILGUN_DOMAIN`, `MAILGUN_FROM`, `MAILGUN_REPLY`, `MAILGUN_DEV_EMAIL`;
- `ENV_SECRETS_PATH`.

Mailgun key precedence is key file, direct canonical key, API-key file, then direct API-key alias. Resolving the aggregate never requires Mailgun or SMTP credentials. The selected provider validates required fields on first use. Secrets must not appear in startup logs, errors, or snapshots.

Secret-directory precedence is runtime override, environment, then config file. Empty or whitespace-only `ENV_SECRETS_PATH` is treated as unset and cannot hide a configured directory or make an injected environment probe the current working directory.

### Outbound GraphQL clients and functions

- `GRAPHQL_URL`, `META_GRAPHQL_URL`, `GRAPHQL_AUTH_TOKEN`
- `GRAPHQL_HOST_HEADER`, `META_GRAPHQL_HOST_HEADER`
- `GRAPHQL_API_NAME`, `GRAPHQL_SCHEMATA`
- `SEND_EMAIL_DRY_RUN`, `SIMPLE_EMAIL_DRY_RUN`
- `SEND_VERIFICATION_LINK_DRY_RUN`, `SEND_EMAIL_LINK_DRY_RUN`
- `EMAIL_SEND_USE_SMTP`, `DEFAULT_DATABASE_ID`, `LOCAL_APP_PORT`

Primary dry-run names win over their aliases. `META_GRAPHQL_URL` falls back to `GRAPHQL_URL`. The verification function's `DEFAULT_DATABASE_ID` remains distinct from GraphQL server `API_DEFAULT_DATABASE_ID`.

### Runtime, LLM, Graphile, and tooling

- `NODE_ENV`, `LOG_SCOPE`
- `EMBEDDER_PROVIDER`, `EMBEDDER_MODEL`, `EMBEDDER_BASE_URL`
- `CHAT_PROVIDER`, `CHAT_MODEL`, `CHAT_BASE_URL`
- `GRAPHQL_OBSERVABILITY_ENABLED`
- all `GRAPHQL_DEBUG_SAMPLER_*` variables
- `RECAPTCHA_SECRET_KEY`
- `GRAPHILE_CACHE_MAX`, `GRAPHILE_CACHE_TTL_MS`
- `ENABLE_SIGNATURE_VERIFICATION`, `INFLECTOR_LOG`, `JITI_DEBUG`

The canonical LLM shape is `llm.embedder` plus `llm.chat`. The existing `llm-env` package is a compatibility facade that maps the historical `embedding` name onto the aggregate.

Resolving the Constructive aggregate applies the resolved `LOG_SCOPE` value to the shared PGPM logger. Pure PGPM tools retain the logger's lower-level direct environment bootstrap because they cannot depend upward.

Because logger scope is process-global, a later nested resolution may update it only from the same or a higher-precedence source; an environment-only helper call cannot downgrade a previously applied runtime override. An explicit runtime override, including an empty string, can update or clear it.

Observability still requires all three conditions: explicitly requested, development runtime, and a loopback server host. CAPTCHA and outbound-client secrets remain optional until the relevant operation needs them.

## `PORT` is intentionally process-specific

The aggregate exposes raw `runtime.port`, but a single default cannot describe every process:

| Process                  | Default |
| ------------------------ | ------: |
| GraphQL server           |  `3000` |
| `send-email`             |  `8080` |
| `send-verification-link` |  `8080` |
| Knative job example      | `10101` |

Each entrypoint uses the corresponding helper exported by `graphql-env`. Embedded functions receive their service-owned ports (`8081`, `8082`, or overrides) from the Knative host and do not reuse global `PORT`.

## Test-only inputs

Test variables are owned by the same package but parsed with `getTestEnvOptions()` rather than added to production defaults:

- `SMTP_TEST_*`
- `TEST_GRAPHQL_URL`, `TEST_GRAPHQL_HOST`, `TEST_DATABASE_ID`
- `GRAPHQL_TEST_ENDPOINT`, `GRAPHQL_TEST_EMAIL`, `GRAPHQL_TEST_PASSWORD`, `GRAPHQL_TEST_LIVE_REQUIRED`
- `TESTING_URL`, `TEST_DB`, and the maintained GraphQL host fallback.

This keeps one owner without exposing test passwords in normal configuration output.

## Accepted tradeoffs

- Some low-level Constructive packages now depend upward on `graphql-env` for one configuration group.
- Resolving a small domain may parse unrelated optional groups.
- The package name is narrower than its practical role; renaming it is not part of this change.
- `@pgpmjs/env` retains duplicate primitive parser helpers because the lower layer cannot import upward.

These costs are accepted for the current architecture. A future split should happen only after a concrete runtime or dependency constraint appears, not pre-emptively.

The codegen embedder source template is the one deliberate boundary exception: it is copied into external projects whose manifests are not controlled by this repository, so it keeps a tiny self-contained `EMBEDDER_*` read. The maintained generated SDK inside this workspace uses `graphql-env`.

`12factor-env` is also retained as a standalone, generic validation and secret-file utility. Its optional `ENV_SECRETS_PATH` convention is utility behavior rather than a Constructive runtime configuration owner; it has no production workspace consumers. New Constructive runtimes must use `graphql-env` instead of introducing a new `12factor-env` dependency.

## Guardrails

- Do not add another env package for a single Constructive domain.
- Do not move Constructive-only fields back into `PgpmOptions` or `pgpmDefaults`.
- Do not validate optional provider credentials during aggregate resolution.
- Do not print secret values or raw secret-bearing maps.
- Keep injected `env` objects isolated from global `process.env`.
- Preserve explicit `cwd` and the documented precedence when adding fields.
- Pass resolved options into long-lived caches, provider factories, and runtime routers so overrides are not lost to a second no-argument resolution.
- Add parser, config projection, alias, and consumer tests for every new environment variable.
