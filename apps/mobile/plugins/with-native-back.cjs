const {withMainActivity} = require('expo/config-plugins');

const marker = '// Slax Android 13-15 native back compatibility.';

function methodEnd(contents, start) {
  let depth = 0, quote = null, lineComment = false, blockComment = false;
  for (let index = start; index < contents.length; index++) {
    const char = contents[index], next = contents[index + 1];
    if (lineComment) {if (char === '\n') lineComment = false; continue;}
    if (blockComment) {if (char === '*' && next === '/') {blockComment = false; index++;} continue;}
    if (quote) {if (char === '\\') index++; else if (char === quote) quote = null; continue;}
    if (char === '/' && next === '/') {lineComment = true; index++; continue;}
    if (char === '/' && next === '*') {blockComment = true; index++; continue;}
    if (char === '"' || char === "'") {quote = char; continue;}
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return index;
  }
  throw new Error('Slax native back compatibility requires a complete MainActivity fallback method');
}

function updateMainActivity(contents) {
  if (contents.includes(marker)) {
    if (!contents.includes('slaxCompatBackCallback') || !contents.includes('finally {\n      slaxCompatBackCallback.isEnabled = true')) {
      throw new Error('Incomplete Slax native back compatibility in MainActivity');
    }
    return contents;
  }
  const activity = /class MainActivity\s*:\s*ReactActivity\(\)\s*\{/;
  const fallback = /override fun invokeDefaultOnBackPressed\(\)\s*\{/;
  const match = fallback.exec(contents);
  if (!activity.test(contents) || !match || contents.split('super.onCreate(null)').length !== 2) {
    throw new Error('Slax native back compatibility requires the pinned Expo Kotlin MainActivity template');
  }
  const bodyStart = match.index + match[0].length - 1, bodyEnd = methodEnd(contents, bodyStart);
  const originalLines = contents.slice(bodyStart + 1, bodyEnd).split('\n');
  while (originalLines.length && !originalLines[0].trim()) originalLines.shift();
  while (originalLines.length && !originalLines.at(-1).trim()) originalLines.pop();
  if (!originalLines.length) throw new Error('Slax native back compatibility requires the existing root fallback');
  const indent = Math.min(...originalLines.filter(line => line.trim()).map(line => /^\s*/.exec(line)[0].length));
  const guardedBody = `\n    slaxCompatBackCallback.isEnabled = false\n    try {\n${originalLines.map(line => `      ${line.slice(indent).trimEnd()}`).join('\n')}\n    } finally {\n      slaxCompatBackCallback.isEnabled = true\n    }\n  `;
  contents = contents.slice(0, bodyStart + 1) + guardedBody + contents.slice(bodyEnd);
  contents = contents.replace(activity, `$&\n  ${marker}\n  private val slaxCompatBackCallback = object : androidx.activity.OnBackPressedCallback(true) {\n    override fun handleOnBackPressed() {\n      isEnabled = false\n      try {\n        this@MainActivity.onBackPressed()\n      } finally {\n        isEnabled = true\n      }\n    }\n  }\n`);
  return contents.replace('super.onCreate(null)', `super.onCreate(null)\n    // RN 0.86 supplies this bridge only on Android 16 and newer.\n    if (Build.VERSION.SDK_INT >= 33 && Build.VERSION.SDK_INT < 36) {\n      onBackPressedDispatcher.addCallback(this, slaxCompatBackCallback)\n    }`);
}

module.exports = function withNativeBack(config) {
  return withMainActivity(config, mod => {
    if (mod.modResults.language !== 'kt') throw new Error('Slax native back compatibility requires Kotlin');
    mod.modResults.contents = updateMainActivity(mod.modResults.contents);
    return mod;
  });
};
module.exports.updateMainActivity = updateMainActivity;
