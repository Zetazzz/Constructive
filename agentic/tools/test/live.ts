export type SuiteLevel = 'smoke' | 'extended' | 'off';

export function suiteLevel(suiteEnvVar: string): SuiteLevel {
  const value = process.env[suiteEnvVar];
  if (value === 'smoke') return 'smoke';
  if (value === 'extended') return 'extended';
  return 'off';
}

export function liveDescribe(
  suiteEnvVar: string,
  minLevel: 'smoke' | 'extended',
  name: string,
): jest.Describe {
  const level = suiteLevel(suiteEnvVar);
  if (level === 'off') return describe.skip.bind(describe, name) as unknown as jest.Describe;
  if (minLevel === 'extended' && level !== 'extended') {
    return describe.skip.bind(describe, name) as unknown as jest.Describe;
  }
  return describe.bind(undefined, name) as unknown as jest.Describe;
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}
