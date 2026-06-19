import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              // The app composes features, ui and data-access.
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:feature', 'type:ui', 'type:data'],
            },
            {
              // Smart feature libs may use other features, ui and data-access.
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: ['type:feature', 'type:ui', 'type:data'],
            },
            {
              // Presentational atoms stay pure — ui only.
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui'],
            },
            {
              // Stores / clients / models — the bottom layer.
              sourceTag: 'type:data',
              onlyDependOnLibsWithTags: ['type:data'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
