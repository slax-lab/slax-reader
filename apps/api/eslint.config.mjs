import tseslint from 'typescript-eslint'
import prettierRecommend from 'eslint-plugin-prettier/recommended'
import typescriptParser from '@typescript-eslint/parser'
import prettierConfig from 'eslint-config-prettier'
import { fileURLToPath } from 'node:url'

const files = ['{src,script}/**/*.{ts,tsx,mjs,js}', 'prisma/*.config.ts']

export default [
  {
    ignores: ['**/node_modules/**', '**/build/**', '**/dist/**', '**/.wrangler/**', '**/.cache/**', '**/test/**', '.tmp-root-tooling-*/**']
  },
  {
    files: ['{src,script}/**/*.{ts,tsx}', 'prisma/*.config.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: fileURLToPath(new URL('./', import.meta.url))
      }
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error'
    }
  },
  { ...prettierRecommend, files },
  { ...prettierConfig, files }
]
