import test from 'node:test'
import assert from 'node:assert/strict'

import { forwardedArguments, packageCommands, resolveCommand } from './run-app.mjs'

test('forwardedArguments accepts the documented separator and direct arguments', () => {
  assert.deepEqual(forwardedArguments(['--', 'dev']), ['dev'])
  assert.deepEqual(forwardedArguments(['build']), ['build'])
})

test('resolveCommand maps friendly aliases to app package scripts', () => {
  assert.equal(resolveCommand('typecheck', { typecheck: 'compile' }), 'compile')
  assert.equal(resolveCommand('build', { typecheck: 'compile' }), 'build')
})

test('packageCommands follows app package scripts and omits lifecycle hooks', () => {
  const webCommands = packageCommands(new URL('../apps/web/package.json', import.meta.url))
  const commands = packageCommands(new URL('../apps/extension/package.json', import.meta.url))
  assert.ok(webCommands.includes('preview'))
  assert.ok(commands.includes('dev'))
  assert.ok(commands.includes('build:vendor'))
  assert.ok(!commands.includes('predev'))
})
