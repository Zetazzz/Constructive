import { getEnvOptions } from '../src/env';

describe('getEnvOptions', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns defaults when no env vars set', () => {
    delete process.env.CHAT_PROVIDER;
    delete process.env.CHAT_MODEL;
    delete process.env.CHAT_BASE_URL;
    delete process.env.EMBEDDER_PROVIDER;
    delete process.env.EMBEDDER_MODEL;
    delete process.env.EMBEDDER_BASE_URL;

    const opts = getEnvOptions();
    expect(opts.chat.provider).toBe('ollama');
    expect(opts.chat.model).toBe('llama3');
    expect(opts.chat.baseUrl).toBe('http://localhost:11434');
    expect(opts.embedding.provider).toBe('ollama');
    expect(opts.embedding.model).toBe('nomic-embed-text');
    expect(opts.embedding.baseUrl).toBe('http://localhost:11434');
  });

  it('reads from env vars', () => {
    process.env.CHAT_PROVIDER = 'openai';
    process.env.CHAT_MODEL = 'gpt-4';
    process.env.CHAT_BASE_URL = 'https://api.openai.com';
    process.env.EMBEDDER_PROVIDER = 'cohere';
    process.env.EMBEDDER_MODEL = 'embed-v3';
    process.env.EMBEDDER_BASE_URL = 'https://api.cohere.ai';

    const opts = getEnvOptions();
    expect(opts.chat.provider).toBe('openai');
    expect(opts.chat.model).toBe('gpt-4');
    expect(opts.chat.baseUrl).toBe('https://api.openai.com');
    expect(opts.embedding.provider).toBe('cohere');
    expect(opts.embedding.model).toBe('embed-v3');
    expect(opts.embedding.baseUrl).toBe('https://api.cohere.ai');
  });
});
