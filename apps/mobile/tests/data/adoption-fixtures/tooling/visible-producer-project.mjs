import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const INPUT = 'visible-legacy-inputs.json';
const PREFIX = 'slax-visible-legacy-producer-';
const MARKER = 'fixture-project-owner.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// These exact public inputs produced the historical four-operation fixtures.
// No recursive copy, dependency cache, operator file, native artifact or key is admitted.
export const SOURCE_FILES = Object.freeze({
  ios: {
    'Info.plist': 'a019feee47f4e400cd6a0a13f6bd4d0626d142a27ac4352e8e6341c11984ad29',
    'LegacyFixtureApp.swift': '5c800377a5b57e61507ee6b1662abd7dc0b2cb0767bc55e7da1b7c2ed871458b',
    'SlaxLegacyFixture.entitlements': 'd30603c544890246eb9edf9015e2ee93cbe2303e6f804ac6fc61432ace1b0611',
    'build-app.mjs': '21788c1ceee22416a4a2013d17a78a4b35e4f51ba2862b46bf3e3cbfc6090b77',
    'build.gradle.kts': 'b8753b71b9fdb42e119329556efe1d2fc6381abc7de56b060de788c9395c256b',
    'gradle.properties': 'd50a0764cf84781fc5b1b013c34ca719596a32da6862478c68392701a8cf5310',
    'settings.gradle.kts': '8e2e86f538d2106abc34e772224439a47107f898410bc3614d490b8f64c81f97',
    'src/commonMain/kotlin/com/slax/reader/data/database/Schema.kt': '344a7bcc6901c7d3b22052278bcc326bc1f84930bb65a7fb9d2efb7a61042cd5',
    'src/iosSimulatorArm64Main/kotlin/LegacyFixtureProducer.kt': 'd25ac1ea33591ff8082dd2b7e2011e8fca5e0cd844a02ae68df731a0d288e8ca',
  },
  android: {
    'build.gradle.kts': '7059f4e70c890f2a001299d71b7d144908ba62e63045ebfd27bd5a0bdadda7d0',
    'gradle.properties': '198cfb414a6067fc813ba6dd9d8d927a5d9bd005567dc4bba8784a8deec518b9',
    'settings.gradle.kts': '6cc1b7088548bb7d46cf2f60d4cf5f534be023129557c9d825cd1486b327c7c3',
    'src/main/AndroidManifest.xml': 'e2f3e78439897d353300d350be3907074f9d4707725ba1f89322ebbdfa4292c9',
    'src/main/java/com/slax/reader/LegacyFixtureActivity.kt': '0629270b2aa2560bb4a769985d5aead6bfea7ac5e31d94d6c6be61dcc6fcabc9',
    'src/main/java/com/slax/reader/data/database/Schema.kt': '344a7bcc6901c7d3b22052278bcc326bc1f84930bb65a7fb9d2efb7a61042cd5',
  },
});

function regularFile(root, relative) {
  assert(!path.isAbsolute(relative) && !relative.split('/').some(part => part === '..' || part.startsWith('.')), 'Only whitelisted public relative files are allowed');
  let location = root;
  for (const part of relative.split('/')) {
    location = path.join(location, part);
    assert(!lstatSync(location).isSymbolicLink(), 'Producer inputs and outputs cannot use symlinks');
  }
  assert(lstatSync(location).isFile() && realpathSync(location) === location, 'A canonical regular public input is required');
  return location;
}
const json = value => JSON.stringify(value);
// Kotlin uses dollar interpolation even inside ordinary quoted JSON strings.
const kotlin = value => typeof value === 'string' ? json(value).replaceAll('$', '\\$') : value === null ? 'null' : String(value);
const objectKeys = (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'Unexpected controlled fixture fields');

