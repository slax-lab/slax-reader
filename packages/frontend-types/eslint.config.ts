import type { Linter } from 'eslint'
import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettierConfig from 'eslint-config-prettier'

const config: Linter.Config[] = [
  { ignores: ['eslint.config.ts'] },
  eslint.configs.recommended,
  ...(tseslint.configs.recommended as Linter.Config[]),
  prettierConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-empty-object-type': 'off'
    }
  }
]

export default config
