/**
 * @constructive-io/llm-env — LLM Environment Configuration
 *
 * Compatibility facade over @constructive-io/graphql-env. The Constructive
 * aggregate is the source of truth; this package preserves the historical
 * `embedding` field used by graphile-llm and agentic-server.
 *
 * Follows the same conventions as @pgpmjs/env:
 *   - getEnvVars(env)    → raw env parser, no defaults, conditional spread
 *   - llmDefaults        → defaults constant
 *   - getEnvOptions(overrides, env) → merged: defaults → env → overrides
 *
 * Environment variables:
 *   EMBEDDER_PROVIDER  - Embedding provider name (default: 'ollama')
 *   EMBEDDER_MODEL     - Embedding model (default: 'nomic-embed-text')
 *   EMBEDDER_BASE_URL  - Embedding provider URL (default: 'http://localhost:11434')
 *   CHAT_PROVIDER      - Chat provider name (default: 'ollama')
 *   CHAT_MODEL         - Chat model (default: 'llama3')
 *   CHAT_BASE_URL      - Chat provider URL (default: 'http://localhost:11434')
 */

import {
  getConstructiveEnvOptions,
  getGraphQLEnvVars
} from '@constructive-io/graphql-env';
import { llmDefaults as constructiveLlmDefaults } from '@constructive-io/graphql-types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LlmProviderConfig {
  provider?: string;
  model?: string;
  baseUrl?: string;
}

export interface LlmEnvOptions {
  embedding?: LlmProviderConfig;
  chat?: LlmProviderConfig;
}

/** Fully resolved LLM config — every field guaranteed present after merge. */
export interface ResolvedLlmEnvOptions {
  embedding: Required<LlmProviderConfig>;
  chat: Required<LlmProviderConfig>;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

export const llmDefaults: ResolvedLlmEnvOptions = {
  embedding: { ...constructiveLlmDefaults.embedder },
  chat: { ...constructiveLlmDefaults.chat }
};

// ─── Env Parsing ────────────────────────────────────────────────────────────

/**
 * Parse LLM-related environment variables.
 *
 * Returns only keys that are actually set — no defaults mixed in.
 * Follows the @pgpmjs/env `getEnvVars(env)` pattern.
 *
 * @param env - Environment object to read from (defaults to process.env)
 */
export const getEnvVars = (env: NodeJS.ProcessEnv = process.env): LlmEnvOptions => {
  const llm = getGraphQLEnvVars(env).llm;

  return {
    ...(llm?.embedder && { embedding: llm.embedder }),
    ...(llm?.chat && { chat: llm.chat })
  };
};

// ─── Merged Resolution ──────────────────────────────────────────────────────

/**
 * Get fully resolved LLM configuration by merging:
 *   1. llmDefaults
 *   2. Environment variables
 *   3. Runtime overrides
 *
 * @param overrides - Runtime overrides to apply last
 * @param env - Environment object to read from (defaults to process.env)
 */
export const getEnvOptions = (
  overrides: LlmEnvOptions = {},
  env: NodeJS.ProcessEnv = process.env
): ResolvedLlmEnvOptions => {
  const resolved = getConstructiveEnvOptions(
    {
      llm: {
        ...(overrides.embedding && { embedder: overrides.embedding }),
        ...(overrides.chat && { chat: overrides.chat })
      }
    },
    process.cwd(),
    env
  ).llm;

  return {
    embedding: {
      ...llmDefaults.embedding,
      ...resolved?.embedder
    },
    chat: {
      ...llmDefaults.chat,
      ...resolved?.chat
    },
  };
};

/**
 * @deprecated Use `getEnvOptions()` instead. Kept for backward compatibility.
 */
export const getLlmEnvOptions = (
  env: NodeJS.ProcessEnv = process.env
): ResolvedLlmEnvOptions => getEnvOptions({}, env);
