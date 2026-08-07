# OAuth/SSO Platform Integration Specification Working Draft

## Purpose

This non-normative working draft records technical options under discussion, supporting evidence, suggested values, and unresolved design questions for the unified authentication center.

Only decisions that have been explicitly confirmed will be moved into the adjacent [formal specification](./oauth-sso-platform-integration.md). Unconfirmed proposals in this draft must not be treated as implementation requirements.

## Active Discussion Notes

No entries yet.

## Candidate Designs and Suggested Values

No entries yet.

## Open Questions

No entries yet.

## Confirmed Decisions Pending Promotion

### Component Map

**Status:** Confirmed; pending promotion to the formal specification.

- **Dashboard:** Hosts the authentication-center UI for sign-in, registration, account confirmation, and error states. It renders the verified Site's public name, icon, and theme colors, but does not own the unified session or make OAuth or handoff security decisions.
- **Constructive:** Hosts the authentication service and permission-controlled administration interfaces. It validates Sites, orchestrates local and Provider authentication, creates and redeems handoffs, and issues or exchanges local credentials. Its public discovery GraphQL query reads and returns only enabled Sites' public configuration; administrative writes remain permission controlled.
- **Constructive DB:** Is the authoritative persistence and execution layer for identity associations, sessions, short-lived login transactions, one-time handoffs, Site registrations, exact callbacks, login modes, and public branding and theme configuration. Each database design must first evaluate the existing Site, sessions, identity providers, auth settings, and related models; only a capability that is genuinely absent should extend the correct owning module.
- **Each Site:** Runs a minimal authentication integration that initiates unified sign-in, consumes the handoff, and establishes local authentication state. Its local API accepts Bearer presentation and that Site's own first-party session Cookie; Sites on different parent domains do not share Cookies.
- **External Identity Providers:** Google, GitHub, and other Providers remain outside the system. Constructive integrates with them through one shared Provider adapter layer rather than creating a separate workflow for each Provider.
- **Public configuration and trust boundary:** Public discovery exposes only entry locations, displayable branding, supported authentication methods, and similarly public information. It must never expose secrets, the complete callback allowlist, or data that can directly redeem a credential. Origin and CORS are not core proofs of trust; login and handoff operations still require server-side validation against the registered Site and exact callback.

#### Tenant Isolation and Optional SSO Groups

- **Hard isolation boundary:** A Tenant is the mandatory isolation boundary for unified sign-in. Every Site, login transaction, unified session, and handoff must belong to and be validated against one Tenant. A shared authentication-center deployment must never reuse a session or handoff across Tenants.
- **Default within a Tenant:** Registered Sites in the same Tenant share the SSO boundary by default.
- **Optional additional isolation:** The architecture reserves an optional SSO group, or equivalent authentication-boundary concept, for separating high-sensitivity, administration, finance, or similar Sites within one Tenant. Only Sites in the same group may silently reuse login state; crossing groups requires a new login.
- **Authentication-specific ownership:** Constructive DB has no existing Site SSO-group model that can be reused directly. Existing permission groups and scopes express authorization, not inter-Site SSO trust, and must not be represented as SSO groups. If optional grouping is enabled, the correct authentication owner must gain an explicit authentication-specific relationship; this draft does not yet choose a table or field design.

### Site Registration and Authentication Entities

**Status:** Confirmed; pending promotion to the formal specification.

#### Site Authentication Configuration

Site Authentication Configuration is a logical per-Site entity, with exactly one configuration for each existing Site. Its currently confirmed data points are limited to:

- whether unified authentication is enabled or disabled;
- the sign-in mode: confirm-before-sign-in by default, or silent sign-in as the alternative;
- optional SSO group membership for additional isolation within a Tenant.

No physical table, field, or schema design is implied by this logical model.

| Site | Unified authentication | Sign-in mode | Optional SSO group |
| --- | --- | --- | --- |
| Customer Portal | Enabled | Confirm before sign-in | `customer-apps` |
| Partner Portal | Enabled | Silent sign-in | `customer-apps` |
| Finance Admin | Enabled | Confirm before sign-in | `finance-admin` |

