import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('native Android controls reject unrelated, ambiguous and unavailable controls', () => {
  execFileSync('python3', [fileURLToPath(new URL('./test-fixture-android-control.py', import.meta.url))], {stdio: 'pipe', env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
});
