import test from 'node:test';
import assert from 'node:assert/strict';
import {AutomaticCachePlan} from '../../src/data/cache-plan.ts';
import type {CacheCandidate, CacheLocalState, CacheTask} from '../../src/data/repositories/cache-state.ts';
import {bookmarkCacheKey} from '../../src/data/repositories/records.ts';

const candidate = (id: string, owner?: string, pdf = false): CacheCandidate => ({id, key: bookmarkCacheKey(id, owner), owner, domain: owner === undefined ? 'personal' : 'collection', pdf, success: true});
const local = (id: string, patch: Partial<CacheLocalState> = {}): CacheLocalState => ({id, manual: false, downloaded: false, cleared: false, pdfCachePresent: false, ...patch});
const keys = (values: Iterable<string>) => [...values].sort();

function reference(personal: CacheCandidate[], collections: CacheCandidate[], rows: CacheLocalState[], limit: number, pdfAvailable = true) {
  const locals = new Map(rows.map(row => [row.id, row])), window = new Set<string>(), tasks = new Map<string, CacheTask>(), counts = new Map<string, number>();
  for (const item of [...personal, ...collections]) {
    if (!item.success || (item.domain === 'collection' && !item.owner?.trim())) continue;
    const state = locals.get(item.key), pdf = pdfAvailable && item.pdf;
    if (state?.manual && state.downloaded) continue;
    if (pdf && state?.manual && !state.pdfCachePresent && state.cleared) continue;
    const group = item.owner ?? '';
    if (!(pdf && state?.manual)) {
      const count = counts.get(group) ?? 0;
      if (count >= limit) continue;
      counts.set(group, count + 1);
    }
    window.add(item.key);
    if (!state?.downloaded) tasks.set(item.key, {id: item.id, key: item.key, owner: item.owner, domain: item.domain, pdf});
  }
  for (const state of rows) {
    if (!pdfAvailable || !state.manual || state.downloaded || !state.pdfId || !/^[\w-]+$/.test(state.pdfId) || (state.pdfOwner !== undefined && !/^[\w-]+$/.test(state.pdfOwner))) continue;
    const key = bookmarkCacheKey(state.pdfId, state.pdfOwner);
    if (key === state.id) tasks.set(key, {id: state.pdfId, key, owner: state.pdfOwner, domain: state.pdfOwner ? 'collection' : 'personal', pdf: true});
  }
  return {window, tasks};
}

function matches(plan: AutomaticCachePlan, expected: ReturnType<typeof reference>) {
  assert.deepEqual(keys(plan.window), keys(expected.window));
  assert.deepEqual([...plan.tasks].sort(([a], [b]) => a.localeCompare(b)), [...expected.tasks].sort(([a], [b]) => a.localeCompare(b)));
}

test('a single automatic status update never iterates candidate groups or reconstructs unrelated tasks', () => {
  const plan = new AutomaticCachePlan(true);
  let inspected = 0;
  const rows = Array.from({length: 5000}, (_, index) => new Proxy(candidate(`doc-${index}`), {get(target, key, receiver) {if (key === 'success') inspected++; return Reflect.get(target, key, receiver);}}));
  plan.setCandidates('personal', rows); plan.refresh();
  assert.equal(plan.tasks.size, 50);
  const unchanged = plan.tasks.get('doc-1'); inspected = 0;
  const first = local('doc-0');
  plan.setLocal([first]); assert.deepEqual([...plan.refresh()], ['doc-0']);
  plan.setLocal([{...first, downloaded: true}]); assert.deepEqual([...plan.refresh()], ['doc-0']);
  assert.equal(inspected, 0); assert.equal(plan.tasks.get('doc-1'), unchanged); assert.equal(plan.tasks.has('doc-0'), false);
  assert.deepEqual([...plan.refresh()], []);
});

