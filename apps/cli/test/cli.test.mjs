import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fixture, apiKey, uid, version } from './helpers.mjs'

function json(result, ok = true) {
  assert.equal(result.code, ok ? 0 : 1, result.stderr + result.stdout)
  const data = JSON.parse(result.stdout)
  assert.equal(data.ok, ok)
  assert.ok(!result.stdout.includes(apiKey), 'full key leaked')
  return data
}

test('version/help, authentication compatibility and credential cleanup', async t => {
  const f = await fixture(t)
  assert.equal((await f.run(['--version'])).stdout.trim(), version)
  assert.match((await f.run(['--help'])).stdout, /restore/)
  assert.equal(json(await f.run(['whoami', '--json']), false).error.code, 'not_logged_in')
  assert.equal(json(await f.run(['login', '--json']), false).error.code, 'missing_api_key')
  assert.equal(json(await f.run(['login', '--api-key', 'invalid', '--json']), false).error.code, 'invalid_api_key')
  json(await f.login())
  const who = json(await f.run(['whoami', '--json']))
  assert.equal(who.data.user.username, 'fixture')
  assert.equal(who.data.apiBase, f.base)
  assert.ok(who.data.apiKeyPrefix.endsWith('...'))
  assert.match((await f.run(['whoami'])).stdout, /Current User/)
  assert.ok(f.requests.filter(r => r.path === '/v1/user/me').every(r => r.headers['x-api-key'] === apiKey))
  json(await f.run(['logout', '--json']))
  assert.equal(json(await f.run(['list', '--json']), false).error.code, 'not_logged_in')
  f.state.code = 401
  assert.equal(json(await f.run(['login', '--api-key', apiKey, '--api-base', f.base, '--json']), false).error.code, 'api_200')
  assert.equal(json(await f.run(['whoami', '--json']), false).error.code, 'not_logged_in')
})

test('add/list alias/get preserve request and output contracts', async t => {
  const f = await fixture(t)
  await f.login()
  const added = json(await f.run(['add', 'example.com/article', '--title', 'Title', '--description', 'Desc', '--tags', 'one, two, ,three', '--archive', '--json']))
  assert.equal(added.data.url, 'https://example.com/article')
  const request = f.requests.find(r => r.path === '/v1/bookmark/add_url')
  assert.deepEqual(request.body, { target_url: 'https://example.com/article', target_title: 'Title', description: 'Desc', tags: ['one', 'two', 'three'], is_archive: true })
  assert.equal(request.method, 'POST')
  const list = json(await f.run(['list', '--page', '2', '--size', '5', '--filter', 'starred', '--json']))
  assert.equal(list.data.items[0].id, uid)
  assert.equal(list.data.items[0].snapshot, `https://r.slax.com/b/${uid}`)
  assert.equal(list.data.items[0].origin, 'https://example.com/article')
  assert.deepEqual(f.requests.find(r => r.path === '/v1/bookmark/list').query, { page: '2', size: '5', filter: 'starred' })
  assert.deepEqual(json(await f.run(['ls', '--page', '2', '--size', '5', '--filter', 'starred', '--json'])).data, list.data)
  assert.match((await f.run(['list'])).stdout, /Fixture article/)
  assert.equal(json(await f.run(['get', uid, '--json'])).data.content, 'Fixture content')
  assert.equal(json(await f.run(['get', uid, '--markdown', '--json'])).data.content, '# Fixture content')
  assert.deepEqual(f.requests.find(r => r.path === '/v1/bookmark/content').body, { bookmark_uid: uid })
  assert.ok(f.requests.some(r => r.path === '/v1/bookmark/content' && r.headers.accept === 'text/markdown'))
  f.state.contentCode = 404
  assert.equal(json(await f.run(['get', uid, '--json'])).data.content, null)
  f.state.contentCode = 500
  assert.equal(json(await f.run(['get', uid, '--json']), false).error.code, 'api_500')
})

