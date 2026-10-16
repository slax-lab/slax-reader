import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';

const arguments_ = process.argv.slice(2);
assert(arguments_.length === 6 && arguments_[0] === '--device' && arguments_[2] === '--xctestrun' && arguments_[4] === '--output', 'Use exact --device, --xctestrun and a new --output directory');
const device = arguments_[1];
assert(device === 'B85A7582-A0A7-4A0F-9BF0-8424330859F3', 'This finite native sampler is restricted to the explicitly allocated controlled Share simulator');
const testRun = await realpath(arguments_[3]);
const testRoot = await realpath('/tmp/slax-source-share-control-build');
assert(testRun.startsWith(testRoot + path.sep) && /^SourceShareControl_iphonesimulator[0-9.]+-arm64-x86_64\.xctestrun$/.test(path.basename(testRun)), 'Only the compiled unique original Share input driver may run');
const output = path.resolve(arguments_[5]);
assert(path.dirname(output) === '/tmp' && /^slax-source-share-success-sample-[a-z0-9-]+$/.test(path.basename(output)), 'Use a fresh marked temporary sampler directory');
await mkdir(output);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const marker = {kind: 'slax-original-share-finite-native-sampler', version: 1, device,
  sourceHost: 'app.slax.reader.sourcesharefixture', productionMainMustStayClosed: true,
  testRun, testRunSHA256: sha(await readFile(testRun)), samplerSHA256: sha(await readFile(new URL(import.meta.url))),
  startedAt: Date.now(), maximumFrames: 70, maximumSamplingMilliseconds: 18_000,
  originalSwiftAndTimingChanged: false, nativeVisualAcceptance: 'unverified'};
await writeFile(path.join(output, 'owner.json'), JSON.stringify(marker, null, 2));
const samples = [];
let log = '', begun = false, finished = false, sampling;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function sample() {
  const startedAt = Date.now();
  while (!finished && samples.length < marker.maximumFrames && Date.now() - startedAt < marker.maximumSamplingMilliseconds) {
    const file = path.join(output, `frame-${String(samples.length).padStart(3, '0')}.png`);
    const requestedAt = Date.now();
    const result = spawnSync('xcrun', ['simctl', 'io', device, 'screenshot', file], {encoding: 'utf8', timeout: 4_000});
    samples.push({file: path.basename(file), requestedAt, completedAt: Date.now(), status: result.status,
      sha256: result.status === 0 ? sha(await readFile(file)) : null});
    await sleep(125);
  }
}
const process_ = spawn('xcodebuild', ['test-without-building', '-xctestrun', testRun,
  '-destination', `platform=iOS Simulator,id=${device}`, '-parallel-testing-enabled', 'NO',
  '-maximum-concurrent-test-simulator-destinations', '1', '-only-testing:SourceShareControl/SourceShareControl/testSuccess',
  '-resultBundlePath', path.join(output, 'native-input.xcresult')], {stdio: ['ignore', 'pipe', 'pipe']});
const receive = chunk => {
  const text = chunk.toString();
  log += text;
  process.stdout.write(text);
  if (!begun && /Test Case '-\[SourceShareControl\.SourceShareControl testSuccess\]' started\./.test(log)) {
    begun = true;
    sampling = sample();
  }
};
process_.stdout.on('data', receive); process_.stderr.on('data', receive);
const timeout = setTimeout(() => process_.kill('SIGTERM'), 90_000);
const status = await new Promise((resolve, reject) => {process_.once('error', reject); process_.once('close', resolve);});
clearTimeout(timeout);
finished = true;
if (sampling) await sampling;
await writeFile(path.join(output, 'native-input.log'), log);
await writeFile(path.join(output, 'samples.json'), JSON.stringify({...marker, completedAt: Date.now(), commandExitCode: status,
  testStarted: begun, samples, nativeInputStatus: status === 0 ? 'passed' : 'failed',
  successFrameVisible: 'pending-manual-inspection', wholeShareParity: false, originalKotlinRuntimeVerified: false}, null, 2));
assert(status === 0 && begun && samples.some(sample => sample.status === 0), 'Native input or finite raw capture failed; retain rejected artifacts');
