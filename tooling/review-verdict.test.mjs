import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Execute the same shell step that gh-aw compiles into both review workflows.
const source = readFileSync(new URL('../.github/workflows/shared/pr-review-core.md', import.meta.url), 'utf8')
const block = source.match(/          run: \|\n((?: {12}[^\n]*\n|\n)+)/)?.[1]
assert.ok(block, 'review verdict shell step must be present')
const script = block.replace(/^ {12}/gm, '')
const verdict = (important_findings = '0', summary = 'Bugs, Security, Compliance: no Important findings.') => ({ type: 'review_verdict', important_findings, summary })

const cases = [
  ['zero string', { items: [verdict()] }, 0],
  ['zero number', { items: [verdict(0)] }, 0],
  ['positive count', { items: [verdict('1')] }, 1],
  ['large count', { items: [verdict('99999999999999999999999999999999999999999999')] }, 1],
  ['missing verdict', { items: [] }, 1],
  ['duplicate verdict', { items: [verdict(), verdict()] }, 1],
  ['invalid number', { items: [verdict('unknown')] }, 1],
  ['negative number', { items: [verdict('-1')] }, 1],
  ['fractional number', { items: [verdict(0.5)] }, 1],
  ['null count', { items: [verdict(null)] }, 1],
  ['boolean count', { items: [verdict(false)] }, 1],
  ['missing summary', { items: [verdict('0', null)] }, 1],
  ['empty summary', { items: [verdict('0', '')] }, 1],
  ['blank summary', { items: [verdict('0', '  ')] }, 1],
  ['invalid summary', { items: [verdict('0', {})] }, 1],
  ['missing items', {}, 1],
  ['malformed JSON', '{', 1],
  ['missing output file', undefined, 1]
]

for (const [name, payload, expected] of cases) {
  test(`review_verdict: ${name}`, t => {
    const directory = mkdtempSync(join(tmpdir(), 'slax-review-verdict-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const output = join(directory, 'output.json')
    if (payload !== undefined) writeFileSync(output, typeof payload === 'string' ? payload : JSON.stringify(payload))
    const result = spawnSync('bash', ['-c', script], {
      env: { ...process.env, GH_AW_AGENT_OUTPUT: output },
      encoding: 'utf8',
      timeout: 10000
    })
    assert.ifError(result.error)
    if (expected === 0) assert.equal(result.status, 0, result.stdout + result.stderr)
    else assert.notEqual(result.status, 0, result.stdout + result.stderr)
  })
}
