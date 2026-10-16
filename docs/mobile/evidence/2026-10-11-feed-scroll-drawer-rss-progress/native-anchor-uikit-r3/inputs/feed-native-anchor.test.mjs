import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync, realpathSync} from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const rnRequire = createRequire(realpathSync(require.resolve('react-native/package.json')));
const flowPlugin = rnRequire.resolve('@babel/plugin-transform-flow-strip-types');
const flowRequire = createRequire(flowPlugin);
const babel = flowRequire('@babel/core');
const sourcePath = rnRequire.resolve('@react-native/virtualized-lists/Lists/VirtualizedList');
const source = readFileSync(sourcePath, 'utf8');
const names = ['getDerivedStateFromProps', '_findItemIndexWithKey', '_getItemKey', '_keyExtractor', '_constrainToItemCount'];
const methods = names.map(name => {
  const start = source.indexOf(`\n  static ${name}(`), end = source.indexOf('\n  }', start);
  assert.ok(start >= 0 && end > start, `Installed RN method ${name}`);
  return source.slice(start, end + 4);
});
const code = babel.transformSync(`class VirtualizedList {${methods.join('\n')}}; globalThis.InstalledList = VirtualizedList;`, {configFile: false, babelrc: false, plugins: [flowPlugin]}).code;
const context = {clamp: (minimum, value, maximum) => Math.min(maximum, Math.max(minimum, value)), maxToRenderPerBatchOrDefault: value => value ?? 10};
vm.runInNewContext(code, context);
const InstalledList = context.InstalledList;
// Only the renderer mask boundary is replaced; actual installed key lookup,
// prepend window adjustment and pending native-update count run unchanged.
InstalledList._createRenderMask = props => ({numCells: () => props.data.length});

function props(ids, maintain = true) {
  return {data: ids.map(id => ({id})), getItemCount: data => data.length, getItem: (data, index) => data[index], keyExtractor: item => item.id, maxToRenderPerBatch: 3, ...(maintain ? {maintainVisibleContentPosition: {minIndexForVisible: 0}} : {})};
}
const originalIds = Array.from({length: 12}, (_, i) => `bookmark-${i}`);
function state() {return {firstVisibleItemKey: originalIds[0], renderMask: {numCells: () => originalIds.length}, cellsAroundViewport: {first: 3, last: 8}, pendingScrollUpdateCount: 0};}

test('actual installed RN prepended stable keys retain the same rendered articles only when native anchoring is enabled', () => {
  const incoming = ['new-1', 'new-2', ...originalIds];
  const anchored = InstalledList.getDerivedStateFromProps(props(incoming), state());
  const pixelOnly = InstalledList.getDerivedStateFromProps(props(incoming, false), state());
  assert.equal(anchored.cellsAroundViewport.first, 5); assert.equal(anchored.cellsAroundViewport.last, 10);
  assert.equal(incoming[anchored.cellsAroundViewport.first], originalIds[3]);
  assert.equal(anchored.pendingScrollUpdateCount, 1, 'The real RN window awaits the corresponding native scroll adjustment');
  assert.equal(pixelOnly.cellsAroundViewport.first, 3); assert.notEqual(incoming[pixelOnly.cellsAroundViewport.first], originalIds[3]);
});

test('actual installed RN key lookup does not restore a missing old-feed anchor into a replacement feed', () => {
  const incoming = originalIds.map(id => `other-${id}`);
  assert.equal(InstalledList._findItemIndexWithKey(props(incoming), originalIds[0], 0), null);
  const replacement = InstalledList.getDerivedStateFromProps(props(['other-new', ...incoming]), state());
  assert.equal(replacement.pendingScrollUpdateCount, 0);
});
