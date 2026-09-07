const js = require('@eslint/js');

module.exports = [
  {
    ignores: ['node_modules/**', 'mock-provider/**', 'mock-provider/node_modules/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        setInterval: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      // Express error handlers must declare 4-arity (err, req, res, next)
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
];