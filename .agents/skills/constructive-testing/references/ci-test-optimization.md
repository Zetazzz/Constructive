# CI/CD & Test Optimization

## Philosophy

Test optimization has two complementary axes:
1. **Test compression** — reduce boilerplate so redundancy becomes visible, then eliminate redundancy
2. **CI/CD speed** — minimize wall-clock time through sharding, runner sizing, and provisioning efficiency

## Phase 1: Pattern Discovery & Utility Abstraction

### Finding Repeated Patterns

1. **Grep for raw SQL in test files** — any `SELECT`, `INSERT`, `UPDATE` outside of `test-helpers.ts` is a candidate
2. **Cluster by shape** — group queries by what they do, not by exact SQL
3. **Count occurrences** — patterns appearing 3+ times are high-value abstractions
4. **Check if utility already exists** — scan `test-helpers.ts` first

### What Makes a Good Test Utility

Worth creating when:
- Pattern appears in **3+ files** (or 5+ times in one file)
- Involves **multiple steps** that always occur together
- Raw code **obscures test intent**
- Replaces **copy-paste-prone code**

NOT worth creating when:
- Would **hide `setContext` calls** — these must remain visible
- It's a **one-liner** that's already clear
- Would require **many parameters** that vary across call sites

### Choosing `db` vs `_dangerouslyBypassRLS`

- **Use `this.db`** when: the operation is something an application user would do
- **Use `this._dangerouslyBypassRLS`** when: the operation is test setup that bypasses security
- **Rule of thumb:** if the original test code used `pg` (superuser), use `_dangerouslyBypassRLS`

## Phase 2: Test Compression

1. Read the file top-to-bottom, noting existing utilities and raw SQL patterns
2. Extract file-level constants for repeated values
3. Replace multi-step sequences with utility calls
4. Keep `setContext` visible
5. Verify semantic equivalence

## Phase 3: Test Merging & Deletion

### Merge Candidates

1. **Same preset** — files can only merge if they use the same `provisionTestDatabase` preset
2. **Same directory** — merge within the same shard regex pattern
3. **Small files** — prioritize files with <5 test cases or <100 lines

### Merge Benefit

Each merged file saves ~50-60s of `provisionTestDatabase` time + ~5-10s overhead.

## Phase 4: CI/CD Speed Optimization

### Shard Balancing

**Target:** All shards within 20% of each other. Bottleneck shard < 10 minutes.

**Split a shard when:**
- Wall-clock exceeds 10 minutes
- Shard has >12 test files
- A single test file takes >120s

**Merge shards when:**
- A shard has <3 test files
- Total test time < 60s (overhead dominates)

### Runner Sizing

Tests are I/O-bound (waiting on PostgreSQL). 8vCPU recommended — diminishing returns past that.

### Shard Configuration

Edit `.github/workflows/run-tests.yaml` matrix. The `test_pattern` is a regex matched against test file paths:

```yaml
- package: packages/metaschema
  test_pattern: 'auth/(identity-sign-in|sessions|api-keys)'
  shard_name: 'metaschema-auth-1'
```

## Database Provisioning Rules

- Only ONE `provisionTestDatabase` call in `beforeAll` per file
- `beforeEach`/`afterEach` must only do savepoint/rollback
- Choose the **lightest preset** that covers the test's needs

## Monitoring Checklist

- [ ] Bottleneck shard < 10 minutes
- [ ] All shards within 30% of each other
- [ ] No `provisionTestDatabase` calls outside `beforeAll`
- [ ] No single-test files that could merge into a neighbor
