module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    parserOptions: {
        tsconfigRootDir: __dirname,
        project: ['./tsconfig.json'],
    },
    plugins: [
        '@typescript-eslint',
    ],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:@typescript-eslint/recommended-requiring-type-checking',
        'airbnb-typescript/base',
    ],
    rules: {
        indent: ['error', 4, {
            'SwitchCase': 1,
        }],
        'max-len': ['error', 120],
        'padded-blocks': 'off',
        'object-curly-newline': ['error', {
            'ImportDeclaration': 'never',
        }],
        'linebreak-style': 'off',

        'no-unused-vars': 'off',
        'no-restricted-syntax': 'off',
        'no-use-before-define': 'off',
        'no-plusplus': ['error', {
            allowForLoopAfterthoughts: true,
        }],
        'no-underscore-dangle': 'off',
        'no-continue': 'off',

        '@typescript-eslint/indent': ['error', 4],
        '@typescript-eslint/semi': ['error', 'always'],
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/ban-ts-comment': 'off',
    }
};
