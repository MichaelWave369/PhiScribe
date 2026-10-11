import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countWords, safeFilename, elapsedClock, makeMarkdown, restoreBackup, newDocument, BACKUP_FORMAT } from '../src/transcript-utils.mjs';
test('counts empty, English and non-Latin text', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('hello world'), 2);
  assert.ok(countWords('こんにちは世界') >= 1);
});
test('prevents forbidden filename characters', () => {
  assert.equal(safeFilename('meeting: hello / world?.'), 'meeting hello world');
  assert.equal(safeFilename('...'), 'Untitled transcript');
});
test('formats elapsed recording times', () => {
  assert.equal(elapsedClock(0), '00:00');
  assert.equal(elapsedClock(61000), '01:01');
  assert.equal(elapsedClock(3661000), '01:01:01');
});
test('markdown contains title and editable transcript', () => {
  const md = makeMarkdown({ title:'Brainstorm', note:'Meeting', text:'Hello!', createdAt:0 });
  assert.ok(md.includes('# Brainstorm'));
  assert.ok(md.includes('Meeting'));
  assert.ok(md.includes('Hello!'));
});
test('roundtrips backups with text and metadata', () => {
  const document = { ...newDocument(), title:'Note', text:'hello φ' };
  assert.deepEqual(restoreBackup(JSON.stringify({ format:BACKUP_FORMAT, document })), document);
});
test('rejects malformed and oversized backups', () => {
  assert.throws(() => restoreBackup('{}'));
  assert.throws(() => restoreBackup(JSON.stringify({format:BACKUP_FORMAT, document:{title:'X',text:24}})));
});