Customer Portal and Partner Portal can share SSO within `customer-apps`. Finance Admin does not reuse their login state and requires a separate sign-in because it belongs to `finance-admin`.

#### Site Callback Address

Site Callback Address is a logical one-to-many entity associated with a Site. Its currently confirmed data points are limited to:

- the owning Site;
- the full, exact callback URL;
- whether that callback is active and allowed.

Each callback is registered individually and matched exactly. Wildcards, suffix matching, and arbitrary subdomains are not allowed.

| Site | Illustrative callback URL |
| --- | --- |
| Customer Portal | `https://portal.example.com/auth/complete` |
| Partner Portal | `https://partners.example.com/login/return` |
| Finance Admin | `https://finance.example.com/sso/callback` |

These callback URLs are illustrative examples only; they are not fixed product URLs.

#### Application Return Target

**Status:** Confirmed; pending promotion to the formal specification.

The Site may initiate login with an intended application-relative `returnTo` target, such as `/approvals/42`. It is strictly internal to that Site and cannot name another Site or origin. The login-start operation validates it server-side and persists it in the unified login transaction. This application destination is distinct from the Site's fixed, registered technical callback.

After the initial start request, browser navigation does not carry the unified transaction identifier or the raw `returnTo` value. Dashboard uses the opaque transaction identifier only in active API operations, Provider callbacks resolve it through server-held state, and the target Site obtains the verified `returnTo` from server-side transaction context after successful handoff redemption.

#### Login-Start Validation Boundary

**Status:** Confirmed; detailed implementation deferred.

The unified authentication entry's login-start operation is the authoritative enforcement point for validating the Site and its exact callback. An optional GraphQL preflight or discovery check may reuse the same server-side validation logic, but it is advisory and never sufficient because a browser caller can bypass it. Such a check validates Site and callback inputs; it does not expose or retrieve a login transaction. The concrete implementation belongs to the later Login Transactions and authentication-entry design discussion.

#### Active-Flow-Only Login Transaction

**Status:** Confirmed for v1; pending promotion to the formal specification.

- The unified login transaction is short-lived server-side orchestration state. Its opaque identifier is used only while the current login flow is active and does not carry transaction contents or sensitive information.
- There is no public GraphQL query for retrieving a login transaction or its status. If the flow is interrupted, the user starts login again rather than resuming or recovering the prior transaction.
- The initial start-login mutation returns the opaque transaction identifier to Dashboard. Dashboard supplies it to the local-password mutation or the Provider-start operation for the selected branch.
- The start-login mutation also returns the enabled external identity-Provider display options for the transaction's Tenant by reusing existing Provider-configuration access. Dashboard shows these options alongside local password sign-in only when no reusable unified authentication exists.
- For a Provider branch, Constructive links the Provider authorization request to the unified login transaction on the server. The Provider callback resolves that link and completes the next server-side step; Dashboard does not query transaction status.

```mermaid
sequenceDiagram
    actor U as User
    participant S as Site
    participant B as Browser
    participant D as Dashboard unified login page
    participant C as Constructive
    participant DB as Constructive DB
    participant P as Common post-authentication continuation

    U->>S: Click login
    S-->>B: Navigate directly to Dashboard with Site ID, optional callback URL, and returnTo
    B->>D: Load unified login page
    Note over B,D: Direct user-visible route; no extra Constructive-to-Dashboard browser redirect
    D->>C: Start-login mutation with Site ID, optional callback URL, and returnTo
    C->>DB: Validate Site, callback, and application-relative returnTo
    alt Explicit callback supplied
        DB->>DB: Require an exact active registered match
    else Callback omitted
        DB->>DB: Select earliest registered callback by created_at ASC, then ID ASC
    end
    C->>DB: Create short-lived login transaction
    C->>DB: Read enabled Provider display options through existing Tenant configuration access
    DB-->>C: Transaction, safe Site context, and enabled Provider display options
    C-->>D: Opaque transaction ID, safe display/decision context, and enabled Provider display options
    Note over D,C: Active-flow-only ID; no public transaction lookup or status query
    Note over D,C: Existing unified state is evaluated via Bearer or the authentication domain's first-party Cookie
    alt Valid unified state and silent sign-in
        D->>P: Continue with authenticated identity and transaction without confirmation
    else Valid unified state and confirm-before-sign-in
        D-->>B: Render account confirmation
        U->>D: Confirm and continue with current account
        D->>P: Continue with authenticated identity and transaction
    else No valid unified state
        D-->>B: Render local password and enabled Provider options
    end
```

