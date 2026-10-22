import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync, execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRelease } from './cli-release.mjs'

const source = fileURLToPath(new URL('../', import.meta.url))
const sha = 'a'.repeat(40)
const before = 'b'.repeat(40)

for (const branch of ['dev', 'beta', 'main']) {
  test(`${branch} release process derives, packs, tags and resumes exact artifact distribution`, { timeout: 90000 }, t => {
    const root = mkdtempSync(join(tmpdir(), 'cli-release-process-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, 'tooling'))
    mkdirSync(join(root, 'apps/cli'), { recursive: true })
    mkdirSync(join(root, 'packages/contracts'), { recursive: true })
    for (const name of ['cli-release.mjs', 'cli.mjs', 'pnpm-command.mjs']) copyFileSync(join(source, 'tooling', name), join(root, 'tooling', name))
    for (const name of ['package.json', 'pnpm-workspace.yaml']) copyFileSync(join(source, name), join(root, name))
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'release-fixture', private: true, type: 'module', scripts: { cli: 'node tooling/cli.mjs' } }))
    copyFileSync(join(source, 'packages/contracts/package.json'), join(root, 'packages/contracts/package.json'))
    mkdirSync(join(root, 'apps/cli/node_modules/@slax-reader/contracts'), { recursive: true })
    copyFileSync(join(source, 'packages/contracts/package.json'), join(root, 'apps/cli/node_modules/@slax-reader/contracts/package.json'))
    for (const name of ['package.json', 'LICENSE', 'README.md']) copyFileSync(join(source, 'apps/cli', name), join(root, 'apps/cli', name))
    const manifestPath = join(root, 'apps/cli/package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '2.3.4', scripts: { ...manifest.scripts, build: 'node build-fixture.mjs' } }, null, 2) + '\n')
    writeFileSync(join(root, 'apps/cli/build-fixture.mjs'), `import fs from 'node:fs'; if(process.env.FAIL_BUILD)throw Error('fixture build failed'); const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); fs.mkdirSync('dist',{recursive:true}); fs.writeFileSync('dist/index.js','#!/usr/bin/env node\\nconsole.log('+JSON.stringify(pkg.version)+')\\n',{mode:0o755});`)
    const fakebin = join(root, 'bin')
    mkdirSync(fakebin)
    writeFileSync(join(fakebin, 'git'), `#!${process.execPath}
import fs from 'node:fs'; const args=process.argv.slice(2); fs.appendFileSync(process.env.RELEASE_COMMANDS,JSON.stringify(args)+'\\n');
if(args[0]==='merge-base'){process.exit(process.env.FAIL_ANCESTOR?1:0)}
if(args[0]==='cat-file')process.exit(0);
if(args[0]==='rev-parse')console.log(args[1]==='--is-shallow-repository'?'false':'${sha}');
else if(args[0]==='tag')process.exit(0);
else if(args[0]==='log')console.log('${sha}');
else if(args[0]==='ls-tree'||args[0]==='diff-tree')process.stdout.write('apps/cli/package.json\\0');
else if(args[0]==='diff')console.log('apps/cli/package.json');
else if(args[0]==='show'){const pkg=JSON.parse(fs.readFileSync('apps/cli/package.json','utf8'));if(args[1].startsWith('${before}'))pkg.version='1.0.1';console.log(JSON.stringify(pkg))}
else throw Error('Unhandled git fixture command');`, { mode: 0o755 })
    const commandLog = join(root, 'commands.jsonl')
    const registry = join(root, 'registry.json')
    const remote = join(root, 'github.json')
    const tag = join(root, 'tag.json')
    const calls = join(root, 'http.jsonl')
    for (const path of [registry, remote, tag]) writeFileSync(path, 'null')
    writeFileSync(join(fakebin, 'npm'), `#!${process.execPath}
import fs from 'node:fs';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';
if(process.argv[2]==='--version'){console.log('12.2.0');process.exit(0)}
if(process.argv[2]!=='publish')throw Error('Unexpected command');fs.appendFileSync(process.env.RELEASE_COMMANDS,JSON.stringify(process.argv.slice(2))+'\\n');
const bytes=fs.readFileSync(process.argv[3]);const pkg=JSON.parse(execFileSync('tar',['-xOf',process.argv[3],'package/package.json'],{encoding:'utf8'}));
pkg.dist={integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64'),tarball:'https://registry.npmjs.org/archive.tgz'};fs.writeFileSync(process.env.RELEASE_REGISTRY,JSON.stringify(pkg));`, { mode: 0o755 })
    const preload = join(root, 'network.mjs')
    writeFileSync(preload, `import fs from 'node:fs';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));let tagReads=0;
globalThis.fetch=async(input,options={})=>{const url=new URL(input);fs.appendFileSync(process.env.RELEASE_HTTP,JSON.stringify({url:url.href,method:options.method||'GET',body:typeof options.body==='string'?options.body:undefined})+'\\n');const result=(value,status=200)=>new Response(JSON.stringify(value),{status});
if(url.hostname==='registry.npmjs.org'){if(url.pathname==='/archive.tgz')return new Response(fs.readFileSync(process.env.RELEASE_ARCHIVE));const pkg=read(process.env.RELEASE_REGISTRY);return pkg?result(pkg):result({},404)}
if(url.hostname==='uploads.github.com'){const name=url.searchParams.get('name');if(process.env.FAIL_UPLOAD&&name==='SHA256SUMS')return result({},500);let remote=read(process.env.RELEASE_REMOTE);remote.assets.push({id:remote.assets.length+1,name,bytes:Buffer.from(options.body).toString('base64')});fs.writeFileSync(process.env.RELEASE_REMOTE,JSON.stringify(remote));return result({})}
if(url.hostname!=='api.github.com')throw Error('Forbidden external request');
if(url.pathname.endsWith('/git/refs')&&options.method==='POST'){if(process.env.FAIL_TAG)return result({},403);const body=JSON.parse(options.body);const tag={object:{type:'commit',sha:body.sha}};fs.writeFileSync(process.env.RELEASE_TAG,JSON.stringify(tag));return result(tag)}
if(url.pathname.includes('/git/ref/tags/')){const tag=read(process.env.RELEASE_TAG);if(process.env.SWITCH_TAG&&++tagReads===2){tag.object.sha='c'.repeat(40);fs.writeFileSync(process.env.RELEASE_TAG,JSON.stringify(tag))}return tag?result(tag):result({},404)}
let remote=read(process.env.RELEASE_REMOTE);
if(url.pathname.endsWith('/releases')&&options.method==='POST'){const body=JSON.parse(options.body);remote={id:1,tag_name:body.tag_name,body:body.body,draft:false,prerelease:body.prerelease,assets:[]};fs.writeFileSync(process.env.RELEASE_REMOTE,JSON.stringify(remote));return result(remote)}
if(url.pathname.includes('/releases/assets/')){const id=Number(url.pathname.split('/').at(-1));const asset=remote.assets.find(a=>a.id===id);return new Response(Buffer.from(asset.bytes,'base64'))}
if(url.pathname.endsWith('/releases/latest'))return result({tag_name:'cli-v9.0.0'});
if(url.pathname.includes('/releases/tags/'))return remote?result(remote):result({},404);
throw Error('Unhandled fixture request '+url.href)};
`)
    const event = join(root, 'push.json')
    writeFileSync(event, JSON.stringify({ before, after: sha, ref: `refs/heads/${branch}`, repository: { full_name: 'slax-lab/slax-reader' } }))
    const env = { PATH: `${fakebin}:${dirname(process.execPath)}:${process.env.PATH}`, HOME: root, CI: '1', GITHUB_EVENT_NAME: 'push', GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: branch, GITHUB_REF: `refs/heads/${branch}`, GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'slax-lab/slax-reader', GITHUB_SHA: sha, GH_TOKEN: 'synthetic-fixture-token', RELEASE_COMMANDS: commandLog, RELEASE_REGISTRY: registry, RELEASE_REMOTE: remote, RELEASE_TAG: tag, RELEASE_HTTP: calls }
    const script = join(root, 'tooling/cli-release.mjs')
    const run = (command, directory, extra = {}) => spawnSync(process.execPath, ['--import', preload, script, command, directory], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8', timeout: 60000 })
    assert.notEqual(run('preflight', '.', { FAIL_ANCESTOR: '1' }).status, 0)
    assert.notEqual(run('preflight', '.', { GITHUB_EVENT_NAME: 'pull_request' }).status, 0)
    const original = readFileSync(manifestPath, 'utf8')
    assert.notEqual(run('prepare', join(root, 'failed'), { FAIL_BUILD: '1' }).status, 0)
    assert.equal(readFileSync(manifestPath, 'utf8'), original)
    const first = join(root, 'first')
    const prepared = run('prepare', first)
    assert.equal(prepared.status, 0, prepared.stderr + prepared.stdout)
    assert.equal(readFileSync(manifestPath, 'utf8'), original)
    const release = readRelease(first)
    assert.equal(release.version, branch === 'main' ? '2.3.4' : `2.3.4-${branch}`)
    const packedBinary = execFileSync('tar', ['-xOf', join(first, release.filename), 'package/dist/index.js'], { encoding: 'utf8' })
    assert.ok(packedBinary.includes(JSON.stringify(release.version)))
    const second = join(root, 'second')
    assert.equal(run('prepare', second).status, 0)
    assert.equal(readRelease(second).integrity, release.integrity)
    const archive = join(first, release.filename)
    const mode = branch === 'main' ? 'publish' : 'preview'
    assert.notEqual(run(branch === 'main' ? 'preview' : 'publish', first).status, 0)
    assert.notEqual(run(mode, first, { RELEASE_ARCHIVE: archive, FAIL_TAG: '1' }).status, 0)
    assert.equal(readFileSync(tag, 'utf8'), 'null')
    assert.notEqual(run(mode, first, { RELEASE_ARCHIVE: archive, FAIL_UPLOAD: '1' }).status, 0)
    assert.equal(JSON.parse(readFileSync(remote, 'utf8')).assets.length, 1)
    const published = run(mode, first, { RELEASE_ARCHIVE: archive })
    assert.equal(published.status, 0, published.stderr + published.stdout)
    const remoteRelease = JSON.parse(readFileSync(remote, 'utf8'))
    assert.equal(remoteRelease.prerelease, branch !== 'main')
    assert.equal(remoteRelease.assets.length, 2)
    assert.deepEqual(Buffer.from(remoteRelease.assets.find(a => a.name.endsWith('.tgz')).bytes, 'base64'), readFileSync(archive))
    const http = readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse)
    const creation = http.find(call => call.method === 'POST' && call.url.endsWith('/releases'))
    assert.equal(JSON.parse(creation.body).generate_release_notes, undefined)
    assert.equal(JSON.parse(creation.body).body, readFileSync(join(first, 'RELEASE_NOTES.md'), 'utf8'))
    assert.match(JSON.parse(creation.body).body, /CLI package version updated/)
    assert.equal(JSON.parse(creation.body).make_latest, 'false')
    assert.equal(JSON.parse(creation.body).target_commitish, sha)
    if (branch !== 'main') assert.ok(http.every(call => new URL(call.url).hostname !== 'registry.npmjs.org'))
    remoteRelease.assets = remoteRelease.assets.filter(asset => asset.name !== 'SHA256SUMS')
    writeFileSync(remote, JSON.stringify(remoteRelease))
    assert.equal(run(mode, first, { RELEASE_ARCHIVE: archive }).status, 0)
    assert.equal(JSON.parse(readFileSync(remote, 'utf8')).assets.length, 2)
    assert.equal(JSON.parse(readFileSync(remote, 'utf8')).body, remoteRelease.body)
    const notes = readFileSync(join(first, 'RELEASE_NOTES.md'), 'utf8')
    const beforeTamper = readFileSync(calls, 'utf8')
    writeFileSync(join(first, 'RELEASE_NOTES.md'), notes + 'tampered')
    assert.notEqual(run(mode, first, { RELEASE_ARCHIVE: archive }).status, 0)
    assert.equal(readFileSync(calls, 'utf8'), beforeTamper)
    const notesMetadataPath = join(first, 'release.json')
    const notesMetadata = JSON.parse(readFileSync(notesMetadataPath, 'utf8'))
    writeFileSync(notesMetadataPath, JSON.stringify({ ...notesMetadata, notes: { ...notesMetadata.notes, sha256: createHash('sha256').update(notes + 'tampered').digest('hex') } }))
    assert.notEqual(run(mode, first, { RELEASE_ARCHIVE: archive }).status, 0)
    assert.equal(readFileSync(calls, 'utf8'), beforeTamper)
    writeFileSync(notesMetadataPath, JSON.stringify(notesMetadata))
    writeFileSync(join(first, 'RELEASE_NOTES.md'), notes)
    const commands = readFileSync(commandLog, 'utf8').trim().split('\n').map(JSON.parse)
    assert.equal(commands.filter(args => args[0] === 'publish').length, branch === 'main' ? 1 : 0)
    assert.ok(commands.some(args => args.join(' ') === `merge-base --is-ancestor ${sha} origin/${branch}`))
    writeFileSync(tag, JSON.stringify({ object: { type: 'commit', sha: 'c'.repeat(40) } }))
    assert.notEqual(run(mode, first, { RELEASE_ARCHIVE: archive }).status, 0)
    writeFileSync(tag, JSON.stringify({ object: { type: 'commit', sha } }))
    assert.notEqual(run(mode, first, { RELEASE_ARCHIVE: archive, SWITCH_TAG: '1' }).status, 0)
    writeFileSync(tag, JSON.stringify({ object: { type: 'commit', sha } }))
    const metadata = JSON.parse(readFileSync(join(first, 'release.json'), 'utf8'))
    writeFileSync(join(first, 'release.json'), JSON.stringify({ ...metadata, branch: branch === 'main' ? 'beta' : 'main' }))
    assert.notEqual(run(mode, first, { RELEASE_ARCHIVE: archive }).status, 0)
    writeFileSync(join(first, 'release.json'), JSON.stringify(metadata))
    writeFileSync(archive, 'tampered')
    assert.notEqual(run(mode, first, { RELEASE_ARCHIVE: archive }).status, 0)
  })
}