test('manual retention changes only its window and keeps each collection owner independent', () => {
  const plan = new AutomaticCachePlan(true), personal = [candidate('p1'), candidate('p2')];
  const collections = [candidate('c1', 'a'), candidate('c2', 'a'), candidate('c1', 'b'), candidate('c2', 'b')];
  plan.setLimit(1); plan.setCandidates('personal', personal); plan.setCandidates('collection', collections); plan.refresh();
  const other = plan.tasks.get('collection-b-c1'), privateTask = plan.tasks.get('p1');
  const pins = [local('collection-a-c1', {manual: true, downloaded: true})];
  plan.setLocal(pins); const changed = plan.refresh();
  matches(plan, reference(personal, collections, pins, 1));
  assert.deepEqual(keys(changed), ['collection-a-c1', 'collection-a-c2']);
  assert.equal(plan.tasks.get('collection-b-c1'), other); assert.equal(plan.tasks.get('p1'), privateTask);
  plan.setCandidates('collection', collections.filter(row => row.owner !== 'a')); plan.refresh();
  assert.equal(plan.window.has('collection-a-c2'), false); assert.equal(plan.tasks.has('collection-a-c2'), false);
  assert.equal(plan.tasks.get('collection-b-c1'), other);
});

test('PDF manual recovery survives a zero window and rejects foreign or malformed persisted contexts', () => {
  const plan = new AutomaticCachePlan(true), personal = [candidate('doc', undefined, true), candidate('cleared', undefined, true)];
  const rows = [
    local('doc', {manual: true, pdfCachePresent: true, pdfId: 'doc'}),
    local('cleared', {manual: true, cleared: true}),
    local('collection-owner-orphan', {manual: true, pdfCachePresent: true, pdfId: 'orphan', pdfOwner: 'owner'}),
    local('foreign', {manual: true, pdfCachePresent: true, pdfId: 'different'}),
    local('bad', {manual: true, pdfCachePresent: true, pdfId: '../path'}),
  ];
  plan.setLimit(0); plan.setCandidates('personal', personal); plan.setLocal(rows); plan.refresh();
  matches(plan, reference(personal, [], rows, 0));
  assert.deepEqual(keys(plan.tasks.keys()), ['collection-owner-orphan', 'doc']);
  plan.setLocal(rows.map(row => row.id === 'doc' ? {...row, downloaded: true} : row)); plan.refresh();
  assert.equal(plan.tasks.has('doc'), false);
  plan.setLocal([]); plan.refresh(); assert.equal(plan.tasks.size, 0);
});

test('bounded snapshot changes match the full planning contract across reordering, pins, status and limits', () => {
  let seed = 7309;
  const random = (bound: number) => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % bound;};
  for (const pdf of [false, true]) {
    const plan = new AutomaticCachePlan(pdf);
    let personal = Array.from({length: 20}, (_, index) => candidate(`p${index}`, undefined, index % 3 === 0));
    let collections = ['a', 'b', '', '  '].flatMap(owner => Array.from({length: 10}, (_, index) => candidate(`c${index}`, owner, index % 2 === 0)));
    let rows: CacheLocalState[] = [], limit = 4;
    for (let step = 0; step < 200; step++) {
      if (step % 7 === 0) limit = [0, 1, 4, Infinity][random(4)];
      if (step % 3 === 0) personal = [...personal.slice(1), personal[0]];
      if (step % 5 === 0) collections = [...collections.slice(1), collections[0]];
      const all = [...personal, ...collections], target = all[random(all.length)], previous = rows.find(row => row.id === target.key);
      const next = local(target.key, {...previous, manual: random(3) === 0, downloaded: random(3) === 0, cleared: random(3) === 0, pdfCachePresent: random(2) === 0});
      if (next.pdfCachePresent && random(2) === 0) {next.pdfId = target.id; next.pdfOwner = target.owner;}
      rows = [...rows.filter(row => row.id !== target.key), next];
      if (step % 4 === 0) personal = personal.map((row, index) => index === random(personal.length) ? {...row, success: random(2) === 0, pdf: random(2) === 0} : row);
      plan.setLimit(limit); plan.setCandidates('personal', personal); plan.setCandidates('collection', collections); plan.setLocal(rows); plan.refresh();
      matches(plan, reference(personal, collections, rows, limit, pdf));
    }
  }
});