The silent and confirmed existing-session success paths enter the shared post-authentication continuation directly. When no reusable unified authentication exists, the local-password and external-Provider diagrams below show the two authentication branches; their successful outcomes enter that same continuation.

##### Local Username/Password Branch

**Status:** Confirmed; pending promotion to the formal specification.

The unified-login password GraphQL mutation is backed by a new SSO-specific PostgreSQL wrapper function. It accepts the active opaque unified-login transaction identifier and local credentials, validates the transaction and its Tenant, Site, and SSO boundaries, calls the existing Tenant-local `sign_in_identity` function unchanged, preserves its existing credential outcome, associates the successful identity outcome with the active transaction, and enters the common post-authentication server-side flow.

`sign_in_identity` remains the general Tenant application-user authentication primitive. Its signature and behavior are not extended with unified-login or SSO concerns. On success, Dashboard receives the normal first-party Dashboard Bearer-token result for its existing local or session storage behavior when Cookies are unavailable, the normal first-party Dashboard session-Cookie behavior, and only the minimal SSO continuation information. The response must not expose the complete private transaction, callback, or SSO-group context.

The wrapper calls `sign_in_identity` exactly once per password-mutation submission and performs no automatic retry. A password failure returns the existing safe error; while the unified login transaction remains active and unexpired, the user may correct the credentials and submit again manually. Existing rate limiting continues to apply.

```mermaid
sequenceDiagram
    actor U as User
    participant D as Dashboard unified login page
    participant C as Constructive
    participant W as SSO-specific PostgreSQL wrapper function
    participant I as Tenant-local sign_in_identity
    participant P as Common post-authentication continuation

    Note over U,D: No reusable unified state
    U->>D: Submit local username and password
    D->>C: Local-password mutation with opaque transaction ID and credentials
    C->>W: Invoke with transaction ID and local credentials
    W->>W: Validate active transaction and Tenant, Site, and SSO boundaries
    alt Transaction or SSO boundary validation fails
        W-->>C: Classified validation failure
        C-->>D: Safe classified error
        D-->>U: Render safe error
    else Boundaries are valid
        W->>I: Call unchanged once with local credentials
        alt Local authentication fails
            I-->>W: Authentication failure
            W-->>C: Classified authentication failure
            C-->>D: Safe classified error
            D-->>U: Render safe error
            Note over U,W: No automatic retry; manual resubmission is allowed while the transaction remains active and rate limits permit
        else Local authentication succeeds
            I-->>W: Existing identity and credential outcome
            W->>W: Associate identity outcome with active transaction
            W-->>C: Preserved credential outcome and authenticated transaction
            C->>P: Enter common continuation with authenticated identity and transaction
        end
    end
```

##### External Provider Branch

**Status:** Confirmed and promoted to the formal specification.

The generic SSO flow uses a protocol-neutral Provider Adapter selected from the transaction Tenant's configured and enabled Providers. Dashboard sends the active unified login transaction identifier and selected Provider only to Constructive. Constructive creates the existing OAuth authorization-request state linked to that transaction; the browser and external Provider receive only the random OAuth state, never the unified login transaction identifier.

The Adapter pattern is defined by a protocol-neutral interface or contract covering Provider-specific authorization initiation and callback/code-to-normalized-identity completion. Google and GitHub each implement that contract, and a future Provider adds another implementation. This decision does not require an abstract base class or inheritance. A common Constructive service keeps login-transaction and OAuth-state validation, account matching or provisioning, and shared post-authentication handoff orchestration outside every adapter.

