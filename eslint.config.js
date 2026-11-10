import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    // src/client.tsx ditulis scripts/generate-client.ts, bukan tangan.
    {
        ignores: [
            'dist/**',
            'docs/**',
            'parity/**',
            'eslint.config.js',
            'src/client.tsx',
        ],
    },
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,
    {
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
        linterOptions: { reportUnusedDisableDirectives: 'error' },
        plugins: { 'react-hooks': reactHooks },
        rules: {
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            // Kode yang di-deploy mencatat lewat error reporting, bukan console.
            'no-console': 'error',
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'error',
            // Repo ini menulis bentuk data dengan `type`, dan schema zod adalah sumbernya.
            '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': [
                'error',
                {
                    considerDefaultExhaustiveForUnions: false,
                    requireDefaultForNonUnion: true,
                },
            ],
            '@typescript-eslint/restrict-template-expressions': [
                'error',
                { allowNumber: true, allowNever: true },
            ],
            '@typescript-eslint/no-confusing-void-expression': [
                'error',
                { ignoreArrowShorthand: true },
            ],
            // `||` pada teks dan boolean sengaja memperlakukan '' dan false sebagai kosong.
            '@typescript-eslint/prefer-nullish-coalescing': [
                'error',
                { ignorePrimitives: { string: true, boolean: true } },
            ],
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_',
                    ignoreRestSiblings: true,
                },
            ],
        },
    },
    {
        // noUncheckedIndexedAccess membuat `rows[0]!` wajar di test, dan tiruan sering berisi fungsi kosong.
        files: ['**/test/**'],
        rules: {
            'no-console': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/no-empty-function': 'off',
        },
    },
    {
        // Skrip berjalan di terminal, jadi console adalah keluarannya.
        files: ['scripts/**'],
        rules: { 'no-console': 'off' },
    },
);
