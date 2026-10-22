import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {IncrementalMarkdown, markdownToHtml} from '../../src/reader/markdown.ts';
import {markdownDomScript} from '../../src/reader/markdown-dom.ts';

const documents = [
  '# Heading\n\nA **paragraph** and [link](#section).\n\n- one\n- two\n\n> quote\n> next\n',
  '```typescript\nconst a = 1;\n\nconst b = 2;\n```\n\nafter\n',
  '| one | two |\n| --- | --- |\n| a | b |\n\nEnd',
  'a\r\nb\r\n\r\n1. first\r\n   nested\r\n2. second\r\n\r\n<script>unsafe</script>',
  '### heading\n---\n\n~~removed~~\n\n~~~\ncode\n~~~',
];
test('incremental markdown matches complete parsing at every streamed boundary and replacement', () => {
  const renderer = new IncrementalMarkdown();
  for (const text of documents) {
    for (let length = 0; length <= text.length; length++) assert.equal(renderer.update(text.slice(0, length)).join('\n'), markdownToHtml(text.slice(0, length)));
    for (let length = text.length; length >= 0; length--) assert.equal(renderer.update(text.slice(0, length)).join('\n'), markdownToHtml(text.slice(0, length)));
  }
});

test('markdown block patches retain unchanged DOM, scroll and selection until the latest update can apply', async () => {
  const require = createRequire(import.meta.url);
  const module = process.env.SLAX_READER_DOM_MODULE || require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]});
  const {Window} = await import(pathToFileURL(module).href), window = new Window();
  try {
    window.document.body.innerHTML = '<main id="content"></main>';
    let scroll = 90, parsed = 0;
    Object.defineProperty(window, 'scrollY', {get: () => scroll}); window.scrollTo = (_x, y) => {scroll = y;};
    const create = window.document.createElement.bind(window.document);
    window.document.createElement = (...args) => {if (args[0] === 'template') parsed++; return create(...args);};
    window.eval(markdownDomScript);
    const update = window.__slaxOutlineUpdate;
    update(['<h1>Title</h1>', '<p>First</p>']);
    const content = window.document.getElementById('content'), title = content.firstChild;
    update(['<h1>Title</h1>', '<p>First updated</p>']);
    assert.equal(content.firstChild, title); assert.equal(parsed, 3); assert.equal(scroll, 90);
    update(['<h1>Title</h1>', '<p>First updated</p>']); assert.equal(parsed, 3);
    const selection = window.getSelection(), range = window.document.createRange();
    range.selectNodeContents(title); selection.addRange(range);
    update(['<h1>Title</h1>', '<p>Deferred one</p>']); update(['<h1>Title</h1>', '<p>Deferred latest</p>']);
    assert.equal(content.lastChild.textContent, 'First updated'); assert.equal(selection.toString(), 'Title');
    selection.removeAllRanges(); window.document.dispatchEvent(new window.Event('selectionchange'));
    assert.equal(content.lastChild.textContent, 'Deferred latest'); assert.equal(content.firstChild, title); assert.equal(parsed, 4);
  } finally {await window.happyDOM.close();}
});
