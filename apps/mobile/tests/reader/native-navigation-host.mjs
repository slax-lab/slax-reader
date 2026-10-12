import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'

// Compile the production navigation gate only. No WK/UIKit/Pods, device or app.
const gate = fileURLToPath(new URL('../../modules/slax-platform/ios/SlaxReaderDocumentNavigationGate.swift', import.meta.url))
const nativeView = readFileSync(new URL('../../modules/slax-platform/ios/SlaxReaderView.swift', import.meta.url), 'utf8')
for (const call of ['navigationGate.admitMainFrame(', 'navigationGate.start(', 'navigationGate.finish(', 'navigationGate.permitsSource', 'navigationGate.invalidate()']) assert.ok(nativeView.includes(call), `Production view must call ${call}`)
const source = readFileSync(gate, 'utf8')
assert.ok(!/\bimport\b/.test(source), 'The pure production gate must not import native frameworks')
const directory = mkdtempSync(path.join(tmpdir(), 'slax-reader-navigation-host-'))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
writeFileSync(path.join(directory, 'owner.json'), JSON.stringify({kind: 'slax-reader-navigation-host', version: 1, productionGate: gate, gateSha256: digest(source), noDeviceAccess: true}))
const main = path.join(directory, 'main.swift'), executable = path.join(directory, 'navigation-gate'), cache = path.join(directory, 'cache')
mkdirSync(cache)
writeFileSync(main, `
func expect(_ condition: Bool) { if !condition { fatalError("Controlled navigation gate assertion failed") } }
var first = SlaxReaderDocumentNavigationGate()
expect(!first.permitsSource)
expect(!first.admitMainFrame(isInitialRequest: false))
expect(first.admitMainFrame(isInitialRequest: true))
expect(!first.permitsSource)
expect(!first.admitMainFrame(isInitialRequest: true))
expect(first.start(isExpectedNavigation: true))
expect(first.permitsSource)
expect(first.finish(isExpectedNavigation: true))
expect(!first.admitMainFrame(isInitialRequest: false))
expect(first.permitsSource) // A cancelled replacement leaves the original document active.
first.invalidate()
expect(!first.permitsSource)
expect(!first.start(isExpectedNavigation: true))
var unexpected = SlaxReaderDocumentNavigationGate()
expect(unexpected.admitMainFrame(isInitialRequest: true))
expect(!unexpected.start(isExpectedNavigation: false))
expect(!unexpected.permitsSource)
expect(!unexpected.start(isExpectedNavigation: true)) // A delayed old callback cannot revive it.
var late = SlaxReaderDocumentNavigationGate()
expect(late.admitMainFrame(isInitialRequest: true))
expect(late.start(isExpectedNavigation: true))
expect(!late.finish(isExpectedNavigation: false))
expect(!late.permitsSource)
print("{\\"productionGateCases\\":8,\\"passed\\":8,\\"WKOrDeviceExecuted\\":false}")
`)
const size = current => readdirSync(current, {withFileTypes: true}).reduce((sum, entry) => {
  const file = path.join(current, entry.name)
  try {return sum + (entry.isDirectory() ? size(file) : statSync(file).size)} catch (error) {if (error.code === 'ENOENT') return sum; throw error}
}, 0)
let refused = null
async function run(command, args) {
  const child = spawn(command, args, {cwd: directory, stdio: ['ignore', 'pipe', 'pipe']})
  let output = ''
  child.stdout.on('data', data => {output += data})
  child.stderr.on('data', data => {output += data})
  const guard = setInterval(() => {if (size(directory) > 1024 * 1024) {refused = 'one-MiB-owned-output'; child.kill('SIGTERM')}}, 100)
  const timeout = setTimeout(() => {refused = 'thirty-second-command'; child.kill('SIGTERM')}, 30000)
  const code = await new Promise((resolve, reject) => {child.once('error', reject); child.once('close', resolve)})
  clearInterval(guard); clearTimeout(timeout)
  writeFileSync(path.join(directory, command === 'xcrun' ? 'compile.log' : 'run.log'), output)
  assert.equal(refused, null); assert.ok(size(directory) <= 1024 * 1024); assert.equal(code, 0, output)
  return output
}
await run('xcrun', ['swiftc', gate, main, '-module-cache-path', cache, '-o', executable])
const result = JSON.parse((await run(executable, [])).trim())
assert.deepEqual(result, {productionGateCases: 8, passed: 8, WKOrDeviceExecuted: false})
const report = {kind: 'slax-reader-production-navigation-gate-host', version: 1, directory, gateSha256: digest(source), nativeViewSha256: digest(nativeView), mainSha256: digest(readFileSync(main)), executableSha256: digest(readFileSync(executable)), ownedBytes: size(directory), ...result, nativeAppCompiled: false, sourceRegistrationAndWKNavigationStillPending: true}
writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
