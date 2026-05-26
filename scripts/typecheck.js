#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const packageDirs = [
  'packages/protocol',
  'packages/agentic-kit',
  'packages/anthropic',
  'packages/openai',
  'packages/ollama',
  'packages/agent',
];

const configs = packageDirs.flatMap((dir) => [
  `${dir}/tsconfig.json`,
  `${dir}/__tests__/tsconfig.json`,
]);

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

for (const configPath of configs) {
  console.log(`[typecheck] ${configPath}`);
  const result = spawnSync(pnpmCommand, ['exec', 'tsc', '--noEmit', '-p', configPath], {
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