export function validateVisibleInputs(input) {
  objectKeys(input, ['kind', 'version', 'scenario', 'createdAt', 'tag', 'bookmark', 'bookmarkDetails', 'share', 'updatedShare', 'comment', 'localJson', 'article']);
  assert(input.kind === 'slax-controlled-source-valid-legacy-inputs' && input.version === 1 && input.scenario === 'source-valid-visible-v1', 'Unknown controlled visible input');
  assert(input.tag.id === 'tag-1' && input.tag.user_id === 'synthetic-user' && input.tag.display === '1' && input.tag.source === 'mine', 'Original source tag shape required');
  assert(input.bookmark.id === 'bookmark-1' && input.bookmark.user_id === 'synthetic-user' && input.bookmark.archive_status === 0 && input.bookmark.is_read === 0 && input.bookmark.is_starred === 0 && input.bookmark.deleted_at === null && input.bookmark.type === 0, 'Visible original inbox row required');
  objectKeys(input.bookmarkDetails, ['uuid', 'title', 'byline', 'status', 'host_url', 'site_name', 'target_url', 'description', 'content_icon', 'published_at', 'content_cover', 'content_word_count']);
  assert(input.bookmarkDetails.status === 'success' && input.bookmarkDetails.target_url === 'https://offline.invalid/article-1' && input.bookmarkDetails.host_url === 'https://offline.invalid' && input.bookmarkDetails.content_icon === '' && input.bookmarkDetails.content_cover === '', 'No live content origin or image is permitted');
  assert(input.share.is_enable === true && input.share.allow_access === 1 && input.updatedShare.is_enable === false && input.updatedShare.allow_access === 1, 'Only the original uploader-supported offline share edit is required');
  objectKeys(input.share, ['uuid', 'is_enable', 'show_line', 'allow_line', 'created_at', 'share_code', 'show_comment', 'allow_comment', 'show_userinfo', 'allow_access']);
  const comment = input.comment;
  assert(comment.id === 'comment-1' && comment.user_bookmark_uuid === 'bookmark-1' && comment.type === 2 && comment.is_deleted === 0 && comment.metadata.user_id === 'synthetic-user' && comment.metadata.bookmark_id === 'bookmark-1', 'Original source comment identity required');
  objectKeys(comment.metadata, ['root_id', 'user_id', 'parent_id', 'source_type', 'source_id', 'bookmark_id']);
  assert.deepEqual(comment.source, [{type: 'text', path: 'article#controlled-offline > p#controlled-quote', start: 0, end: 26}], 'Exact original bridge CSS selector and offsets required');
  assert(comment.approx_source.exact === 'Controlled offline fixture' && comment.approx_source.position_start === 0 && comment.approx_source.position_end === 26 && input.article.quote.startsWith(comment.approx_source.exact), 'Approximate text must match the retained article');
  assert.deepEqual(comment.content, [{type: 'text', text: comment.approx_source.exact, src: ''}], 'Original selection content required');
  assert(input.localJson.is_downloaded === 2 && input.localJson.is_auto_cached === 0 && input.localJson.read_position === '348.25' && input.localJson.future_field.preserve === true, 'Manual cache, reading position and future JSON required');
  assert(input.article.paragraphCount === 18 && [input.article.quote, input.article.sectionTitle, input.article.paragraph].every(value => typeof value === 'string' && value.length < 1024), 'Bounded plain article required');
  const words = [input.article.quote, input.article.sectionTitle, ...Array(input.article.paragraphCount).fill(input.article.paragraph)].join(' ').trim().split(/\s+/).length;
  assert.equal(input.bookmarkDetails.content_word_count, words, 'Article word count must describe the actual cached text');
  for (const row of [input.tag, input.bookmark, input.bookmarkDetails, input.share, comment]) for (const [key, value] of Object.entries(row)) if (key.endsWith('_at') && value !== null) assert(value === input.createdAt && Number.isFinite(Date.parse(value)), 'A source-valid fixed ISO timestamp is required');
  return input;
}
export function readVisibleInputs() {return validateVisibleInputs(JSON.parse(readFileSync(regularFile(ROOT, INPUT), 'utf8')));}

