import type { ModulePreset } from './types';

/**
 * `full` — install every standard module.
 *
 * This is the maximalist preset: every module Constructive ships, including
 * `storage_module:full` for file uploads with all feature flags and
 * `crypto_addresses_module` for wallet-based sign-in.
 *
 * Usage logging modules (compute_log, inference_log, transfer_log,
 * storage_log, db_usage) are NOT included — they are opt-in only.
 *
 * Prefer a more targeted preset for anything production-bound — installing
 * a module you'll never use still costs tables, triggers, and grants.
 */
export const PresetFull: ModulePreset = {
  name: 'full',
  display_name: 'Full (every module)',
  summary: 'Install every standard Constructive module with explicit module list.',
  description:
    'Installs every standard module in the catalog: everything in `b2b` plus ' +
    '`storage_module:full` for file uploads (versioning, content hash, custom keys, audit log), ' +
    '`crypto_addresses_module` for wallet-based sign-in, `plans_module` and `billing_module` ' +
    'for subscription management, `notifications_module` for in-app notifications, and ' +
    '`events_module` at both app and org scopes. Usage logging modules are opt-in only — ' +
    'add them explicitly if needed.',
  good_for: [
    'Reference / demo databases that showcase every Constructive feature',
    'Greenfield apps where the product scope is still open-ended',
    'Integration tests that need the full module stack'
  ],
  not_for: [
    'Production apps with a defined feature set — pick the narrowest preset that fits',
    'Resource-constrained environments — every module costs schema bloat, RLS policies, and grants'
  ],
  modules: [
    // Core
    'users_module',
    'membership_types_module',
    // App-level (membership_type = 1)
    'permissions_module:app',
    'limits_module:app',
    'memberships_module:app',
    'events_module:app',
    'profiles_module:app',
    // Org-level (membership_type = 2)
    'permissions_module:org',
    'limits_module:org',
    'memberships_module:org',
    'events_module:org',
    'profiles_module:org',
    // Hierarchy
    'hierarchy_module:org',
    // Billing & Plans
    'plans_module',
    'billing_module',
    'rate_limit_meters_module',
    'billing_provider_module',
    // Auth infrastructure
    'user_state_module',
    'sessions_module',
    'session_secrets_module',
    'rate_limits_module',
    'devices_module',
    'config_secrets_user_module',
    'rls_module',
    // Contact modules
    'emails_module',
    'phone_numbers_module',
    'crypto_addresses_module',
    'webauthn_credentials_module',
    'notifications_module',
    // Connected accounts
    'connected_accounts_module',
    'identity_providers_module',
    // Invites & Auth
    'invites_module:app',
    'invites_module:org',
    'user_auth_module',
    'webauthn_auth_module',
    // Storage (full features)
    'storage_module:full',
  ],
  includes_notes: {
    'storage_module:full': 'All storage feature flags enabled: versioning, content hash, custom keys, audit log.',
    billing_module: 'Metered billing with credits waterfall and period reset.',
    plans_module: 'Subscription plan management with plan-governed caps.',
    notifications_module: 'In-app notification system with read/unread tracking.'
  },
  omits_notes: {
    compute_log_module: 'Usage logging is opt-in. Add explicitly if needed.',
    inference_log_module: 'Usage logging is opt-in. Add explicitly if needed.',
    agent_module: 'Agent infrastructure is opt-in.'
  },
  extends: ['b2b']
};
