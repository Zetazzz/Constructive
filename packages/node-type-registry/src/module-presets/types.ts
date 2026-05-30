/**
 * A preset is a named, curated bundle of Constructive modules intended for a
 * recognizable app shape (internal tool, consumer email login, SSO-only B2B,
 * etc.). Presets are metadata only — passing `preset.modules` to
 * `provision_database_modules(v_modules => ...)` is what actually installs
 * them.
 *
 * Presets are NOT node types. They are a sibling concept: node types are
 * reusable building blocks used inside a blueprint; presets are starting
 * points for which modules to install before any blueprint is authored.
 *
 * All module names match the `rls_module`, `user_auth_module`, ... names in
 * `metaschema_generators.provision_database_modules` in constructive-db.
 *
 * Naming uses snake_case for module names to match the server-side SQL
 * convention, and kebab-ish `auth:email` for preset names because they're
 * user-facing labels, not identifiers.
 */
export interface ModulePreset {
  /** Preset identifier, e.g. 'auth:email'. Stable, used as a key in CLI/codegen. */
  name: string;

  /** Human-readable label for UIs, e.g. 'Email + Password'. */
  display_name: string;

  /** One-line pitch — what this preset is in plain English. */
  summary: string;

  /**
   * Longer narrative. Explain when you'd reach for this preset, what it
   * implies architecturally, and what tradeoffs the user is accepting by
   * choosing it. Keep to a few paragraphs max.
   */
  description: string;

  /** Concrete scenarios this preset fits well. */
  good_for: string[];

  /** Scenarios where this preset is the wrong choice — point at alternatives. */
  not_for: string[];

  /**
   * List of modules to install. Each entry is either a plain module name
   * (string) or a Babel-style tuple [name, options] for modules that need
   * configuration. Module names must match the canonical list accepted by
   * `metaschema_generators.provision_database_modules` in constructive-db.
   * Order doesn't matter — provisioning resolves dependencies.
   *
   * Examples:
   *   'users_module'                              — simple module
   *   ['permissions_module', { scope: 'app' }]    — scoped module
   *   ['agent_module', { has_plans: true }]        — feature-flagged module
   */
  modules: (string | [string, Record<string, unknown>])[];

  /**
   * Optional per-module justifications. Map from module name to a short
   * "why this module is in this preset" note. Rendered in docs and CLI
   * `--explain` output.
   */
  includes_notes?: Record<string, string>;

  /**
   * Optional per-module "why we deliberately leave this out" notes. Only
   * list modules that a user might reasonably expect to be here; don't
   * enumerate every omitted module.
   */
  omits_notes?: Record<string, string>;

  /**
   * Optional: name(s) of presets this one builds on. Purely documentary —
   * not enforced at runtime, `modules` must still be the full flat list.
   */
  extends?: string[];
}
