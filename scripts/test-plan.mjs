// Tests for supabase/functions/lesson/plan.ts. Free, and calls nothing.
// Run from the learning-app folder:   node scripts/test-plan.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/lesson/plan.ts', import.meta.url), 'utf8');
const built = join(mkdtempSync(join(tmpdir(), 'plan-')), 'plan.mjs');
writeFileSync(built, ts.transpileModule(source, { compilerOptions: { module: 'esnext', target: 'es2022' } }).outputText);
const { chapterLengths, dependencies, fullMinutes, isBlueprint, pickChapters } = await import(pathToFileURL(built));

const ch = (title, minutes, priority) => ({ title, brief: '', fact_ids: [], minutes, priority });
// Opening, five middle chapters, payoff: 1 + 3 + 2 + 3 + 4 + 2 + 3 = 18 minutes in full.
const story = [ch('Opening'), ch('Setup', 3, 1), ch('Aside', 2, 3), ch('Turn', 3, 1), ch('Depth', 4, 2), ch('Color', 2, 3), ch('Payoff', 3)];
const names = (minutes) => pickChapters(story, minutes).picked.map((i) => story[i].title);
const sum = (minutes) => pickChapters(story, minutes).lengths.reduce((a, b) => a + b, 0);

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log('ok  ', name);
};

test('a plan with minutes on every chapter is a blueprint', () => {
  assert.equal(isBlueprint(story), true);
  assert.equal(isBlueprint([{ title: 'a', brief: '', fact_ids: [] }, { title: 'b', brief: '', fact_ids: [] }]), false);
});
test('the whole story is the sum of its chapters', () => assert.equal(fullMinutes(story), 18));
test('the shortest lesson still opens and pays off', () => assert.deepEqual(names(5), ['Opening', 'Payoff']));
test('essential chapters come before optional ones', () => assert.deepEqual(names(10), ['Opening', 'Setup', 'Turn', 'Payoff']));
test('optional chapters fill in by priority, in story order', () => assert.deepEqual(names(14), ['Opening', 'Setup', 'Turn', 'Depth', 'Payoff']));
test('a lesson never runs over the time asked for', () => {
  for (let m = 5; m <= 60; m++) assert.ok(sum(m) <= m, `${m} minutes gave ${sum(m)}`);
});
test('asking for more than the story has does not pad it', () => {
  assert.equal(sum(60), 18);
  assert.equal(names(60).length, story.length);
});
test('chapter lengths are held to two to four minutes', () => {
  const odd = [ch('Opening'), ch('Long', 9, 1), ch('Short', 1, 1), ch('Payoff', 3)];
  assert.deepEqual(pickChapters(odd, 30).lengths, [1, 4, 2, 3]);
});
test('a two chapter story is the opening and the payoff', () => {
  const two = [ch('Opening'), ch('Payoff', 4)];
  assert.deepEqual(pickChapters(two, 15), { picked: [0, 1], lengths: [1, 4], bridges: [[], []] });
});
test('plans from before blueprints keep the old lengths', () => {
  const old = Array.from({ length: 6 }, (_, i) => ({ title: `c${i}`, brief: '', fact_ids: [] }));
  assert.deepEqual(pickChapters(old, 10), { picked: [0, 1, 2, 3], lengths: [1, 3, 3, 3], bridges: [[], [], [], []] });
  assert.deepEqual(chapterLengths(15), [1, 3, 3, 3, 3, 2]);
});

// A story with a chain of cause and effect: a 3 minute first chapter, a problem, its
// solution, an aside, the consequence, and a payoff that depends on the consequence.
const need = (title, minutes, priority, needs, short) => ({ title, brief: '', fact_ids: [], minutes, priority, needs, short });
const chain = [
  need('Cold open and setup', 3, 1, []),
  need('The problem', 3, 2, [1], 'the problem'),
  need('The fix', 3, 2, [2], 'the fix'),
  need('An aside', 2, 1, [1], 'an aside'),
  need('The consequence', 3, 2, [3], 'the consequence'),
  need('Payoff', 3, 1, [5], 'payoff'),
];
const titles = (minutes) => pickChapters(chain, minutes).picked.map((i) => chain[i].title);

test('dependencies follow the chain back to the start', () => {
  assert.deepEqual(dependencies(chain, 5), [0, 1, 2, 4]);
  assert.deepEqual(dependencies(chain, 3), [0]);
});
test('a first chapter with its own length is counted at that length', () => assert.equal(fullMinutes(chain), 17));
test('what the ending depends on beats a higher priority aside', () => {
  // 15 minutes fits the whole causal chain but not the aside, even though the aside is priority 1.
  assert.deepEqual(titles(15), ['Cold open and setup', 'The problem', 'The fix', 'The consequence', 'Payoff']);
});
test('a chapter is never kept without what it depends on being kept or bridged', () => {
  for (let m = 5; m <= 20; m++) {
    const { picked, bridges } = pickChapters(chain, m);
    const covered = new Set(picked);
    picked.forEach((i, k) => {
      for (const j of bridges[k]) covered.add(j);
      for (const j of dependencies(chain, i)) assert.ok(covered.has(j), `${m} min: "${chain[i].title}" lost "${chain[j].title}"`);
    });
  }
});
test('the shortest lesson folds the missing chain into the payoff', () => {
  const { picked, bridges } = pickChapters(chain, 6);
  assert.deepEqual(picked, [0, 5]);
  assert.deepEqual(bridges, [[], [1, 2, 4]]);
});
test('a missing beat is bridged only once', () => {
  const { picked, bridges } = pickChapters(chain, 9);
  // The problem fits, the fix and the consequence do not. The payoff carries them, not the problem again.
  assert.deepEqual(picked, [0, 1, 5]);
  assert.deepEqual(bridges, [[], [], [2, 4]]);
});
test('a chapter cannot depend on a later one or on itself', () => {
  const bad = [need('A', 3, 1, [2, 1]), need('B', 3, 1, [2, 3, 99]), need('C', 3, 1, [])];
  assert.deepEqual(dependencies(bad, 0), []);
  assert.deepEqual(dependencies(bad, 1), []);
});
console.log(`${passed} tests passed`);
