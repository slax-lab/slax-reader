import { runApp } from './run-app.mjs'

runApp({
  commandName: 'web',
  appLabel: 'Web',
  environmentApp: 'web',
  packageName: '@apps/slax-reader-dweb',
  packagePath: 'apps/web/package.json'
})
