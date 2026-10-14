import test from 'node:test'
import assert from 'node:assert/strict'
import {emptyTagDraft, addDraftTag, removeDraftTag, selectedTagIds, reconcileTagDraft, similarTags} from '../../src/reader/tags.ts'

const tag = (id, tag_name = id) => ({id, tag_name})
test('tag draft preserves local add/remove across unrelated remote updates and acknowledges applied edits', () => {
  let draft = addDraftTag(emptyTagDraft(), tag('local'), ['one', 'two'])
  draft = removeDraftTag(draft, 'one', ['one', 'two'])
  assert.deepEqual(selectedTagIds(draft, ['one', 'two', 'remote']), ['two', 'remote', 'local'])
  draft = reconcileTagDraft(draft, ['two', 'remote', 'local'])
  assert.deepEqual(draft, emptyTagDraft())
  assert.deepEqual(selectedTagIds(draft, ['two', 'remote', 'local']), ['two', 'remote', 'local'])
})
test('tag draft can undo an add or remove without producing duplicate ids', () => {
  let draft = removeDraftTag(emptyTagDraft(), 'one', ['one'])
  draft = addDraftTag(draft, tag('one'), ['one'])
  draft = addDraftTag(draft, tag('new'), ['one'])
  draft = addDraftTag(draft, tag('new'), ['one'])
  assert.deepEqual(selectedTagIds(draft, ['one']), ['one', 'new'])
  assert.deepEqual(selectedTagIds(removeDraftTag(draft, 'new', ['one']), ['one']), ['one'])
  assert.deepEqual(selectedTagIds(emptyTagDraft(), ['one']), ['one'])
})
test('source autocomplete ignores case and ranks exact/prefix/substring matches, excluding selected tags', () => {
  const tags = [tag('substring', 'Reading Art'), tag('exact', 'ART'), tag('prefix', 'Article'), tag('selected', 'art')]
  assert.deepEqual(similarTags(tags, ['selected'], 'art').map(item => item.id), ['exact', 'prefix', 'substring'])
  assert.deepEqual(similarTags(tags, [], ''), [])
})
