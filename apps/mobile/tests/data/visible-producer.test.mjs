import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createVisibleProducerProject, generateVisibleProducerSource, readVisibleInputs, SOURCE_FILES, validateVisibleInputs, verifyVisibleProducerProject, visibleArticle, visibleOperations} from './adoption-fixtures/tooling/visible-producer-project.mjs';
import {buildReaderMarks, htmlPaths} from '../../src/reader/model.ts';
import {MobileRepositories} from '../../src/data/repositories.ts';

const root = fileURLToPath(new URL('./adoption-fixtures/', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('full original data matches actual inbox/detail/comment queries and the saved article selection', async () => {
  const input = readVisibleInputs(), transactions = visibleOperations(input), database = new DatabaseSync(':memory:');
  try {
    const rows = [input.tag, {...input.bookmark, metadata: ''}, input.comment];
    for (const [index, table] of ['sr_user_tag', 'sr_user_bookmark', 'sr_bookmark_comment'].entries()) {
      const integers = new Set(['is_read', 'archive_status', 'is_starred', 'type', 'is_deleted']);
      database.exec(`CREATE TABLE ${table} (${Object.keys(rows[index]).map(key => `"${key}" ${integers.has(key) ? 'INTEGER' : 'TEXT'}${key === 'id' ? ' PRIMARY KEY' : ''}`).join(',')})`);
    }
    database.exec('CREATE TABLE ps_data_local__local_bookmark_info(id TEXT PRIMARY KEY,data TEXT)');
    for (const transaction of transactions) {
      database.exec('BEGIN');
      for (const operation of transaction) database.prepare(operation.sql).run(...operation.values);
      database.exec('COMMIT');
    }
    database.prepare('INSERT INTO ps_data_local__local_bookmark_info(id,data) VALUES (?,?)').run('bookmark-1', JSON.stringify(input.localJson));
    const watched = [];
    const adapter = {
      getOptional: async (sql, parameters = []) => database.prepare(sql).get(...parameters) ?? null,
      watch(sql, parameters, handler) {watched.push(sql); handler.onResult({rows: {_array: database.prepare(sql).all(...parameters)}});},
    };
    const repositories = new MobileRepositories(adapter, () => 'not-used');
    let inbox, tags, comments;
    const stops = [repositories.watchBookmarks('inbox', rows => {inbox = rows;}), repositories.watchTags(rows => {tags = rows;}), repositories.watchComments('bookmark-1', rows => {comments = rows;})];
    stops.forEach(stop => stop());
    assert.equal(inbox.length, 1); assert.equal(inbox[0].status, 'success'); assert.equal(inbox[0].aliasTitle, 'Offline article'); assert.equal(inbox[0].isStarred, 1); assert.equal(inbox[0].downloadStatus, 2);
    assert.equal((await repositories.getBookmark('bookmark-1')).archiveStatus, 0);
    assert.deepEqual(JSON.parse(inbox[0].metadata).tags, ['tag-1', 'tag-2']); assert.equal(JSON.parse(inbox[0].metadata).share.is_enable, false);
    assert.equal(tags[0].tag_name, 'offline'); assert.equal(tags[0].display, '1'); assert.equal(tags[0].source, 'mine');
    assert.equal(comments.length, 1); assert.equal(comments[0].comment, 'Pending comment');
    const marks = buildReaderMarks(comments, [], {id: 'synthetic-user', name: 'Synthetic user'}, {showMarks: true, showProfile: true});
    assert.equal(marks.mark_list.length, 1); assert.equal(marks.mark_list[0].type, 2); assert.equal(marks.mark_list[0].comment, 'Pending comment');
    assert.deepEqual(htmlPaths(comments[0].source), input.comment.source);
    const html = visibleArticle(input), quote = /<p id="controlled-quote">([^<]+)<\/p>/.exec(html)[1];
    assert.equal(quote.slice(input.comment.source[0].start, input.comment.source[0].end), input.comment.approx_source.exact);
    assert.equal((html.match(/id="controlled-paragraph-\d+"/g) ?? []).length, 18);
    assert.deepEqual(transactions.map(group => group.map(operation => [operation.table, operation.id, operation.op])), [[['sr_user_tag', 'tag-1', 'PUT'], ['sr_user_bookmark', 'bookmark-1', 'PUT']], [['sr_user_bookmark', 'bookmark-1', 'PATCH'], ['sr_bookmark_comment', 'comment-1', 'PUT']]]);
    assert.equal(watched.length, 3);
  } finally {database.close();}
});

test('visible data rejects missing normal-row/annotation binding instead of patching a preserved database', () => {
  const input = readVisibleInputs();
  for (const change of [value => {value.bookmark.archive_status = null;}, value => {delete value.bookmarkDetails.description;}, value => {value.comment.user_bookmark_uuid = 'different-bookmark';}, value => {value.comment.source[0].path = '#missing';}, value => {value.article.quote = 'Different text';}, value => {value.bookmarkDetails.target_url = 'https://real.example/article';}]) {
    const changed = structuredClone(input); change(changed); assert.throws(() => validateVisibleInputs(changed));
  }
});

test('new projects retain pinned old source/preferences/SDKs and cannot overwrite or silently accept changed inputs', () => {
  for (const platform of ['ios', 'android']) {
    const before = Object.fromEntries(Object.keys(SOURCE_FILES[platform]).map(relative => [relative, hash(readFileSync(path.join(root, `${platform}-legacy`, relative)))]));
    const marker = createVisibleProducerProject(platform);
    try {
      assert.equal(verifyVisibleProducerProject(marker.projectRoot).verification, 'public-inputs-unchanged');
      const name = platform === 'ios' ? 'src/iosSimulatorArm64Main/kotlin/LegacyFixtureProducer.kt' : 'src/main/java/com/slax/reader/LegacyFixtureActivity.kt';
      const original = readFileSync(path.join(root, `${platform}-legacy`, name), 'utf8'), generated = readFileSync(path.join(marker.projectRoot, name), 'utf8');
      assert.equal((generated.match(/db\.writeTransaction\s*\{/g) ?? []).length, 2); assert.equal((generated.match(/tx\.execute\(/g) ?? []).length, 4);
      assert.deepEqual(generated.split('\n').filter(line => line.includes('values[')), original.split('\n').filter(line => line.includes('values[')));
      assert.ok(generated.includes('fixtureScenario')); assert.ok(generated.includes(marker.inputsSHA256));
      assert.ok(readFileSync(path.join(marker.projectRoot, 'build.gradle.kts'), 'utf8').includes('1.14.1'));
      for (const relative of Object.keys(SOURCE_FILES[platform])) assert.equal(hash(readFileSync(path.join(root, `${platform}-legacy`, relative))), before[relative]);
      writeFileSync(path.join(marker.projectRoot, name), generated + '\n// unreviewed change\n'); assert.throws(() => verifyVisibleProducerProject(marker.projectRoot), /Generated producer input changed/);
      assert.throws(() => generateVisibleProducerSource(platform, original.replace('tx.execute("INSERT INTO sr_user_tag(', 'tx.execute("INSERT INTO another_table(')), /must be unique/);
    } finally {rmSync(marker.projectRoot, {recursive: true, force: true});}
  }
});

test('marked verification rejects a changed data file or symlink before opening it', () => {
  const marker = createVisibleProducerProject('ios');
  try {
    const input = path.join(marker.projectRoot, 'visible-legacy-inputs.json'); rmSync(input); symlinkSync('/nonexistent-file-must-not-be-opened', input);
    assert.throws(() => verifyVisibleProducerProject(marker.projectRoot), /cannot use symlinks/);
  } finally {rmSync(marker.projectRoot, {recursive: true, force: true});}
});
