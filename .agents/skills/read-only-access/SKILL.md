---
name: read-only-access
description: Read-only access control — membership-level is_read_only and API key access_level for restricting mutations
---

# Read-Only Access

Constructive provides two complementary mechanisms for read-only access control. They serve different personas and can be stacked for defense in depth.

## 1. Read-Only Memberships (`isReadOnly`)

Mark an entity-scoped membership as read-only to block all mutations (INSERT, UPDATE, DELETE) for that member within that entity's tables, while allowing full SELECT access.

### How It Works

- Every entity-scoped membership (orgs, groups, data rooms, channels — `membership_type >= 2`) has an `isReadOnly` boolean field on both the memberships table and the SPRT (Security Policy Resolution Table).
- When `isReadOnly` is `true`, an auto-generated **restrictive RLS policy** (`AuthzNotReadOnly`) blocks all mutation privileges. Since PostgreSQL ANDs restrictive policies with permissive ones, the member's normal permissions still grant SELECT but all writes are denied.
- Owners and admins cannot be set to read-only — trigger guards prevent `isReadOnly = true` when `isOwner = true` or `isAdmin = true`.

### SDK Usage

```bash
# Invite a member as read-only
csdk org-membership create --actorId <user-uuid> --entityId <org-uuid> --isReadOnly true

# Update an existing member to read-only
csdk org-membership update --id <membership-uuid> --isReadOnly true

# Remove read-only restriction
csdk org-membership update --id <membership-uuid> --isReadOnly false
```

### GraphQL

```graphql
mutation {
  createOrgMembership(input: {
    actorId: "user-uuid"
    entityId: "org-uuid"
    isReadOnly: true
  }) {
    orgMembership {
      id
      isReadOnly
    }
  }
}
```

### Behavior

| Action | Read-Only Member | Normal Member |
|--------|-----------------|---------------|
| SELECT (read data) | Allowed | Allowed |
| INSERT (create records) | Blocked by RLS | Allowed (if permitted) |
| UPDATE (modify records) | Blocked by RLS | Allowed (if permitted) |
| DELETE (remove records) | Blocked by RLS | Allowed (if permitted) |

### Scope

- Applies to **all entity-scoped tables** for that entity (any table with an `AuthzEntityMembership` policy)
- One restrictive policy per table — automatically injected during table provisioning
- If a table has mixed-scope policies (e.g., both `AuthzEntityMembership` and `AuthzDirectOwner`), read-only still blocks all mutations for the entity scope

## 2. Read-Only API Keys (`accessLevel`)

Create an API key with `accessLevel: 'read_only'` to make the entire transaction read-only at the PostgreSQL level. The key physically cannot perform any writes, regardless of the user's permissions.

### How It Works

- The `session_credentials` table has an `accessLevel` field (default: `'full_access'`).
- When a request authenticates with a credential where `accessLevel = 'read_only'`, the server sets `default_transaction_read_only = 'on'` via `pgSettings`. PostgreSQL then rejects any write operation in that transaction with: `ERROR: cannot execute INSERT in a read-only transaction`.
- This is enforced by the PostgreSQL engine itself — no RLS policy, trigger, or function can bypass it.

### SDK Usage

```bash
# Create a read-only API key
csdk create-api-key --input.keyName "my-readonly-key" --input.accessLevel "read_only"

# Create a normal (full access) API key
csdk create-api-key --input.keyName "my-key" --input.accessLevel "full_access"
```

### GraphQL

```graphql
mutation {
  createApiKey(input: {
    keyName: "my-readonly-key"
    accessLevel: "read_only"
  }) {
    apiKey
    accessLevel
  }
}
```

### Behavior

Any request authenticated with a read-only API key:
- Can execute any SELECT / read query
- Cannot execute INSERT, UPDATE, DELETE, CREATE, DROP, or any other write operation
- Receives a PostgreSQL error if a write is attempted: `cannot execute INSERT in a read-only transaction`

### Access Level Values

| Value | Description |
|-------|-------------|
| `full_access` | Default. Normal read + write access (subject to RLS policies). |
| `read_only` | Transaction-level read-only. All writes rejected by PostgreSQL. |

## How They Complement Each Other

| Scenario | Read-Only Membership | Read-Only API Key |
|----------|---------------------|-------------------|
| Org admin invites a viewer | Member can read but not mutate in that org | N/A |
| Developer creates a safe integration key | N/A | Key cannot write anything, period |
| Contractor with read-only org access | Can't mutate in that org, can still write in other orgs | Personal keys still work normally elsewhere |
| Read-only dashboard service | N/A | App-wide read-only key reads everything, writes nothing |
| Defense in depth | Read-only member + read-only API key | Both layers enforced independently |

- **Read-Only Membership** = per-entity, per-member. Managed by org admins via the membership API.
- **Read-Only API Key** = per-session, per-key. Self-service by developers via the API key creation API.

## Performance

Both mechanisms have negligible performance impact:

- **Read-only membership**: The restrictive policy checks `isReadOnly IS NOT TRUE` on a SPRT row already fetched by the permissive policy. Cost: <0.01ms per mutation. Zero impact on SELECT queries.
- **Read-only API key**: `default_transaction_read_only` is a PostgreSQL GUC checked by the executor. No additional queries or index lookups.
