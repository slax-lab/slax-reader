import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRelease } from './cli-release.mjs'

const source = fileURLToPath(new URL('../', import.meta.url))
const sha = 'a'.repeat(40)

test('release process packs reproducibly and publishes exact bytes with resumable HTTP orchestration', { timeout: 90000 }, t => {
  const root = mkdtempSync(join(tmpdir(), 'cli-release-process-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'tooling'))
  mkdirSync(join(root, 'apps/cli'), { recursive: true })
  mkdirSync(join(root, 'packages/contracts'), { recursive: true })
  for (const name of ['cli-release.mjs', 'pnpm-command.mjs']) copyFileSync(join(source, 'tooling', name), join(root, 'tooling', name))
  for (const name of ['package.json', 'pnpm-workspace.yaml']) copyFileSync(join(source, name), join(root, name))
  copyFileSync(join(source, 'packages/contracts/package.json'), join(root, 'packages/contracts/package.json'))
  mkdirSync(join(root, 'apps/cli/node_modules/@slax-reader/contracts'), { recursive: true })
  copyFileSync(join(source, 'packages/contracts/package.json'), join(root, 'apps/cli/node_modules/@slax-reader/contracts/package.json'))
  for (const name of ['package.json', 'LICENSE', 'README.md']) copyFileSync(join(source, 'apps/cli', name), join(root, 'apps/cli', name))
  const manifestPath = join(root, 'apps/cli/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '1.0.0' }, null, 2) + '\n')
  mkdirSync(join(root, 'apps/cli/dist'))
  writeFileSync(join(root, 'apps/cli/dist/index.js'), '#!/usr/bin/env node\nconsole.log("release fixture")\n', { mode: 0o755 })
  const fakebin = join(root, 'bin')
  mkdirSync(fakebin)
  writeFileSync(join(fakebin, 'git'), `#!${process.execPath}\nimport fs from 'node:fs'; fs.appendFileSync(process.env.RELEASE_COMMANDS,JSON.stringify(process.argv.slice(2))+'\\n');if(process.argv[2]==='merge-base'){process.exit(process.env.FAIL_ANCESTOR?'1':0)}console.log('${sha}')`, { mode: 0o755 })
  const commandLog = join(root, 'commands.jsonl')
  const registry = join(root, 'registry.json')
  const remote = join(root, 'github.json')
  const calls = join(root, 'http.jsonl')
  writeFileSync(registry, 'null')
  writeFileSync(remote, 'null')
  writeFileSync(join(fakebin, 'npm'), `#!${process.execPath}\nimport fs from 'node:fs';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';if(process.argv[2]==='--version'){console.log('12.2.0');process.exit(0)}if(process.argv[2]!=='publish')throw Error('Unexpected command');fs.appendFileSync(process.env.RELEASE_COMMANDS,JSON.stringify(process.argv.slice(2))+'\\n');const bytes=fs.readFileSync(process.argv[3]);const pkg=JSON.parse(execFileSync('tar',['-xOf',process.argv[3],'package/package.json'],{encoding:'utf8'}));pkg.dist={integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64'),tarball:'https://registry.npmjs.org/archive.tgz'};fs.writeFileSync(process.env.RELEASE_REGISTRY,JSON.stringify(pkg));`, { mode: 0o755 })
  const preload = join(root, 'network.mjs')
  writeFileSync(preload, `import fs from 'node:fs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
globalThis.fetch=async(input,options={})=>{const url=new URL(input);fs.appendFileSync(process.env.RELEASE_HTTP,JSON.stringify({url:url.href,method:options.method||'GET',body:typeof options.body==='string'?options.body:undefined})+'\\n');const result=(value,status=200)=>new Response(JSON.stringify(value),{status});
if(url.hostname==='registry.npmjs.org'){if(url.pathname==='/archive.tgz')return new Response(fs.readFileSync(process.env.RELEASE_ARCHIVE));const pkg=read(process.env.RELEASE_REGISTRY);return pkg?result(pkg):result({},404)}
if(url.hostname==='uploads.github.com'){let remote=read(process.env.RELEASE_REMOTE);const name=url.searchParams.get('name');remote.assets.push({id:remote.assets.length+1,name,bytes:Buffer.from(options.body).toString('base64')});fs.writeFileSync(process.env.RELEASE_REMOTE,JSON.stringify(remote));return result({})}
if(url.hostname!=='api.github.com')throw Error('Forbidden external request');
if(url.pathname.includes('/git/ref/tags/'))return result({object:{type:'commit',sha:'${sha}'}});
let remote=read(process.env.RELEASE_REMOTE);
if(url.pathname.endsWith('/releases')&&options.method==='POST'){remote={id:1,tag_name:'cli-v1.0.0',draft:false,prerelease:false,assets:[]};fs.writeFileSync(process.env.RELEASE_REMOTE,JSON.stringify(remote));return result(remote)}
if(url.pathname.includes('/releases/assets/')){const id=Number(url.pathname.split('/').at(-1));const asset=remote.assets.find(a=>a.id===id);return new Response(Buffer.from(asset.bytes,'base64'))}
if(url.pathname.endsWith('/releases/latest'))return result({tag_name:'cli-v3.0.0'});
if(url.pathname.includes('/releases/tags/'))return remote?result(remote):result({},404);
throw Error('Unhandled fixture request '+url.href)};
`)
  const env = { PATH: `${fakebin}:${dirname(process.execPath)}:${process.env.PATH}`, HOME: root, CI: '1', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'cli-v1.0.0', GITHUB_REPOSITORY: 'slax-lab/slax-reader', GITHUB_SHA: sha, GH_TOKEN: 'synthetic-fixture-token', RELEASE_COMMANDS: commandLog, RELEASE_REGISTRY: registry, RELEASE_REMOTE: remote, RELEASE_HTTP: calls }
  const script = join(root, 'tooling/cli-release.mjs')
  const run = (command, directory, extra = {}) => spawnSync(process.execPath, ['--import', preload, script, command, directory], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8', timeout: 30000 })
  assert.notEqual(run('preflight', '.', { FAIL_ANCESTOR: '1' }).status, 0)
  assert.notEqual(run('preflight', '.', { GITHUB_EVENT_NAME: 'pull_request' }).status, 0)
  const original = readFileSync(join(root, 'apps/cli/package.json'), 'utf8')
  const first = join(root, 'first')
  const prepared = run('prepare', first)
  assert.equal(prepared.status, 0, prepared.stderr + prepared.stdout)
  assert.equal(readFileSync(join(root, 'apps/cli/package.json'), 'utf8'), original)
  const release = readRelease(first)
  const second = join(root, 'second')
  assert.equal(run('prepare', second).status, 0)
  assert.equal(readRelease(second).integrity, release.integrity)
  const archive = join(first, release.filename)
  const published = run('publish', first, { RELEASE_ARCHIVE: archive })
  assert.equal(published.status, 0, published.stderr + published.stdout)
  const remoteRelease = JSON.parse(readFileSync(remote, 'utf8'))
  assert.equal(remoteRelease.assets.length, 2)
  assert.deepEqual(Buffer.from(remoteRelease.assets.find(a => a.name.endsWith('.tgz')).bytes, 'base64'), readFileSync(archive))
  const creation = readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse).find(call => call.method === 'POST' && call.url.endsWith('/releases'))
  assert.equal(JSON.parse(creation.body).generate_release_notes, true)
  assert.equal(JSON.parse(creation.body).make_latest, 'false')
  remoteRelease.assets = remoteRelease.assets.filter(asset => asset.name !== 'SHA256SUMS')
  writeFileSync(remote, JSON.stringify(remoteRelease))
  assert.equal(run('publish', first, { RELEASE_ARCHIVE: archive }).status, 0)
  assert.equal(JSON.parse(readFileSync(remote, 'utf8')).assets.length, 2)
  const commands = readFileSync(commandLog, 'utf8').trim().split('\n').map(JSON.parse)
  assert.equal(commands.filter(args => args[0] === 'publish').length, 1)
  assert.ok(commands.some(args => args.join(' ') === 'merge-base --is-ancestor '+sha+' origin/main'))
  writeFileSync(archive, 'tampered')
  assert.notEqual(run('publish', first, { RELEASE_ARCHIVE: archive }).status, 0)
})
