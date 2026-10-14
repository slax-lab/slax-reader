const {test} = require('node:test');
const assert = require('node:assert/strict');
const withNativeBack = require('../plugins/with-native-back.cjs');

const template = `package com.slax.reader
import android.os.Build
class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme)
    super.onCreate(null)
  }
  override fun invokeDefaultOnBackPressed() {
    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
      if (!moveTaskToBack(false)) {
        super.invokeDefaultOnBackPressed()
      }
      return
    }
    super.invokeDefaultOnBackPressed()
  }
}
`;

test('native back generation retains root fallback and adds one lifecycle bridge for Android 13-15', () => {
  const result = withNativeBack.updateMainActivity(template);
  assert.equal(withNativeBack.updateMainActivity(result), result);
  assert.equal(result.split('onBackPressedDispatcher.addCallback').length, 2);
  assert.match(result, /Build\.VERSION\.SDK_INT >= 33 && Build\.VERSION\.SDK_INT < 36/);
  assert.match(result, /this@MainActivity\.onBackPressed\(\)/);
  assert.match(result, /invokeDefaultOnBackPressed\(\) \{\s+slaxCompatBackCallback\.isEnabled = false\s+try \{/);
  assert.match(result, /finally \{\s+slaxCompatBackCallback\.isEnabled = true/);
  assert.equal(result.split('super.invokeDefaultOnBackPressed()').length, 3);
  assert.match(result, /moveTaskToBack\(false\)/);
});

test('fallback wrapping ignores braces in comments and strings and preserves following methods', () => {
  const source = template.replace('    super.invokeDefaultOnBackPressed()\n  }\n}', '    // A future comment containing }\n    val reason = "{ root }"\n    super.invokeDefaultOnBackPressed()\n  }\n  fun untouched() = "retained"\n}');
  const result = withNativeBack.updateMainActivity(source);
  assert.match(result, /val reason = "\{ root \}"/);
  assert.match(result, /fun untouched\(\) = "retained"/);
  assert.equal(withNativeBack.updateMainActivity(result), result);
});

test('unsupported or partial activity templates fail instead of silently dropping the back bridge', async () => {
  assert.throws(() => withNativeBack.updateMainActivity(template.replace('super.onCreate(null)', 'super.onCreate(savedInstanceState)')), /pinned Expo Kotlin/);
  assert.throws(() => withNativeBack.updateMainActivity(template.replace('override fun invokeDefaultOnBackPressed()', 'fun anotherMethod()')), /pinned Expo Kotlin/);
  assert.throws(() => withNativeBack.updateMainActivity('// Slax Android 13-15 native back compatibility.'), /Incomplete Slax/);
  const config = withNativeBack({});
  await assert.rejects(config.mods.android.mainActivity({modResults: {language: 'java', contents: ''}, modRequest: {}, modRawConfig: {}}), /requires Kotlin/);
});
