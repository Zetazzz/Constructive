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