function insert(table, row) {
  const columns = Object.keys(row);
  return {table, id: row.id, op: 'PUT', sql: `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, values: columns.map(key => row[key])};
}
/** Four original CRUD operations, grouped exactly as the real old SDK producer writes them. */
export function visibleOperations(input = readVisibleInputs()) {
  validateVisibleInputs(input);
  const before = {tags: ['tag-1'], share: input.share, bookmark: input.bookmarkDetails};
  const after = {tags: ['tag-1', 'tag-2'], share: {...input.share, ...input.updatedShare}, bookmark: input.bookmarkDetails};
  const comment = Object.fromEntries(Object.entries(input.comment).map(([key, value]) => [key, ['source', 'approx_source', 'content', 'metadata'].includes(key) ? json(value) : value]));
  return [
    [insert('sr_user_tag', input.tag), insert('sr_user_bookmark', {...input.bookmark, metadata: json(before)})],
    [{table: 'sr_user_bookmark', id: 'bookmark-1', op: 'PATCH', sql: 'UPDATE sr_user_bookmark SET is_starred=1,starred_at=?,metadata=? WHERE id=?', values: [input.createdAt, json(after), 'bookmark-1']}, insert('sr_bookmark_comment', comment)],
  ];
}
export function visibleArticle(input = readVisibleInputs()) {
  validateVisibleInputs(input);
  const escape = text => text.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
  return `<article id="controlled-offline"><p id="controlled-quote">${escape(input.article.quote)}</p><h2>${escape(input.article.sectionTitle)}</h2>${Array.from({length: input.article.paragraphCount}, (_, index) => `<p id="controlled-paragraph-${index + 1}">${escape(input.article.paragraph)}</p>`).join('')}</article>`;
}
function replaceLine(source, needle, replacement) {
  const lines = source.split('\n'), matching = lines.flatMap((line, index) => line.includes(needle) ? [index] : []);
  assert.equal(matching.length, 1, `The pinned old producer line must be unique: ${needle}`);
  const index = matching[0], indent = /^\s*/.exec(lines[index])[0];
  lines[index] = replacement.split('\n').map(line => indent + line).join('\n');
  return lines.join('\n');
}
export function generateVisibleProducerSource(platform, source, input = readVisibleInputs(), inputSHA = sha(readFileSync(regularFile(ROOT, INPUT)))) {
  assert(['ios', 'android'].includes(platform), 'Choose ios or android');
  const operations = visibleOperations(input).flat();
  const needles = ['tx.execute("INSERT INTO sr_user_tag(', 'tx.execute("INSERT INTO sr_user_bookmark(', 'tx.execute("UPDATE sr_user_bookmark ', 'tx.execute("INSERT INTO sr_bookmark_comment('];
  operations.forEach((operation, index) => {source = replaceLine(source, needles[index], `tx.execute(${kotlin(operation.sql)}, listOf(${operation.values.map(kotlin).join(', ')}))`);});
  const local = kotlin(json(input.localJson)), article = kotlin(visibleArticle(input));
  if (platform === 'ios') {
    source = replaceLine(source, 'val localJson = ', `val localJson = ${local}`);
    source = replaceLine(source, 'FileSystem.SYSTEM.write(article)', `FileSystem.SYSTEM.write(article) {writeUtf8(${article})}`);
  } else {
    source = replaceLine(source, 'db.execute("INSERT INTO ps_data_local__local_bookmark_info', `db.execute("INSERT INTO ps_data_local__local_bookmark_info(id,data) VALUES(?,?)", listOf("bookmark-1", ${local}))`);
    source = replaceLine(source, 'val article = File(', `val article = File(dataDir, "bookmark/bookmark-1/content.html"); article.parentFile!!.mkdirs(); article.writeText(${article})`);
  }
  const markerNeedle = 'put("controlledFixture", true); put("fixtureVersion", 1);';
  const markerLine = source.split('\n').find(line => line.includes(markerNeedle)).trim();
  source = replaceLine(source, markerNeedle, `${markerLine}\nput("fixtureScenario", ${kotlin(input.scenario)}); put("visibleInputsSHA256", ${kotlin(inputSHA)})`);
  assert.equal((source.match(/db\.writeTransaction\s*\{/g) ?? []).length, 2, 'Keep the two original SDK transactions');
  assert.equal((source.match(/tx\.execute\(/g) ?? []).length, 4, 'Keep the four original SDK CRUD operations');
  return source;
}

/** Generates a new standalone project; original producer source/build directories stay untouched. */
export function createVisibleProducerProject(platform) {
  assert(['ios', 'android'].includes(platform), 'Choose ios or android');
  const input = readVisibleInputs(), inputBytes = readFileSync(regularFile(ROOT, INPUT));
  const origin = path.join(ROOT, `${platform}-legacy`), originals = Object.entries(SOURCE_FILES[platform]).map(([relative, expected]) => {
    const bytes = readFileSync(regularFile(origin, relative)); assert.equal(sha(bytes), expected, `Historical public producer input changed: ${platform}/${relative}`); return {relative, bytes, sha256: expected};
  });
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), PREFIX)));
  const sourceName = platform === 'ios' ? 'src/iosSimulatorArm64Main/kotlin/LegacyFixtureProducer.kt' : 'src/main/java/com/slax/reader/LegacyFixtureActivity.kt';
  const generated = [];
  for (const original of originals) {
    let bytes = original.bytes;
    if (original.relative === sourceName) bytes = Buffer.from(generateVisibleProducerSource(platform, bytes.toString('utf8'), input, sha(inputBytes)));
    if (original.relative === 'gradle.properties') bytes = Buffer.from('org.gradle.jvmargs=-Xmx1g -Dfile.encoding=UTF-8\norg.gradle.workers.max=1\norg.gradle.parallel=false\nkotlin.daemon.jvmargs=-Xmx1g\nandroid.useAndroidX=true\n');
    const target = path.join(directory, original.relative); mkdirSync(path.dirname(target), {recursive: true}); writeFileSync(target, bytes, {flag: 'wx'});
    generated.push({path: original.relative, sha256: sha(bytes)});
  }
  writeFileSync(path.join(directory, INPUT), inputBytes, {flag: 'wx'}); generated.push({path: INPUT, sha256: sha(inputBytes)});
  const marker = {kind: 'slax-controlled-visible-legacy-producer-project', version: 1, platform, scenario: input.scenario, projectRoot: directory, inputsSHA256: sha(inputBytes), generatorSHA256: sha(readFileSync(fileURLToPath(import.meta.url))), originalPublicFiles: originals.map(({relative, sha256}) => ({path: `${platform}-legacy/${relative}`, sha256})), generatedPublicFiles: generated, oldSdk: 'powersync-kotlin-1.14.1', dataStore: 'androidx-datastore-1.2.1', originalProducerChanged: false, originalArtifactsChanged: false, built: false, deviceExecuted: false};
  writeFileSync(path.join(directory, MARKER), json(marker) + '\n', {flag: 'wx'});
  return marker;
}
export function verifyVisibleProducerProject(project) {
  assert(lstatSync(project).isDirectory() && !lstatSync(project).isSymbolicLink(), 'A real controlled project directory is required');
  const directory = realpathSync(project);
  assert(path.dirname(directory) === realpathSync(tmpdir()) && /^slax-visible-legacy-producer-[a-zA-Z0-9]+$/.test(path.basename(directory)), 'Use only the newly marked system-temp producer project');
  const marker = JSON.parse(readFileSync(regularFile(directory, MARKER), 'utf8'));
  assert(marker.kind === 'slax-controlled-visible-legacy-producer-project' && marker.version === 1 && marker.projectRoot === directory && ['ios', 'android'].includes(marker.platform), 'The producer project owner marker does not match');
  assert.equal(marker.generatorSHA256, sha(readFileSync(fileURLToPath(import.meta.url))), 'The reviewed generator changed');
  assert.equal(marker.inputsSHA256, sha(readFileSync(regularFile(ROOT, INPUT))), 'The reviewed visible input changed');
  assert.deepEqual(marker.originalPublicFiles, Object.entries(SOURCE_FILES[marker.platform]).map(([relative, sha256]) => ({path: `${marker.platform}-legacy/${relative}`, sha256})), 'The historical public source binding changed');
  const expected = [...Object.keys(SOURCE_FILES[marker.platform]), INPUT].sort();
  assert.deepEqual(marker.generatedPublicFiles.map(item => item.path).sort(), expected, 'The generated input manifest must contain exactly the public whitelist');
  for (const item of marker.generatedPublicFiles) assert.equal(sha(readFileSync(regularFile(directory, item.path))), item.sha256, `Generated producer input changed: ${item.path}`);
  assert.equal(sha(readFileSync(regularFile(directory, INPUT))), marker.inputsSHA256, 'Visible producer data binding changed');
  validateVisibleInputs(JSON.parse(readFileSync(regularFile(directory, INPUT), 'utf8')));
  return {...marker, verification: 'public-inputs-unchanged', nativeBuildVerified: false, deviceExecuted: false};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let result;
  if (process.argv.length === 3 && ['ios', 'android'].includes(process.argv[2])) result = createVisibleProducerProject(process.argv[2]);
  else if (process.argv.length === 4 && process.argv[2] === '--verify') result = verifyVisibleProducerProject(process.argv[3]);
  else throw new Error('Use ios, android, or --verify <new-marked-project>; this tool never builds, installs or launches');
  console.log(JSON.stringify(result, null, 2));
}
