import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const page = fs.readFileSync('index.html', 'utf8');
const source = page.slice(page.indexOf('    function getTutorContext(){'), page.indexOf('    window.LumaWordTutor='));

function row(word, meaning, top, bottom, left = 0, right = 500) {
  return {
    getBoundingClientRect: () => ({ top, bottom, left, right, width: right - left, height: bottom - top }),
    querySelector: () => ({ dataset: { studyWord: word, studyMeaning: meaning } }),
  };
}

function studyContext(rows, selected = null, level = 'ordinary') {
  const context = {
    E: {
      dictationOverlay: { hidden: true },
      studyPage: { hidden: false, querySelector: () => null },
      studyTitle: { textContent: '教育与学习' },
      studySearch: { value: '' },
    },
    window: { innerHeight: 600, innerWidth: 800 },
    document: { documentElement: { clientHeight: 600, clientWidth: 800 } },
    $$: () => rows,
    $: () => null,
    studyLevel: level,
    aiStudyWord: selected,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return JSON.parse(JSON.stringify(context.getTutorContext()));
}

test('study questions capture visible words without a prior selection', () => {
  const result = studyContext([
    row('hidden-above', '屏幕上方', -100, -10),
    row('learn', '学习', 100, 145),
    row('practice', '练习', 150, 195),
    row('hidden-below', '屏幕下方', 650, 700),
    row('hidden-right', '横向不可见', 200, 245, 900, 1000),
  ]);
  assert.deepEqual(result.entries.map(entry => entry.word), ['learn', 'practice']);
  assert.equal(result.scope, 'viewport');
});

test('scrolling refreshes the snapshot and does not retain an old selected word', () => {
  const rows = [row('learn', '学习', 100, 145), row('practice', '练习', 650, 700)];
  const first = studyContext(rows, { word: 'yesterday', meaning: '昨天' });
  const next = studyContext([row('learn', '学习', -100, -55), row('practice', '练习', 100, 150)]);
  assert.deepEqual(first.entries.map(entry => entry.word), ['learn']);
  assert.deepEqual(next.entries.map(entry => entry.word), ['practice']);
  assert.notEqual(first.id, next.id);
});

test('an empty viewport does not fall back to an invisible selected word', () => {
  const result = studyContext([], { word: 'yesterday', meaning: '昨天' });
  assert.deepEqual(result.entries, []);
  assert.match(result.prompt, /没有/);
});

test('IELTS list includes every visible word beyond four, using numeric order', () => {
  const words = ['atmosphere', 'lithosphere', 'oxygen', 'oxide', 'carbon dioxide', 'hydrogen'];
  const result = studyContext(words.map((word, index) => row(word, '释义', 80 + index * 70, 140 + index * 70)), null, 'ielts');
  assert.equal(result.activity, 'study');
  assert.deepEqual(result.entries.map(entry => entry.word), words);
  assert.deepEqual(result.entries.map(entry => entry.label), ['1', '2', '3', '4', '5', '6']);
});

test('a foreground learning dialog overrides the background quiz', () => {
  const visible = { childElementCount: 0, tagName: 'SPAN', innerText: '词库里的当前单词', parentElement: null,
    getBoundingClientRect: () => ({ top: 100, bottom: 140, left: 50, right: 600, width: 550, height: 40 }) };
  const below = { ...visible, innerText: '不可见的旧词条', getBoundingClientRect: () => ({ top: 700, bottom: 750, left: 50, right: 600, width: 550, height: 50 }) };
  const wordLeaf = (word, meaning, top) => ({ ...visible, innerText: word, textContent: word,
    matches: () => true, closest: () => ({ querySelector: () => ({ textContent: meaning }) }),
    getBoundingClientRect: () => ({ top, bottom: top + 40, left: 50, right: 600, width: 550, height: 40 }) });
  const dialog = { id: 'libraryOverlay', querySelector: () => ({ textContent: '单词库' }), querySelectorAll: () => [visible, below, wordLeaf('technique', '技巧', 150), wordLeaf('technology', '科技', 200)],
    getBoundingClientRect: () => ({ top: 0, bottom: 600, left: 0, right: 800 }) };
  const context = { E: { dictationOverlay: { hidden: true }, studyPage: { hidden: true }, q: { hidden: false } },
    document: { querySelectorAll: () => [dialog], documentElement: { clientHeight: 600, clientWidth: 800 } },
    window: { innerHeight: 600, innerWidth: 800 }, current: null };
  vm.createContext(context);
  vm.runInContext(source, context);
  const result = context.getTutorContext();
  assert.equal(result.activity, 'page');
  assert.equal(result.title, '单词库');
  assert.match(result.prompt, /词库里的当前单词/);
  assert.doesNotMatch(result.prompt, /不可见的旧词条/);
  assert.deepEqual(JSON.parse(JSON.stringify(result.entries)).map(entry => entry.word), ['technique', 'technology']);
});
