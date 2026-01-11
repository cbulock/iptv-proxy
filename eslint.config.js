import js from '@eslint/js';
import globals from 'globals';
import pluginVue from 'eslint-plugin-vue';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'quotes': ['warn', 'single', { avoidEscape: true }],
      'semi': ['warn', 'always'],
      'indent': ['warn', 2, { SwitchCase: 1 }],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['admin/src/**/*.vue', 'admin/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'warn',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-indent': 'off',
      'vue/attributes-order': 'off',
    },
  },
  {
    ignores: [
      'node_modules/',
      'public/',
      'data/',
      'config/',
      'admin/dist/',
      'admin/node_modules/',
      'admin/vite.config.js',
      'vite.config.js',
    ],
  },
];
