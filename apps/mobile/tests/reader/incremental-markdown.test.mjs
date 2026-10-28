import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {IncrementalMarkdown, markdownToHtml} from '../../src/reader/markdown.ts';
import {markdownDomScript} from '../../src/reader/markdown-dom.ts';
import {fixMarkdownLinks, StreamMarkdownProcessor} from '../../src/reader/model.ts';

const documents = [
  '# Heading\n\nA **paragraph** and [link](#section).\n\n- one\n- two\n\n> quote\n> next\n',
  '```typescript\nconst a = 1;\n\nconst b = 2;\n```\n\nafter\n',
  '| one | two |\n| --- | --- |\n| a | b |\n\nEnd',
  'a\r\nb\r\n\r\n1. first\r\n   nested\r\n2. second\r\n\r\n<script>unsafe</script>',
  '### heading\n---\n\n~~removed~~\n\n~~~\ncode\n~~~',
  '# 标题\n\n- 要点 **加粗**：说明\n  - 子要点 [跳转](#第一部分)\n    1. 三级\n- 第二\n\n段落一\n续行\n\n> 引用\n> 续\n\n| A | B |\n| - | - |\n| `1` | **2** |\n\n后记',
  '- a\n\n  continued\n\n- b\n\nafter\n    lazy\n\n    code\n',
  'Title\n===\n\npara\n---\n\n1. one\n2. two\n\n   three\n\n10. ten',
  '[ref]: https://example.com\n\nuse [ref] here\n\n- x',
  '> q\nlazy\n\n- l\nlazy\n\n```\nunclosed fence',
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

const outlineSamples = {
  nestedLists: '- 第一层\n  - 第二层 **重点**\n    1. 第三层\n    2. 第三层二\n- 回到第一层',
  cjkBold: '这是**中文加粗**紧跟文字，以及**“引号里的强调”**和*斜体*结尾。',
  parenLink: fixMarkdownLinks('[章节 (一)](#An (anchor)) 与 [外链](https://example.com/wiki/A_(b)) 结尾'),
  code: '行内 `a <b> && c` 代码\n\n```ts\nconst x = 1 < 2\n```',
  table: '| 列一 | 列二 |\n| :-- | --: |\n| **粗** | [链接](#a) |',
};
test('outline markdown renders nested lists, CJK emphasis, parenthesized links, code and tables with markdown-it', () => {
  const html = Object.fromEntries(Object.entries(outlineSamples).map(([key, text]) => [key, markdownToHtml(text)]));
  assert.match(html.nestedLists, /<ul>\s*<li>第一层\s*<ul>\s*<li>第二层 <strong>重点<\/strong>\s*<ol>\s*<li>第三层<\/li>\s*<li>第三层二<\/li>\s*<\/ol>\s*<\/li>\s*<\/ul>\s*<\/li>\s*<li>回到第一层<\/li>\s*<\/ul>/);
  assert.match(html.cjkBold, /<strong>中文加粗<\/strong>紧跟文字/);
  assert.match(html.cjkBold, /<strong>“引号里的强调”<\/strong>和<em>斜体<\/em>/, 'CJK-friendly emphasis closes next to full-width punctuation');
  assert.match(html.parenLink, /<a href="#An%20%28anchor%29">章节 \(一\)<\/a>/, 'Source fixMarkdownLinks encodes parentheses and spaces in anchors');
  assert.match(html.parenLink, /<a href="https:\/\/example.com\/wiki\/A_%28b%29">外链<\/a> 结尾/);
  assert.match(html.code, /<code>a &lt;b&gt; &amp;&amp; c<\/code>/);
  assert.match(html.code, /<pre><code class="language-ts">const x = 1 &lt; 2\n<\/code><\/pre>/);
  assert.match(html.table, /<th style="text-align:left">列一<\/th>/);
  assert.match(html.table, /<td style="text-align:left"><strong>粗<\/strong><\/td>\s*<td style="text-align:right"><a href="#a">链接<\/a><\/td>/);
});

test('outline links keep only in-document anchors and http(s); other destinations and images degrade to text', () => {
  const html = markdownToHtml('[ok](#a) [web](HTTPS://x.y/p) [js](javascript:alert(1)) [data](data:text/html,x) [rel](foo/bar) [mail](mailto:a@b.c) <javascript:alert(2)> <https://x.y> https://bare.example ![alt **text**](https://x.y/i.png)');
  assert.match(html, /<a href="#a">ok<\/a>/);
  assert.match(html, /<a href="HTTPS:\/\/x.y\/p">web<\/a>/);
  assert.match(html, /<a href="https:\/\/x.y">https:\/\/x.y<\/a>/);
  assert.equal((html.match(/<a /g) ?? []).length, 3, 'Only the anchor, the http link and the http autolink stay links');
  assert.match(html, / js data rel mail javascript:alert\(2\) /);
  assert.match(html, /https:\/\/bare.example alt text<\/p>/, 'Bare URLs are not linkified and images render as alt text without loading');
  assert.doesNotMatch(html, /<img|javascript:alert\(1\)|data:text|mailto/);
});

test('streamed outline chunks never render a half-written trailing link and match the final document', () => {
  const final = '## 要点\n\n- 第一点 [跳转到 (一)](#Section (one))\n- 第二点 **加粗**\n\n| A | B |\n| - | - |\n| 1 | 2 |\n';
  const processor = new StreamMarkdownProcessor(), renderer = new IncrementalMarkdown();
  let previous = [];
  for (let length = 1; length <= final.length; length += 3) {
    const content = processor.process(final.slice(0, length));
    const blocks = renderer.update(content);
    assert.equal(blocks.join('\n'), markdownToHtml(content));
    assert.doesNotMatch(blocks.join(''), /\[跳转|\]\(#/, 'An unfinished link is withheld instead of flashing as raw markdown');
    previous = blocks;
  }
  const flushed = renderer.update(processor.flush());
  assert.equal(flushed.join('\n'), markdownToHtml(fixMarkdownLinks(final)));
  assert.match(flushed.join(''), /<a href="#Section%20%28one%29">跳转到 \(一\)<\/a>/);
  assert.equal(flushed[0], previous[0], 'The finished heading block is unchanged by later chunks');
});

test('raw HTML, scripts and event handlers in outline markdown are never executed or inserted as elements', async () => {
  const require = createRequire(import.meta.url);
  const module = process.env.SLAX_READER_DOM_MODULE || require.resolve('happy-dom', {paths: [new URL('../../../../node_modules/.pnpm/node_modules/', import.meta.url).pathname]});
  const {Window} = await import(pathToFileURL(module).href), window = new Window();
  try {
    window.document.body.innerHTML = '<main id="content"></main>';
    window.scrollTo = () => {};
    window.attacked = 0;
    window.eval(markdownDomScript);
    const attack = '<script>window.attacked++</script>\n\n<img src=x onerror="window.attacked++">\n\n<a href="#" onclick="window.attacked++">x</a>\n\n[click](javascript:window.attacked++)\n\n`<script>window.attacked++</script>`\n\n```html\n<iframe src="javascript:window.attacked++"></iframe>\n```';
    const blocks = new IncrementalMarkdown().update(attack);
    window.__slaxOutlineUpdate(blocks);
    const content = window.document.getElementById('content');
    assert.equal(content.querySelectorAll('script, img, iframe, [onerror], [onclick]').length, 0);
    assert.equal(content.querySelectorAll('a').length, 0, 'The javascript: link keeps only its label');
    assert.match(content.textContent, /<script>window\.attacked\+\+<\/script>/, 'Raw HTML is shown as text');
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(window.attacked, 0);
  } finally {await window.happyDOM.close();}
});