Each Provider-specific implementation owns its authorization and callback protocol details. Both Google and GitHub return an authorization code plus OAuth state, or a Provider error, to the callback; neither returns tokens directly to the browser. The Google/OIDC adapter exchanges the code server-side, validates the returned identity token as identity proof, and normalizes the resulting user data. An access token may also be returned, but v1 neither retains nor uses it for SSO when the validated identity data is sufficient. The GitHub/OAuth adapter exchanges the code server-side for an access token, uses it server-side to query GitHub user and, when needed, email endpoints, and normalizes the result. These are adapter-internal examples, not separate top-level SSO flows or requirements imposed on every future Provider.

Every implementation normalizes success to one external identity outcome containing at least the Provider key or name, external subject or user ID, email when available, and safe profile basics. Generic SSO and the unchanged account-association and identity logic consume only this normalized outcome. Provider tokens never cross the server-side adapter boundary.

```mermaid
sequenceDiagram
    actor U as User
    participant D as Dashboard unified login page
    participant C as Common Constructive SSO service
    participant DB as Constructive DB
    participant PA as Protocol-neutral Provider Adapter
    participant B as Browser
    participant IP as External Identity Provider
    participant A as Existing account association and identity logic
    participant P as Common post-authentication continuation

    Note over U,D: No reusable unified state
    U->>D: Choose Google, GitHub, or another enabled Provider
    D->>C: Provider-start operation with opaque transaction ID and Provider
    Note over D,C: Unified transaction ID is sent only to Constructive
    C->>DB: Validate transaction and selected configured Provider
    C->>DB: Create Provider-only OAuth request linked to unified transaction
    Note over C,DB: oauth_authorization_requests is Provider-only state, not the unified login transaction
    DB-->>C: Opaque browser state; PKCE verifier and nonce remain server-held
    C->>PA: Begin authorization with configured Provider and random OAuth state
    PA-->>C: Authorization redirect details
    C-->>B: Redirect browser with random OAuth state only
    Note over B,IP: Unified transaction ID never crosses this boundary
    B->>IP: Follow authorization redirect with opaque state and PKCE challenge
    IP-->>B: Authorization code + OAuth state, or error + OAuth state
    B->>C: Provider callback
    C->>DB: Consume OAuth state and restore Provider context and linked unified transaction
    alt OAuth state is invalid, expired, or mismatched
        DB-->>C: Classified state failure
        C-->>D: Safe classified error
        D-->>U: Render safe error and require restart from Site login entry
    else State restores configured Provider and original transaction
        DB-->>C: Active transaction and configured Provider context with server-held PKCE and nonce
        Note over C,DB: State validation stays in the common service; Dashboard performs no status query
        alt Callback contains Provider cancellation or error
            C-->>D: Safe classified Provider failure
            D-->>U: Render safe error and require restart from Site login entry
        else Callback contains authorization code
            C->>PA: Complete code-to-normalized-identity through configured adapter
            alt Google/OIDC adapter implementation
                PA->>IP: Exchange authorization code server-side
                IP-->>PA: Identity token + optional access token + user data
                PA->>PA: Validate identity token and normalize user data
                Note over PA,IP: Optional access token is not retained or used for v1 SSO when identity data is sufficient
            else GitHub/OAuth adapter implementation
                PA->>IP: Exchange authorization code server-side
                IP-->>PA: Access token
                PA->>IP: Query GitHub user and, when needed, email endpoints
                IP-->>PA: User and optional email data
                PA->>PA: Normalize GitHub user data
            else Another supported adapter implementation
                PA->>PA: Run Provider-specific verification and normalize
            end
            Note over B,IP: Browser never receives Provider tokens
            alt Provider exchange or verification fails
                PA-->>C: Classified Provider failure
                C-->>D: Safe classified error
                D-->>U: Render safe error and require restart from Site login entry
            else Provider returns normalized external identity
                PA-->>C: Provider key/name + stable subject/user ID + optional email + safe profile
                C->>A: Resolve unchanged identity lifecycle from normalized outcome
                A->>DB: Lookup connected_accounts by service + identifier
                alt Existing connected account
                    DB-->>A: Linked owner_id and details
                    A-->>C: Linked local identity
                    C->>P: Enter common continuation with identity and transaction
                else Unlinked and email is not locally owned
                    A->>DB: Call existing sign_up_identity path
                    DB-->>A: Application user + email + connected account; other profile data in details
                    A-->>C: Provisioned local identity
                    C->>P: Enter common continuation with identity and transaction
                else Unlinked and email belongs to another local account
                    DB-->>A: Explicit account conflict
                    A-->>C: Use-existing-sign-in guidance
                    C-->>D: Safe conflict without merge, binding, or password confirmation
                    D-->>U: Use existing sign-in method and restart login
                end
            end
        end
    end
```

