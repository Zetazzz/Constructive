const js = require('@eslint/js');
const globals = require('globals');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const simpleImportSort = require('eslint-plugin-simple-import-sort');
const unusedImports = require('eslint-plugin-unused-imports');

const sharedRules = {
  indent: ['error', 2],
  quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
  'quote-props': ['error', 'as-needed'],
  semi: ['error', 'always'],
  'simple-import-sort/imports': 1,
  'simple-import-sort/exports': 1,
  'unused-imports/no-unused-imports': 1,
  'prefer-const': 0,
  'no-case-declarations': 0,
  'no-console': 0,
};

module.exports = [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.tanstack/**',
      '**/.output/**',
      '**/routeTree.gen.ts',
    ],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: sharedRules,
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...sharedRules,
      '@typescript-eslint/no-unused-vars': [
        1,
        { argsIgnorePattern: 'React|res|next|^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 0,
      '@typescript-eslint/no-var-requires': 0,
      '@typescript-eslint/ban-ts-comment': 0,
      '@typescript-eslint/no-unsafe-declaration-merging': 0,
      '@typescript-eslint/no-empty-object-type': 0,
      'no-implicit-globals': 0,
    },
  },
];
