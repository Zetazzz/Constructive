/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        babelConfig: false,
        tsconfig: '__tests__/tsconfig.json',
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/*'],
  testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(jsx?|tsx?)$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  modulePathIgnorePatterns: ['dist/*'],
  testPathIgnorePatterns: process.env.AGENT_LIVE_READY === '1' ? [] : ['\\.live\\.test\\.ts$'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@test/(.*)$': '<rootDir>/../tools/test/$1',
    '^agentic-kit$': '<rootDir>/../agentic-kit/src',
    '^@agentic-kit/(.*)$': '<rootDir>/../$1/src',
  },
  setupFiles: ['<rootDir>/../tools/test/load-env.js'],
};
