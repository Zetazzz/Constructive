#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const requestedModel = process.env.OLLAMA_LIVE_MODEL || 'qwen3.5:4b';
const requestedEmbedModel = process.env.OLLAMA_LIVE_EMBED_MODEL || 'nomic-embed-text:latest';
const requestedSuite = process.argv[2] || process.env.OLLAMA_LIVE_SUITE || 'smoke';
const validSuites = new Set(['smoke', 'extended']);

async function main() {
  if (!validSuites.has(requestedSuite)) {
    console.error(
      `[ollama-live] invalid suite '${requestedSuite}'. Use one of: ${Array.from(validSuites).join(', ')}`
    );
    process.exit(1);
  }

  let models;

  try {
    const response = await fetch(`${baseUrl}/api/tags`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    models = Array.isArray(payload.models) ? payload.models.map((model) => model.name) : [];
  } catch (error) {
    console.log(
      `[ollama-live] skipping live tests: unable to reach ${baseUrl} (${formatError(error)})`
    );
    process.exit(0);
  }

  if (!models.includes(requestedModel)) {
    const available = models.length > 0 ? models.join(', ') : '(none)';
    console.log(
      `[ollama-live] skipping live tests: model '${requestedModel}' is not installed. Available models: ${available}`
    );
    process.exit(0);
  }

  const hasEmbedModel = models.includes(requestedEmbedModel);
  console.log(
    `[ollama-live] running ${requestedSuite} live tests against ${baseUrl} using model '${requestedModel}'`
  );
  if (!hasEmbedModel) {
    console.log(
      `[ollama-live] embedding scenario skipped: model '${requestedEmbedModel}' is not installed`
    );
  }

  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(
    pnpmCommand,
    ['exec', 'jest', '--runInBand', '--runTestsByPath', '__tests__/ollama.live.test.ts', '--verbose', '--forceExit'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        OLLAMA_LIVE_READY: '1',
        OLLAMA_LIVE_SUITE: requestedSuite,
        OLLAMA_LIVE_EMBED_MODEL: requestedEmbedModel,
        OLLAMA_LIVE_HAS_EMBED_MODEL: hasEmbedModel ? '1' : '0',
      },
    }
  );

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 1);
}

function formatError(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

main().catch((error) => {
  console.error(`[ollama-live] failed to run live tests: ${formatError(error)}`);
  process.exit(1);
});