test('organize commands, numeric IDs, validation/API/network failures', async t => {
  const f = await fixture(t)
  await f.login()
  for (const [command, endpoint, body] of [
    ['archive', 'archive', { bookmark_uid: uid, status: 'archive' }],
    ['unarchive', 'archive', { bookmark_uid: uid, status: 'inbox' }],
    ['star', 'star', { bookmark_uid: uid, status: 'star' }],
    ['unstar', 'star', { bookmark_uid: uid, status: 'unstar' }],
    ['delete', 'trash', { bookmark_id: 42 }],
    ['restore', 'trash_revert', { bookmark_id: 42 }],
  ]) {
    json(await f.run([command, uid, '--json']))
    const request = f.requests.filter(r => r.path === `/v1/bookmark/${endpoint}`).at(-1)
    assert.equal(request.method, 'POST')
    assert.deepEqual(request.body, body)
  }
  f.state.missingId = true
  const before = f.requests.filter(r => r.path === '/v1/bookmark/trash').length
  assert.equal(json(await f.run(['delete', uid, '--json']), false).error.code, 'bookmark_id_missing')
  assert.equal(f.requests.filter(r => r.path === '/v1/bookmark/trash').length, before)
  assert.equal(json(await f.run(['list', '--page', '0', '--json']), false).error.code, 'invalid_page')
  assert.equal(json(await f.run(['list', '--size', '0', '--json']), false).error.code, 'invalid_size')
  assert.equal(json(await f.run(['add', 'http://', '--json']), false).error.code, 'invalid_url')
  for (const code of [401, 403, 500]) {
    f.state.code = code; f.state.apiCode = code
    assert.equal(json(await f.run(['list', '--json']), false).error.code, `api_${code}`)
  }
  const failed = await f.run(['login', '--api-key', apiKey, '--api-base', 'http://127.0.0.1:1', '--json'])
  assert.equal(json(failed, false).error.code, 'network_error')
})

test('skill sync, selective source, install and upgrade use isolated subprocesses', async t => {
  const f = await fixture(t)
  const first = json(await f.run(['skill', '--check', '--json']))
  assert.equal(first.data.inSync, false)
  assert.equal(json(await f.run(['skill', '--sync', '--json'])).data.action, 'synced')
  assert.equal(json(await f.run(['skill', '--sync', '--json'])).data.action, 'in_sync')
  assert.equal(json(await f.run(['skill', '--sync', '--force', '--json'])).data.action, 'synced')
  const commands = (await readFile(f.commandLog, 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(commands.length, 2)
  assert.deepEqual(commands[0].args, ['-y', 'skills', 'add', 'https://github.com/slax-lab/slax-reader/tree/dev/apps/cli/skills/slax-reader', '--skill', 'slax-reader', '-g', '-y'])
  const installed = json(await f.run(['install', '--json']))
  assert.equal(installed.data.installed, true)
  assert.equal(installed.data.skillInstalled, true)
  const partial = json(await f.run(['install', '--json'], { CLI_FAIL_COMMAND: 'npx' }))
  assert.equal(partial.data.skillInstalled, false)
  const next = '99.0.0'
  const upgrade = json(await f.run(['upgrade', '--json'], { CLI_REGISTRY_VERSION: next }))
  assert.equal(upgrade.data.upgraded, true)
  assert.equal(upgrade.data.skillsAction, 'synced')
  assert.equal(json(await f.run(['skill', '--check', '--json'])).data.stamp, next)
  const failed = json(await f.run(['skill', '--sync', '--force', '--json'], { CLI_FAIL_COMMAND: 'npx' }), false)
  assert.equal(failed.error.code, 'skill_sync_failed')
  assert.equal(json(await f.run(['skill', '--check', '--json'])).data.stamp, next)
  assert.equal(json(await f.run(['upgrade', '--check', '--json'], { CLI_REGISTRY_VERSION: next })).data.updateAvailable, true)
  assert.equal(json(await f.run(['upgrade', '--check', '--json'], { CLI_REGISTRY_FAIL: '1' }), false).error.code, 'update_check_failed')
  const npm = (await readFile(f.commandLog, 'utf8')).trim().split('\n').map(JSON.parse).filter(c => c.name === 'npm')
  assert.ok(npm.every(c => c.args.join(' ') === 'install -g @slax-lab/reader-cli@latest'))
})

test('cached hints, suppressed notifiers and unavailable registry remain best effort', async t => {
  const f = await fixture(t)
  await f.login()
  await f.writeState('update-state.json', { latestVersion: '99.0.0', checkedAt: Date.now() })
  await f.writeState('skills.stamp', '0.0.1')
  const enabled = { CI: '', SLAX_NO_UPDATE_NOTIFIER: '', SLAX_NO_SKILLS_NOTIFIER: '' }
  const hints = json(await f.run(['whoami', '--json'], enabled))._hints
  assert.equal(hints.upgrade.latest, '99.0.0')
  assert.equal(hints.skill.target, version)
  assert.equal(json(await f.run(['whoami', '--json']))._hints, undefined)
  await f.writeState('update-state.json', { latestVersion: version, checkedAt: 0 })
  json(await f.run(['whoami', '--json'], { ...enabled, CLI_REGISTRY_FAIL: '1' }))
})