#### Provider Identity Association and Provisioning

**Status:** Confirmed and promoted to the formal specification.

- `constructive_user_identifiers_private.connected_accounts` remains the durable association from Provider `service` plus stable `identifier` to `owner_id`; safe additional profile data remains in `details`.
- The Provider authorization code is transient protocol input, never the identity. Returning accounts are recognized by stable Provider identifier or subject, not email.
- An existing association authenticates its linked local user. An unlinked identity whose normalized email is not owned locally uses the existing `sign_up_identity` path to provision the application user, email, and connected account atomically.
- An unlinked identity whose normalized email belongs to another local account fails explicitly with guidance to use the existing sign-in method. This flow performs no automatic merge or binding and no password-confirmation linking.
- Provider cancellation or error, invalid state, exchange or verification failure, and email conflict produce safe user-facing failures. The failed Provider flow is never resumed; the user restarts from the Site login entry with a new transaction.

#### Future Provider Binding Consideration

**Status:** Future consideration; not current scope.

An already authenticated local user may later bind Google, GitHub, or another Provider from account settings. This is not part of the current unified-login flow.

Both branches enter the same common post-authentication continuation described below. Neither branch exposes transaction retrieval or status polling to Dashboard.

### Common Post-Authentication and Cross-Site Completion

**Status:** Confirmed and promoted to the formal specification.

Every successful route enters exactly this shared continuation: an already unified-authenticated user proceeding silently, an already unified-authenticated user confirming the current account, a successful local-password sign-in, or a successful external-Provider sign-in. No successful branch bypasses the handoff, callback, redemption, Site-local credential, or verified `returnTo` stages below.

After authentication, Constructive retains the identity outcome and validated target context on the unified login transaction, then creates a Site-bound, short-lived, one-time SSO handoff code. Dashboard sends that code in a browser `POST` to the target Site's already validated technical callback. The code must never appear in a URL.

The target Site server redeems the code with Constructive through a GraphQL mutation backed by a dedicated PostgreSQL function. The function validates the handoff and its referenced transaction boundaries, consumes it on successful redemption, and issues a distinct local credential result for that Site. The Dashboard or authentication-center Bearer credential and the target Site's Bearer credential are distinct even when both represent the same identity.

The target Site callback owns normal Site-local credential completion. Its response sets the Site's own first-party session Cookie and delivers the Site-local Bearer result to its own frontend through the existing local-storage behavior. Constructive cannot set a Cookie for the Site's domain. After establishing the Site-local session or token, the Site redirects to the verified application-relative `returnTo` obtained from the server-side transaction context.

