#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { dirname, join } = require('node:path');

function findEnvFile(start) {
  let dir = start;
  while (true) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const envPath = findEnvFile(__dirname);
if (envPath) {
  require('dotenv').config({ path: envPath });
}

const requestedSuite = process.argv[2] || process.env.OPENAI_LIVE_SUITE || 'smoke';
const validSuites = new Set(['smoke', 'extended']);

if (!validSuites.has(requestedSuite)) {
  console.error(
    `[openai-live] invalid suite '${requestedSuite}'. Use one of: ${Array.from(validSuites).join(', ')}`
  );
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  console.log('[openai-live] skipping live tests: OPENAI_API_KEY is not set');
  process.exit(0);
}

console.log(`[openai-live] running ${requestedSuite} live tests against the OpenAI API`);

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(
  pnpmCommand,
  ['exec', 'jest', '--runInBand', '--runTestsByPath', '__tests__/openai.live.test.ts', '--verbose', '--forceExit'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      OPENAI_LIVE_READY: '1',
      OPENAI_LIVE_SUITE: requestedSuite,
    },
  }
);

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
