import type { Linter } from 'eslint'
import config from './config/eslint.base'
import typescriptParser from '@typescript-eslint/parser'
import unocss from '@unocss/eslint-plugin'
import simpleImportSort from 'eslint-plugin-simple-import-sort'

const extConfig: Linter.Config[] = [
  ...(config as Linter.Config[]),
  {
    ignores: ['node_modules/', 'build/', '.wxt/', 'dist/']
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    plugins: {
      'simple-import-sort': simpleImportSort as never,
      '@unocss': unocss as never
    },
    rules: {
      '@unocss/order': 'warn',
      '@unocss/order-attributify': 'warn',
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            [`^vue$`, `^vue-router$`, `^ant-design-vue$`, `^echarts$`],
            [`.*\\.vue$`],
            [`.*/assets/.*`, `^@/assets$`],
            [`.*/config/.*`, `^@/config$`],
            [`.*/hooks/.*`, `^@/hooks$`],
            [`.*/plugins/.*`, `^@/plugins$`],
            [`.*/router/.*`, `^@/router$`],
            [`^@/services$`, `^@/services/.*`],
            [`.*/store/.*`, `^@/store$`],
            [`.*/utils/.*`, `^@/utils$`],
            [`^`],
            [`^type `]
          ]
        }
      ],
      'simple-import-sort/exports': 'error'
    }
  }
]

export default extConfig