```mermaid
sequenceDiagram
    participant P as Common post-authentication continuation
    participant C as Constructive
    participant DB as Constructive DB
    participant D as Dashboard unified login page
    participant B as Browser
    participant S as Target Site callback and server

    Note over P,C: Silent, confirm, local-password, and Provider success routes all enter here
    P->>C: Continue with authenticated identity and active transaction
    C->>DB: Ensure transaction retains identity outcome and create Site-bound one-time handoff
    DB-->>C: Plaintext code emitted once; only its secure hash remains stored
    C-->>D: Authentication result and minimal SSO continuation
    Note over C,D: Local-password success preserves the normal Dashboard Bearer result and first-party session-Cookie behavior
    D-->>B: Submit the handoff to the validated Site callback
    B->>S: POST one-time handoff code
    Note over B,S: The code is in the POST body, never the URL
    S->>C: Redeem-handoff GraphQL mutation with one-time code
    Note over S,C: Server-to-server redemption
    C->>DB: Invoke dedicated handoff-redemption PostgreSQL function
    DB->>DB: Validate code, expiry, unused state, transaction, and SSO boundaries
    alt Handoff is invalid, expired, or already consumed
        DB-->>C: Classified validation failure
        C-->>S: Safe failure without a credential
    else Transient exchange failure before successful consumption
        C-->>S: Safe retryable failure
        Note over S,DB: The unconsumed code may be retried within its one-minute lifetime
    else Redemption succeeds
        DB->>DB: Consume handoff and issue distinct Site-local credential
        DB-->>C: Site-local credential result and verified returnTo
        C-->>S: Site-local credential result and verified returnTo
        Note over C,S: Dashboard and Site credentials remain distinct
        S->>S: Set Site first-party Cookie and deliver Bearer result to its own frontend
        S-->>B: Redirect to verified application-relative returnTo
    end
```

### SSO Handoff Logical Entity

**Status:** Confirmed; pending promotion to the formal specification.

The handoff is a minimal logical entity that references the unified login transaction rather than duplicating its Tenant, SSO group, target Site, callback, return target, or identity outcome. Its confirmed logical data points are limited to:

- internal ID;
- securely stored code hash, with the plaintext code emitted only once;
- `loginTransactionId`;
- `createdAt`;
- `expiresAt`;
- `consumedAt`.

The handoff expires one minute after creation and is consumed only on successful redemption. If a transient exchange failure occurs before consumption, the same unconsumed code may be retried within that one-minute lifetime. Whether this logical entity reuses or extends an existing table or requires a new table remains a later implementation evaluation; this decision does not select a physical schema.

### Unified Login Transaction Model Analogue

**Status:** Confirmed; pending promotion to the formal specification.

Among the current short-lived, single-use SSO models, `sso_private.oauth_authorization_requests` is the closest semantic analogue because both bind a pre-authentication browser redirect to server-side state. `pending_identity_links` is not the right analogue because it exists only after an external identity has been verified and is awaiting account linking.

This comparison is semantic only. The unified pre-login transaction must have its own model or table rather than directly reusing or overloading the OAuth-specific table, while reusing the established one-time, expiry, and consume lifecycle pattern.

### Site-Local Credential Compatibility

**Status:** Confirmed; pending promotion to the formal specification.

- Each Site server must accept the same Site-local credential in either an `Authorization: Bearer` header or that Site's first-party session Cookie. Constructive already supports both presentations; when both are present, the Bearer credential takes precedence.
- A standard browser login may store the Site-local credential in an `HttpOnly` Cookie. API clients, CLIs, mobile clients, and clients where Cookies are disabled or rejected may instead store the credential and send it in the Bearer header.
- Bearer-token SSO is valid in principle when an authentication platform securely delivers a credential trusted by multiple Sites in the same authentication boundary. This design instead uses the confirmed one-time handoff to establish a distinct Site-local credential; it does not distribute the Dashboard or authentication-center Bearer credential to target Sites.
- Different browser origins do not automatically share Site A's browser storage or login state. When Cookies are unavailable, the confirmed short-lived, one-time authentication-center handoff lets the target Site establish its own Bearer credential. Neither a long-lived Bearer credential nor the handoff code may be carried in a browser redirect URL.
- Sites must not share Cookies across unrelated parent domains. Each Site may continue to use its own first-party Cookie, Bearer presentation, or both within the confirmed compatibility boundary.
- No dedicated complexity is required for the rare transition where a user first signs in with Cookies and then temporarily disables them. The design only needs to preserve the two supported credential presentations and the trust and handoff boundaries described above.
