/**
 * env — LLM provider configuration from environment variables
 *
 * Environment variables:
 *   EMBEDDER_PROVIDER  - Embedding provider ('ollama')
 *   EMBEDDER_MODEL     - Embedding model (default: 'nomic-embed-text')
 *   EMBEDDER_BASE_URL  - Embedding provider URL (default: 'http://localhost:11434')
 *   CHAT_PROVIDER      - Chat provider ('ollama')
 *   CHAT_MODEL         - Chat model (default: 'llama3')
 *   CHAT_BASE_URL      - Chat provider URL (default: 'http://localhost:11434')
 */

const DEFAULTS = {
  embedding: {
    provider: 'ollama',
    model: 'nomic-embed-text',
    baseUrl: 'http://localhost:11434',
  },
  chat: {
    provider: 'ollama',
    model: 'llama3',
    baseUrl: 'http://localhost:11434',
  },
} as const;

export interface ProviderConfig {
  provider: string;
  model: string;
  baseUrl: string;
}

export interface EnvOptions {
  embedding: ProviderConfig;
  chat: ProviderConfig;
}

export function getEnvOptions(): EnvOptions {
  return {
    embedding: {
      provider: process.env.EMBEDDER_PROVIDER ?? DEFAULTS.embedding.provider,
      model: process.env.EMBEDDER_MODEL ?? DEFAULTS.embedding.model,
      baseUrl: process.env.EMBEDDER_BASE_URL ?? DEFAULTS.embedding.baseUrl,
    },
    chat: {
      provider: process.env.CHAT_PROVIDER ?? DEFAULTS.chat.provider,
      model: process.env.CHAT_MODEL ?? DEFAULTS.chat.model,
      baseUrl: process.env.CHAT_BASE_URL ?? DEFAULTS.chat.baseUrl,
    },
  };
}
