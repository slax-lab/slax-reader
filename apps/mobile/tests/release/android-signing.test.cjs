const {test} = require('node:test');
const assert = require('node:assert/strict');
const {marker, removeTemplateDebugSigning, assertReleaseSigning} = require('../../plugins/android-release-signing.cjs');

for (const assignment of ['signingConfig signingConfigs.debug', 'signingConfig = signingConfigs.debug']) {
  test(`generation and build admission handle ${assignment} without dropping release settings`, () => {
    const source = `android { buildTypes {
      debug { signingConfig signingConfigs.debug }
      release {
        nested { property = "}" }
        // Keep this optimization before the signing statement.
        minifyEnabled true
        ${assignment}
        shrinkResources true
      }
    } }\n${marker}`;
    assert.throws(() => assertReleaseSigning(source), /template debug/);
    const generated = removeTemplateDebugSigning(source);
    assert.match(generated, /debug \{ signingConfig signingConfigs.debug/);
    assert.match(generated, /minifyEnabled true\s+signingConfig = null\s+shrinkResources true/);
    assert.equal(removeTemplateDebugSigning(generated), generated);
    assert.doesNotThrow(() => assertReleaseSigning(generated));
  });
}

test('release signing ignores examples and rejects missing or broken templates', () => {
  const source = `// release { signingConfig signingConfigs.debug }\nandroid { release {
    /* signingConfig signingConfigs.debug */
    label = 'signingConfig signingConfigs.debug }'
    signingConfig = null
  } }\n${marker}`;
  assert.equal(removeTemplateDebugSigning(source), source);
  assert.doesNotThrow(() => assertReleaseSigning(source));
  assert.throws(() => removeTemplateDebugSigning('android { debug {} }'), /release block is missing/);
  assert.throws(() => removeTemplateDebugSigning('android { release {'), /unbalanced/);
  assert.throws(() => assertReleaseSigning('android { release { signingConfig = null } }'), /Regenerate/);
});
