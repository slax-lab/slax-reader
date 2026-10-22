/** Fill the scene-template bootstrap gap before RNFirebase's legacy matcher runs. */
function configureFirebaseAppDelegate({language, contents}) {
  if (language !== 'swift') throw new Error('Firebase bootstrap requires the supported Swift AppDelegate template.');
  const invocation = /\bFirebaseApp\s*\.\s*configure\s*\(/g;
  // Ignore comments so a commented example cannot silently disable initialization.
  const code = contents.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"/g,
    value => value.replace(/[^\r\n]/g, ' '));
  const existing = [...code.matchAll(invocation)];
  if (existing.length > 1) throw new Error('Firebase bootstrap found multiple configure calls in AppDelegate.');
  if (!/^\s*(?:(?:internal|public)\s+)?import\s+FirebaseCore\s*$/m.test(contents)) {
    contents = `import FirebaseCore\n${contents}`;
  }
  if (existing.length) return contents;
  const launch = /(\bdidFinishLaunchingWithOptions\b[^{}]*\)\s*->\s*Bool\s*\{)/;
  const match = launch.exec(code);
  if (!match) throw new Error('Cannot install Firebase bootstrap: didFinishLaunchingWithOptions insertion point is missing.');
  // An import added above shifts the original offsets by its length.
  const offset = match.index + match[0].length + (contents.length - code.length);
  return `${contents.slice(0, offset)}\n    // Slax main-app Firebase bootstrap; scenes can connect after this returns.\n    if FirebaseApp.app() == nil {\n      FirebaseApp.configure()\n    }${contents.slice(offset)}`;
}

module.exports = {configureFirebaseAppDelegate};
