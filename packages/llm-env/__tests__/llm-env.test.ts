import { getLlmEnvOptions, LLM_DEFAULTS } from '../src';

describe('getLlmEnvOptions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.EMBEDDER_PROVIDER;
    delete process.env.EMBEDDER_MODEL;
    delete process.env.EMBEDDER_BASE_URL;
    delete process.env.CHAT_PROVIDER;
    delete process.env.CHAT_MODEL;
    delete process.env.CHAT_BASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns defaults when no env vars are set', () => {
    const opts = getLlmEnvOptions();
    expect(opts.embedding.provider).toBe('ollama');
    expect(opts.embedding.model).toBe('nomic-embed-text');
    expect(opts.embedding.baseUrl).toBe('http://localhost:11434');
    expect(opts.chat.provider).toBe('ollama');
    expect(opts.chat.model).toBe('llama3');
    expect(opts.chat.baseUrl).toBe('http://localhost:11434');
  });

  it('overrides embedding config from env vars', () => {
    process.env.EMBEDDER_PROVIDER = 'openai';
    process.env.EMBEDDER_MODEL = 'text-embedding-3-small';
    process.env.EMBEDDER_BASE_URL = 'https://api.openai.com';

    const opts = getLlmEnvOptions();
    expect(opts.embedding.provider).toBe('openai');
    expect(opts.embedding.model).toBe('text-embedding-3-small');
    expect(opts.embedding.baseUrl).toBe('https://api.openai.com');
    // Chat should still be defaults
    expect(opts.chat.provider).toBe('ollama');
  });

  it('overrides chat config from env vars', () => {
    process.env.CHAT_PROVIDER = 'openai';
    process.env.CHAT_MODEL = 'gpt-4o';
    process.env.CHAT_BASE_URL = 'https://api.openai.com';

    const opts = getLlmEnvOptions();
    expect(opts.chat.provider).toBe('openai');
    expect(opts.chat.model).toBe('gpt-4o');
    expect(opts.chat.baseUrl).toBe('https://api.openai.com');
    // Embedding should still be defaults
    expect(opts.embedding.provider).toBe('ollama');
  });

  it('supports partial overrides', () => {
    process.env.EMBEDDER_MODEL = 'mxbai-embed-large';

    const opts = getLlmEnvOptions();
    expect(opts.embedding.provider).toBe('ollama');
    expect(opts.embedding.model).toBe('mxbai-embed-large');
    expect(opts.embedding.baseUrl).toBe('http://localhost:11434');
  });
});

describe('LLM_DEFAULTS', () => {
  it('exports the default values', () => {
    expect(LLM_DEFAULTS.embedding.provider).toBe('ollama');
    expect(LLM_DEFAULTS.embedding.model).toBe('nomic-embed-text');
    expect(LLM_DEFAULTS.chat.model).toBe('llama3');
  });
});
