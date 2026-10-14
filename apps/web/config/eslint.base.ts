import type { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import vueScopedCss from 'eslint-plugin-vue-scoped-css'
import vueParser from 'vue-eslint-parser'
import typescriptParser from '@typescript-eslint/parser'
import prettierConfig from 'eslint-config-prettier'
import vue from 'eslint-plugin-vue'

const config: Linter.Config[] = [
  {
    ignores: [
      '**/node_modules/**',
      '**/build/**',
      'project-env.d.ts',
      '**/.wrangler/**',
      '**/.nuxt/**',
      '**/.wxt/**',
      '**/dist/**',
      'pnpm-lock.yaml',
      '.node-modules-inspector',
      '**/public/**',
      '.claude/',
      '.github/',
      '**/eslint.config.ts',
      'commons/types/eslint.config.ts'
    ]
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: typescriptParser,
        sourceType: 'module',
        ecmaVersion: 'latest',
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  ...(vueScopedCss.configs['flat/recommended'] as Linter.Config[]).map(c => ({ ...c, files: ['**/*.vue'] })),
  ...(vue.configs['flat/essential'] as Linter.Config[]),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin
    },
    rules: {
      ...(tseslint.configs.recommended as unknown as { rules?: Linter.RulesRecord }).rules,
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  },
  {
    rules: {
      camelcase: ['error', { properties: 'never' }],
      'vue/multi-word-component-names': 'off'
    }
  },
  prettierConfig
]

export default config
