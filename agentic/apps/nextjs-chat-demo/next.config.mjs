/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    'agentic-kit',
    '@agentic-kit/agent',
    '@agentic-kit/react',
    '@agentic-kit/openai',
    '@agentic-kit/anthropic',
    '@agentic-kit/ollama',
  ],
  experimental: {
    externalDir: true,
  },
  webpack: (config) => {
    // The agentic-kit packages are TS source with .js extension imports
    // (`from './foo.js'`). webpack doesn't auto-rewrite those to .ts; we
    // teach it to fall back to the .ts source.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
