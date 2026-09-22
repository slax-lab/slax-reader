import { runApp } from './run-app.mjs'

runApp({
  commandName: 'extension',
  appLabel: 'Extension',
  environmentApp: 'extension',
  packageName: '@apps/slax-reader-extensions',
  packagePath: 'apps/extension/package.json',
  aliases: {
    typecheck: 'compile',
    package: 'zip'
  }
})
