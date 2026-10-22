const {test} = require('node:test');
const assert = require('node:assert/strict');
const {configureFirebaseAppDelegate} = require('../plugins/firebase-app-delegate.cjs');

const launch = `  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }`;

for (const sceneBased of [false, true]) {
  test(`Firebase starts once before React consumers on ${sceneBased ? 'scene' : 'factory'} template`, () => {
    const source = `internal import Expo\nclass AppDelegate: ExpoAppDelegate {\n${launch}\n}\n${sceneBased ? '// SceneDelegate starts React Native.' : 'factory.startReactNative()'}`;
    const generated = configureFirebaseAppDelegate({language: 'swift', contents: source});
    assert.equal(generated.match(/FirebaseApp.configure\(\)/g).length, 1);
    assert.equal(generated.match(/import FirebaseCore/g).length, 1);
    assert.ok(generated.indexOf('FirebaseApp.configure()') < generated.indexOf('let delegate'));
    assert.match(generated, /if FirebaseApp.app\(\) == nil/);
    assert.equal(configureFirebaseAppDelegate({language: 'swift', contents: generated}), generated);
  });
}

test('Firebase keeps an existing upstream bootstrap and refuses silent insertion failure', () => {
  const source = `import FirebaseCore\n${launch.replace('let delegate', 'FirebaseApp.configure()\n    let delegate')}`;
  assert.equal(configureFirebaseAppDelegate({language: 'swift', contents: source}), source);
  assert.throws(() => configureFirebaseAppDelegate({language: 'swift', contents: 'internal import Expo'}), /insertion point/);
  assert.throws(() => configureFirebaseAppDelegate({language: 'swift', contents: `${source}\nFirebaseApp.configure()`}), /multiple/);
  assert.throws(() => configureFirebaseAppDelegate({language: 'objc', contents: source}), /Swift/);
  const commented = `// FirebaseApp.configure()\n${launch}`;
  assert.match(configureFirebaseAppDelegate({language: 'swift', contents: commented}), /if FirebaseApp.app\(\) == nil/);
  const quoted = `let help = "FirebaseApp.configure()"\n${launch}`;
  assert.match(configureFirebaseAppDelegate({language: 'swift', contents: quoted}), /if FirebaseApp.app\(\) == nil/);
});
