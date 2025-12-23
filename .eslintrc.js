module.exports = {
    parser: '@typescript-eslint/parser',
    parserOptions: {
        project: 'tsconfig.json',
        tsconfigRootDir: __dirname,
        sourceType: 'module',
    },
    plugins: [ '@typescript-eslint' ],
    extends: [
        'eslint:recommended',
    ],
    root: true,
    env: {
        node: true,
        jest: true,
    },
    ignorePatterns: [ '.eslintrc.js', 'dist/**/*', 'node_modules/**/*' ],
    rules: {
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unused-vars': [ 'error', { 'argsIgnorePattern': '^_' } ],
        'no-unused-vars': 'off', // Turn off base rule as it conflicts with @typescript-eslint version
        'no-console': 'warn',
    },
};
