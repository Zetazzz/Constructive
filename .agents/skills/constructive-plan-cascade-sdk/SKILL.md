---
name: constructive-plan-cascade-sdk
description: SDK guide for the plan cascade system — how to configure plans, limits, billing quotas, feature flags (caps), and meter defaults for a Constructive app. Covers the 4 access-control layers, ORM/CLI usage, seeding defaults, and the recommended configuration workflow. Use when asked about 'configuring plans', 'setting up billing', 'feature flags', 'app limits', 'cap tables', 'resolve_cap', 'meter defaults', or 'plan subscription'.
---

# Plan Cascade: SDK & Configuration Guide

When an entity subscribes to a plan, a database trigger atomically cascades
the plan's configuration into three subsystems: **limits**, **billing quotas**,
and **feature flags**. This document covers how to configure and use this
system from the SDK/ORM/CLI.

## The Four Access-Control Layers

| Layer | What it controls | SDK surface | Example |
|-------|-----------------|-------------|---------|
| **Permission** | Can user X do action Y? | `db.appPermission`, `db.orgGrant` | Admin-only settings page |
| **Feature flag** | Is feature Y enabled for entity Z? | `db.appLimitCap`, `db.appLimitCapsDefault` | AI module, advanced analytics |
| **Limit** | How many of Y can entity Z have? | `db.appLimit`, `db.appLimitDefault` | Max 10 databases per org |
| **Billing meter** | How much quota used this period? | `balances`, `record_usage()` | 5k/10k API calls this month |

Permissions are managed via RLS and membership grants. The other three are
driven by **plans** when the plan cascade is enabled.

---

## Configuration Workflow

### Step 1: Define Your Plans

```typescript
// ORM
const starter = await db.appPlan.create({
  data: { name: 'starter', isActive: true },
  select: { id: true }
}).execute();

const pro = await db.appPlan.create({
  data: { name: 'pro', isActive: true },
  select: { id: true }
}).execute();
```

```bash
# CLI
csdk app-plan create --name starter --isActive true
csdk app-plan create --name pro --isActive true
```

### Step 2: Configure Plan Limits (Metered Counters)

These drive the `limits` table — tracked counters with increment/decrement.

```typescript
// Starter: max 3 databases, 10 members
await db.appPlanLimit.create({
  data: { planId: starter.id, limitName: 'databases', maxValue: 3 }
}).execute();
await db.appPlanLimit.create({
  data: { planId: starter.id, limitName: 'members', maxValue: 10 }
}).execute();

// Pro: max 20 databases, 100 members
await db.appPlanLimit.create({
  data: { planId: pro.id, limitName: 'databases', maxValue: 20 }
}).execute();
await db.appPlanLimit.create({
  data: { planId: pro.id, limitName: 'members', maxValue: 100 }
}).execute();
```

### Step 3: Configure Feature Flags (Caps)

These drive the `limit_caps` table — static config read by `resolve_cap()`.
Convention: `0 = disabled`, `1 = enabled`, `>1 = numeric config`.

```typescript
// Starter: no AI, 10MB file limit
await db.appPlanCap.create({
  data: { planId: starter.id, capName: 'advanced_analytics', capValue: 0 }
}).execute();
await db.appPlanCap.create({
  data: { planId: starter.id, capName: 'max_file_size_mb', capValue: 10 }
}).execute();

// Pro: AI enabled, 100MB file limit
await db.appPlanCap.create({
  data: { planId: pro.id, capName: 'advanced_analytics', capValue: 1 }
}).execute();
await db.appPlanCap.create({
  data: { planId: pro.id, capName: 'max_file_size_mb', capValue: 100 }
}).execute();
```

### Step 4: Configure Billing Quotas (Meter Limits)

These drive the `balances` table — usage tracking with credits, rollover, etc.

First, seed the meter catalog (the meters your app uses):

```typescript
// Define which meters exist (via meter_defaults or direct INSERT)
await db.appMeterDefault.create({
  data: { slug: 'api_calls', displayName: 'API Calls', meterType: 'quota', defaultPlanLimit: 0 }
}).execute();
await db.appMeterDefault.create({
  data: { slug: 'storage_gb', displayName: 'Storage (GB)', meterType: 'quota', defaultPlanLimit: 0 }
}).execute();
```

Then assign billing quotas per plan:

```typescript
// Starter: 10k API calls, 5GB storage
await db.appPlanMeterLimit.create({
  data: { planId: starter.id, meterSlug: 'api_calls', planLimit: 10000 }
}).execute();
await db.appPlanMeterLimit.create({
  data: { planId: starter.id, meterSlug: 'storage_gb', planLimit: 5 }
}).execute();

// Pro: 100k API calls, 50GB storage
await db.appPlanMeterLimit.create({
  data: { planId: pro.id, meterSlug: 'api_calls', planLimit: 100000 }
}).execute();
await db.appPlanMeterLimit.create({
  data: { planId: pro.id, meterSlug: 'storage_gb', planLimit: 50 }
}).execute();
```

