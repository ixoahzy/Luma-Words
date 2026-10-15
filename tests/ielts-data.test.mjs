import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const dataPath = path.resolve('ielts-word-data.js');
const pagePath = path.resolve('index.html');

function loadIeltsData() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(dataPath, 'utf8'), context, { filename: dataPath });
  return JSON.parse(JSON.stringify(context.window.IELTS_WORD_DATA));
}

function loadIeltsLibrary() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(dataPath, 'utf8'), context, { filename: dataPath });
  const libraryPath = path.resolve('ielts-library.js');
  vm.runInNewContext(fs.readFileSync(libraryPath, 'utf8'), context, { filename: libraryPath });
  return context.window.IELTS_LIBRARY;
}

function loadBuiltinMeanings() {
  const html = fs.readFileSync(pagePath, 'utf8');
  const startMarker = 'const BUILTIN_WORDS=/*__BUILTIN_WORDS_START__*/';
  const start = html.indexOf(startMarker) + startMarker.length;
  const end = html.indexOf('/*__BUILTIN_WORDS_END__*/', start);
  const source = html.slice(start, end).trim().replace(/;$/, '');
  const rows = vm.runInNewContext('(' + source + ')');
  return new Map(rows.map(([word, meaning]) => [word.toLocaleLowerCase(), meaning]));
}

test('IELTS source preserves all 22 Lists and their source order', () => {
  const data = loadIeltsData();
  const expectedCounts = [237, 126, 165, 74, 398, 118, 79, 65, 171, 151, 111, 167, 126, 133, 147, 169, 114, 211, 120, 259, 412, 52];

  assert.equal(data.lists.length, 22);
  assert.deepEqual(data.lists.map((list) => list.items.length), expectedCounts);
  assert.equal(data.lists.flatMap((list) => list.items).length, 3605);
  assert.equal(JSON.stringify(data).includes('核遭险运重'), false);
  assert.equal(data.lists.flatMap((list) => list.items).some((item) => item.meaning.startsWith('[')), false);
  assert.deepEqual(data.lists[0].items.slice(0, 2).map((item) => item.word), ['atmosphere', 'lithosphere']);

  for (const [index, list] of data.lists.entries()) {
    assert.equal(list.id, `list-${index + 1}`);
    assert.deepEqual(list.items.map((item) => item.order), Array.from({ length: expectedCounts[index] }, (_, offset) => offset + 1));
  }
});

test('IELTS meanings reuse the standard punctuation used by the main library', () => {
  const data = loadIeltsData();
  const meanings = loadBuiltinMeanings();

  for (const item of data.lists.flatMap((list) => list.items)) {
    assert.equal(item.meaning, meanings.get(item.word.toLocaleLowerCase()), item.word);
  }
});

test('three vocabulary modes use a single-row responsive switch layout', () => {
  const html = fs.readFileSync(pagePath, 'utf8');

  assert.match(html, /\.level-switch,\.study-tabs\{grid-template-columns:repeat\(3,max-content\)/);
  assert.match(html, /@media\(max-width:700px\)\{\.level-switch button,\.study-tabs button\{padding:0 7px;font-size:10px\}/);
});

test('IELTS selection keeps its mode label horizontal and its List selector contained', () => {
  const html = fs.readFileSync(pagePath, 'utf8');

  assert.match(html, /#ieltsScope\{width:auto;min-width:160px;flex:1 1 180px\}/);
  assert.match(html, /\.pill\{flex:0 0 auto;white-space:nowrap\}/);
});

test('dictation exposes saved progress, direct jump, and restart controls', () => {
  const html = fs.readFileSync(pagePath, 'utf8');

  assert.match(html, /dp:"lumaWords\.dictationProgress\.v1"/);
  assert.match(html, /id="dictationJump"/);
  assert.match(html, /id="jumpDictation"/);
  assert.match(html, /id="restartDictation"/);
  assert.match(html, /继续第 \$\{resumeIndex\+1\} 词/);
});

test('IELTS quiz scope only includes records from the chosen List', () => {
  const library = loadIeltsLibrary();
  const scoped = library.quizWords('list-1');

  assert.equal(scoped.length, 237);
  assert.ok(scoped.every((item) => item.listId === 'list-1'));
  assert.deepEqual(Array.from(scoped.slice(0, 2), (item) => item.word), ['atmosphere', 'lithosphere']);
  assert.equal(library.quizWords('not-a-list').length, 3605);
});

test('IELTS source records have stable, List-specific mistake identities', () => {
  const library = loadIeltsLibrary();
  const items = library.quizWords('all');
  const ids = new Set(Array.from(items, (item) => item.id));

  assert.equal(ids.size, 3605);
  assert.equal(library.quizWords('list-1')[0].id, 'ielts-1-1');
  assert.equal(library.quizWords('list-2')[0].id, 'ielts-2-1');
});

test('IELTS imports cannot enter an original List or change its source order', () => {
  const library = loadIeltsLibrary();
  const imported = library.importedWord({
    word: 'practice-only',
    meaning: '仅用于测试',
    ipa: '',
    listId: 'list-1',
    order: 1
  }, 'custom-record');

  assert.deepEqual(JSON.parse(JSON.stringify(imported)), {
    id: 'custom-record',
    word: 'practice-only',
    meaning: '仅用于测试',
    ipa: '',
    listId: 'custom',
    listName: '自定义',
    order: 0,
    source: 'ielts'
  });
  assert.equal(library.quizWords('list-1').some((item) => item.id === imported.id), false);
  assert.equal(library.isSourceRecord({ ...imported, listId: 'list-1', order: 1 }), false);
  assert.equal(library.isSourceRecord(library.quizWords('list-1')[0]), true);
});
