from pathlib import Path
import hashlib
import json
import os
import subprocess
import time

device = 'B85A7582-A0A7-4A0F-9BF0-8424330859F3'
stage = Path('/private/var/folders/_l/80rthvqs2251jkn7spm33_s40000gn/T/slax-reader-ui-fixture-byWKU3')
marker = stage / '.slax-ui-fixture-project.json'
assert hashlib.sha256(marker.read_bytes()).hexdigest() == 'ca0badee057adbb23f3001a930c08c16f2c15a7dcdadbbf564a3daf37e6cbe13'
scope = json.loads(Path('/tmp/slax-reader-ios-alpha-scope.json').read_text())
assert scope['appId'] == 'app.slax.reader.uifixture' and scope['scenario'] == 'reader-mixed'
assert scope['renderContext']['observedRoute']['name'] == 'Reader'
assert scope['scopeUri'].endswith('/reader-mixed-1791666903606-855b1e83fc1568/')
assert scope['inputSha256'] == 'aaf4fdd7fd8b205ed6f2e297686f20bb3f523b680d35fc62effcdc8a2a4afe2f'

directory = Path('/tmp/slax-reader-native-control-build')
owner = json.loads((directory / '.slax-reader-native-control-owner.json').read_text())
assert owner['runNonce'] == 'e9dd32c3-1460-464d-bb65-0a39b05d824f'
runfile = directory / 'Build/Products/ReaderNativeControl_iphonesimulator26.5-arm64.xctestrun'
assert hashlib.sha256(runfile.read_bytes()).hexdigest() == '623f33be48065532daa5e82aa4121f79eaf912ec60ac92145af3eb10ee966f47'
product = directory / 'Build/Products/Debug-iphonesimulator/ReaderNativeControl-Runner.app/PlugIns/ReaderNativeControl.xctest/ReaderNativeControl'
assert hashlib.sha256(product.read_bytes()).hexdigest() == 'd0e743ecbb3047a14f709db741478914c6894ea4f28d6e40110fd2ce2dc74f6d'
info = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'available', '--json']))
devices = [item for values in info['devices'].values() for item in values]
assert len([item for item in devices if item['udid'] == device and item['state'] == 'Booted']) == 1
assert not [item for item in devices if item['name'].startswith('Slax') and item['state'] == 'Booted' and item['udid'] != device]
processes = subprocess.check_output(['xcrun', 'simctl', 'spawn', device, 'launchctl', 'list'], text=True)
assert not [line for line in processes.splitlines() if 'UIKitApplication:app.slax.reader[' in line]

result = Path('/tmp/slax-reader-ios-alpha-native-e9dd32c3.xcresult')
log = Path('/tmp/slax-reader-ios-alpha-native.log')
report = Path('/tmp/slax-reader-ios-alpha-native-run.json')
assert not result.exists() and not log.exists() and not report.exists()
minimum_free = 805306368
maximum_increment = 104857600
def size(path):
    if not path.exists(): return 0
    if path.is_file(): return path.stat().st_size
    return sum(file.stat().st_size for file in path.rglob('*') if file.is_file() and not file.is_symlink())
before = size(directory)
def free():
    value = os.statvfs('/tmp')
    return value.f_bavail * value.f_frsize
assert free() >= minimum_free, 'The exact approved disk guard has not recovered'
command = ['xcodebuild', 'test-without-building', '-xctestrun', str(runfile), '-destination', 'platform=iOS Simulator,id=' + device,
           '-parallel-testing-enabled', 'NO', '-maximum-concurrent-test-simulator-destinations', '1', '-jobs', '1',
           '-only-testing:ReaderNativeControl/ReaderNativeControl/testNativeLongPressOriginalBodyWord', '-resultBundlePath', str(result)]
start = time.monotonic()
refusal = None
with log.open('xb') as output:
    process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT)
    while process.poll() is None:
        increment = max(size(directory) - before, 0) + size(result) + size(log)
        if free() < minimum_free: refusal = 'minimum-free-disk'
        elif increment > maximum_increment: refusal = 'maximum-owned-output-increment'
        elif time.monotonic() - start > 120: refusal = 'bounded-test-timeout'
        if refusal:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            break
        time.sleep(.5)
record = {'version': 1, 'device': device, 'scopeUri': scope['scopeUri'], 'inputSha256': scope['inputSha256'],
          'stageMarkerSha256': hashlib.sha256(marker.read_bytes()).hexdigest(), 'command': command,
          'exitCode': process.returncode, 'refused': refusal, 'elapsedSeconds': time.monotonic() - start,
          'incrementBytes': max(size(directory) - before, 0) + size(result) + size(log), 'freeBytes': free(),
          'resultBundle': str(result), 'logSha256': hashlib.sha256(log.read_bytes()).hexdigest(),
          'domRangePrepared': False, 'syntheticSelectionPublished': False}
report.write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record))