### Step 5: Subscribe an Entity to a Plan

This fires the cascade trigger — all limits, caps, and billing quotas are
applied atomically.

```typescript
await db.appPlanSubscription.create({
  data: {
    entityId: orgId,
    planId: pro.id,
    // organizationId and entityType are needed for billing cascade
    // (these columns are on plan_subscriptions)
  }
}).execute();

// Now the org has:
// - limits: databases=20, members=100
// - caps: advanced_analytics=1, max_file_size_mb=100
// - billing: api_calls quota=100k, storage_gb quota=50
```

### Changing Plans (Upgrade/Downgrade)

Update the subscription's `planId` — the trigger fires again, overwriting
values via upsert:

```typescript
await db.appPlanSubscription.update({
  where: { id: subscriptionId },
  data: { planId: starter.id }
}).execute();

// Limits, caps, and billing quotas now reflect the starter plan
```

---

## Reading Feature Flags

### From SQL (inside RLS policies, triggers, checks)

```sql
-- Returns 0 (disabled) or 1+ (enabled/value)
SELECT resolve_cap('advanced_analytics');           -- app-scope default
SELECT resolve_cap('advanced_analytics', org_id);   -- per-entity override → default → 0
```

### From the SDK

Query `limit_caps` directly:

```typescript
const cap = await db.appLimitCap.findFirst({
  where: { name: { equalTo: 'advanced_analytics' }, entityId: { equalTo: orgId } },
  select: { max: true }
}).execute();

const isEnabled = cap && Number(cap.max) > 0;
```

Or query the defaults:

```typescript
const defaultCap = await db.appLimitCapsDefault.findFirst({
  where: { name: { equalTo: 'advanced_analytics' } },
  select: { max: true }
}).execute();
```

---

## Setting App-Level Defaults (Without Plans)

You can configure defaults independently of plans for apps that don't
use the plan system yet:

### Limit Defaults

```typescript
// Set default max for all users (no plan needed)
await db.appLimitDefault.create({
  data: { name: 'databases', max: 5, softMax: 4 }
}).execute();
```

### Cap Defaults (Feature Flags)

```typescript
// Disable advanced_analytics by default for all entities
await db.appLimitCapsDefault.create({
  data: { name: 'advanced_analytics', max: 0 }
}).execute();

// Per-entity override: enable for a specific org
await db.appLimitCap.create({
  data: { name: 'advanced_analytics', entityId: orgId, max: 1 }
}).execute();
```

### Meter Defaults (Billing)

```typescript
// Define the app's meter catalog
await db.appMeterDefault.create({
  data: { slug: 'api_calls', displayName: 'API Calls', meterType: 'quota', defaultPlanLimit: 1000 }
}).execute();
```

---

## SDK Table Reference

### Plans

| ORM Table | Purpose |
|-----------|---------|
| `db.appPlan` | Plan definitions (starter, pro, enterprise) |
| `db.appPlanLimit` | Plan → limit_name → max_value (metered counters) |
| `db.appPlanMeterLimit` | Plan → meter_slug → billing quota |
| `db.appPlanCap` | Plan → feature flag → cap value |
| `db.appPlanPricing` | Billing intervals and prices |
| `db.appPlanOverride` | Per-entity VIP limit overrides |
| `db.appPlanSubscription` | Entity → plan assignment (triggers cascade) |

### Limits

| ORM Table | Purpose |
|-----------|---------|
| `db.appLimit` | Per-actor metered counters (databases, members, etc.) |
| `db.appLimitDefault` | App-scope default limits |
| `db.orgLimit` | Org-scope aggregate limits |
| `db.orgLimitDefault` | Org-scope default limits |
| `db.appLimitCap` | Per-entity feature flag overrides |
| `db.appLimitCapsDefault` | App-scope default caps/feature flags |
| `db.orgLimitCap` | Org-scope per-entity caps |
| `db.orgLimitCapsDefault` | Org-scope default caps |

### Billing

| ORM Table | Purpose |
|-----------|---------|
| `db.appMeterDefault` | Default meter catalog for the app |

Note: `balances`, `ledger`, and `usage_summary` are in the private schema
and accessed via SQL functions (`record_usage`, `check_billing_quota`),
not directly from the ORM.



**For testing:** Use the test utilities in `constructive-limits` to seed
defaults in `beforeAll`. See the `constructive-db-plan-cascade` skill in
the constructive-db repo for SQL-level test patterns.
