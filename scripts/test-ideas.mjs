// Tests for the idea writer's prompt versions, reply reading and call limits
// (supabase/functions/shelf/ideas.ts), and the title rule for planned stories (lesson/plan.ts).
// Free, and calls nothing. Run from the learning-app folder:   node scripts/test-ideas.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const build = async (rel, name) => {
  const source = readFileSync(new URL(rel, import.meta.url), 'utf8');
  const out = join(mkdtempSync(join(tmpdir(), 'ideas-')), name);
  writeFileSync(out, ts.transpileModule(source, { compilerOptions: { module: 'esnext', target: 'es2022' } }).outputText);
  return import(pathToFileURL(out));
};
const ideas = await build('../supabase/functions/shelf/ideas.ts', 'ideas.mjs');
const plan = await build('../supabase/functions/lesson/plan.ts', 'plan.mjs');
const { PROPOSER_V1, PROPOSER_V2, pickVersion, ideaInput, readIdeas, mayAskForIdeas, callCost } = ideas;

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log('ok  ', name);
};
const words = (s) => s.split(/\s+/).filter(Boolean).length;

// ---------- The prompts ----------

test('v1 is the prompt in use until now, unchanged', () => {
  assert.match(PROPOSER_V1, /Most are shaped 'The \[someone or something\] that \[did the absurd thing\]'/);
  assert.match(PROPOSER_V1, /About one in three is instead a plain question/);
});
test('v2 is shorter than v1', () => assert.ok(words(PROPOSER_V2) < words(PROPOSER_V1), `${words(PROPOSER_V2)} vs ${words(PROPOSER_V1)}`));
test('v2 has no shape quota and allows all three shapes', () => {
  assert.doesNotMatch(PROPOSER_V2, /one in three|Most are shaped/);
  assert.match(PROPOSER_V2, /a question the story answers/);
  assert.match(PROPOSER_V2, /'The \[someone or something\] that \[did it\]'/);
  assert.match(PROPOSER_V2, /a short statement/);
});
test('v2 carries the commonplace test and choosing the angle first', () => {
  assert.match(PROPOSER_V2, /Unusual-sounding is not enough/);
  assert.match(PROPOSER_V2, /Choose the angle before the headline/);
});
test('v2 asks for variety without a rigid quota', () => {
  assert.doesNotMatch(PROPOSER_V2, /never two about animals/);
  assert.match(PROPOSER_V2, /two animal stories, or two from the same century, are fine/);
  assert.match(PROPOSER_V2, /do not let deaths, crimes and disasters crowd out/);
});
test('v2 ties the headline to the story that will be made, and allows a skip', () => {
  assert.match(PROPOSER_V2, /the story will be built to deliver exactly what it promises/);
  assert.match(PROPOSER_V2, /\{"skip": true\}/);
});
test('v2 keeps v1\'s rules on names, length and truth', () => {
  for (const rule of [/Nine words and fifty characters at most/, /never by name/, /Promise only what the Wikipedia article tells/, /Wikipedia covers in depth/]) assert.match(PROPOSER_V2, rule);
});

// ---------- Which version, and the message sent ----------

test('the setting picks the version; ab splits by chance', () => {
  assert.equal(pickVersion('v1', 0.1), 'v1');
  assert.equal(pickVersion('v2', 0.9), 'v2');
  assert.equal(pickVersion('ab', 0.2), 'v1');
  assert.equal(pickVersion('ab', 0.7), 'v2');
  assert.equal(pickVersion('anything else', 0.7), 'v2');
});
const input = { interests: ['Marine biology', 'Inventions'], liked: ['A'], disliked: [], offered: ['Emu War (The war we lost to birds)'], slots: ['Marine biology', 'Inventions', 'Off the map'] };
test('only the last line of the message differs between versions', () => {
  const a = ideaInput('v1', input), b = ideaInput('v2', input);
  assert.match(a, /Propose 3 topics, one for each of these, in this order:/);
  assert.match(b, /One entry for each of these lines, in this order:/);
  assert.equal(a.split('\n').slice(0, 4).join('\n'), b.split('\n').slice(0, 4).join('\n'));
  assert.match(b, /1\. Marine biology\n2\. Inventions\n3\. Off the map$/);
});

// ---------- Reading the reply ----------

const sameish = (a, b) => a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
const opts = (extra = {}) => ({ slots: ['Marine biology', 'Inventions', 'Off the map'], labels: ['Marine biology', 'Inventions'], isRepeat: () => false, isMade: () => false, sameSubject: sameish, maxCard: 56, batch: 6, ...extra });
test('a skip keeps the later entries on their own lines', () => {
  const reply = JSON.stringify([{ skip: true }, { title: 'Odometer', card: 'The cart that counted miles with pebbles', tag: 'nonsense' }, { title: 'Gef', card: 'The talking mongoose', tag: 'Off the map' }]);
  const { ideas: kept, rejected } = readIdeas(reply, opts());
  assert.equal(kept.length, 2);
  assert.equal(kept[0].tag, 'Inventions');
  assert.equal(kept[1].tag, 'Off the map');
  assert.equal(rejected.skipped, 1);
});
test('a tag naming another of the listener\'s interests is believed', () => {
  const { ideas: kept } = readIdeas(JSON.stringify([{ title: 'Hagfish', card: 'Why hagfish tie themselves in knots', tag: 'marine biology' }, { title: 'Pencil', card: 'Why pencils are yellow', tag: 'Marine Biology' }]), opts());
  assert.deepEqual(kept.map((k) => k.tag), ['Marine biology', 'Marine biology']);
});
test('every dropped idea is counted by its reason', () => {
  const reply = JSON.stringify([
    { title: '', card: 'x' },
    { title: 'Emu War', card: 'The war Australia lost to birds' },
    { title: 'Vasa (ship)', card: 'The warship that sank in sight of the dock' },
    { title: 'Coconut octopus', card: 'Why do octopuses carry coconuts around with them all day long' },
    { title: 'Hagfish', card: 'Why hagfish tie themselves in knots' },
    { title: 'Hagfish slime', card: 'The slime that stops a shark' },
  ]);
  const { ideas: kept, rejected } = readIdeas(reply, opts({ isRepeat: (t) => t === 'Emu War', isMade: (t) => t === 'Vasa (ship)' }));
  assert.deepEqual(kept.map((k) => k.title), ['Hagfish']);
  assert.deepEqual(rejected, { skipped: 0, empty: 1, repeat_headline: 1, same_subject: 2, too_long: 1, over_batch: 0 });
});
test('Listen batches have no headline limit, and a batch never runs over', () => {
  const reply = JSON.stringify([{ title: 'A one', card: 'x'.repeat(80) }, { title: 'B two', card: 'y' }, { title: 'C three', card: 'z' }]);
  const { ideas: kept, rejected } = readIdeas(reply, opts({ maxCard: null, batch: 2 }));
  assert.equal(kept.length, 2);
  assert.equal(rejected.over_batch, 1);
});
test('text around the JSON is ignored, and a reply with no JSON is an error', () => {
  assert.equal(readIdeas('Here you go:\n[{"title":"Gef","card":"The talking mongoose"}]\nEnjoy', opts()).ideas.length, 1);
  assert.throws(() => readIdeas('No ideas today.', opts()));
});

// ---------- The daily cap and the pause ----------

const H = 3600_000, now = Date.parse('2026-11-27T12:00:00Z');
test('a person with no recent calls may ask', () => assert.deepEqual(mayAskForIdeas([], now), { ok: true }));
test('eight calls in 24 hours is the cap, and the cap lifts as the oldest ages out', () => {
  const calls = Array.from({ length: 8 }, (_, i) => ({ at: now - (i + 1) * 2 * H, kept: 5 }));
  const held = mayAskForIdeas(calls, now);
  assert.equal(held.ok, false);
  assert.equal(held.reason, 'daily_cap');
  assert.equal(held.until, now - 16 * H + 24 * H);
  assert.equal(mayAskForIdeas(calls, now + 9 * H).ok, true);
  assert.equal(mayAskForIdeas(calls.slice(0, 7), now).ok, true);
});
test('after a thin call the next waits 30 minutes', () => {
  const calls = [{ at: now - 10 * 60_000, kept: 1 }, { at: now - 3 * H, kept: 5 }];
  const held = mayAskForIdeas(calls, now);
  assert.equal(held.reason, 'backoff');
  assert.equal(held.until, now + 20 * 60_000);
  assert.equal(mayAskForIdeas(calls, now + 21 * 60_000).ok, true);
});
test('the pause doubles with each thin call in a row, up to 12 hours', () => {
  const thin = (n) => Array.from({ length: n }, (_, i) => ({ at: now - i * 60_000, kept: 0 }));
  assert.equal(mayAskForIdeas(thin(2), now).until, now + 60 * 60_000);
  assert.equal(mayAskForIdeas(thin(3), now).until, now + 120 * 60_000);
  assert.equal(mayAskForIdeas(thin(7), now, 100).until, now + 12 * H);
});
test('one good call resets the pause', () => {
  assert.equal(mayAskForIdeas([{ at: now - 60_000, kept: 3 }, { at: now - 2 * 60_000, kept: 0 }, { at: now - 3 * 60_000, kept: 0 }], now).ok, true);
});
test('a stuck person costs at most 8 calls a day, not one a minute', () => {
  const calls = [];
  for (let t = now; t < now + 24 * H; t += 60_000) if (mayAskForIdeas(calls, t).ok) calls.unshift({ at: t, kept: 0 });
  assert.ok(calls.length <= 8, `${calls.length} calls`);
  assert.ok(calls.length >= 5, `${calls.length} calls`);
});

// ---------- Cost per call ----------

test('cost is worked out from the price table, cached input at its own rate', () => {
  const c = callCost({ in: 0.75, cached_in: 0.075, out: 6 }, { input_tokens: 10_000, cached_tokens: 2_000, output_tokens: 7_000 });
  assert.ok(Math.abs(c - (8000 * 0.75 + 2000 * 0.075 + 7000 * 6) / 1e6) < 1e-12);
  assert.equal(callCost(undefined, { input_tokens: 1, cached_tokens: 0, output_tokens: 1 }), null);
});

// ---------- The headline a story keeps ----------

test('a story that delivers the Explore headline keeps it word for word', () => {
  assert.equal(plan.chosenTitle('Why do octopuses carry coconuts?', { title: 'The octopus that carries its house', headline_holds: true }, 'Coconut octopus'), 'Why do octopuses carry coconuts?');
});
test('a headline the research cannot carry gives way to the planner\'s title', () => {
  assert.equal(plan.chosenTitle('The jellyfish that lives forever', { title: 'The jellyfish that can grow young again', headline_holds: false }, 'Turritopsis dohrnii'), 'The jellyfish that can grow young again');
  assert.equal(plan.chosenTitle('The jellyfish that lives forever', { title: 'The jellyfish that can grow young again' }, 'Turritopsis dohrnii'), 'The jellyfish that can grow young again');
});
test('without an Explore headline the planner\'s title is used, then the subject', () => {
  assert.equal(plan.chosenTitle(null, { title: 'The war we lost to birds' }, 'Emu War'), 'The war we lost to birds');
  assert.equal(plan.chosenTitle('', {}, 'Emu War'), 'Emu War');
  assert.equal(plan.chosenTitle('The war we lost to birds', {}, 'Emu War'), 'The war we lost to birds');
});

// ---------- The planner, Story Editor and house style hold the Explore promise ----------

const lesson = readFileSync(new URL('../supabase/functions/lesson/index.ts', import.meta.url), 'utf8');
const style = readFileSync(new URL('../supabase/functions/lesson/house-style.ts', import.meta.url), 'utf8');
test('the planner is handed the Explore headline and must keep its angle', () => {
  assert.match(lesson, /The listener chose this story from the headline/);
  assert.match(lesson, /never a different story about the/);
  assert.match(lesson, /"headline_holds": true, "hook"/);
});
test('the Story Editor fixes the chapters before it may retitle', () => {
  assert.match(lesson, /first change " \+\s*"the chapters so they deliver it from the notes/);
  assert.match(lesson, /\\"headline_holds\\": false/);
});
test('the house title rule allows any shape and drops the warship as a good example', () => {
  assert.doesNotMatch(style, /Good titles: \\"The disco explosion/);
  assert.doesNotMatch(style, /Do not write a full sentence that starts with/);
  assert.match(style, /in whichever shape says it best/);
  assert.match(style, /fails however it is told/);
});
test('a retitled story says which headline it was picked from', () => assert.match(lesson, /picked_headline:/));
test('Explore keeps 20 ideas and refills below 10, both changeable in settings', () => {
  assert.match(lesson, /const IDEAS_KEPT = 20;/);
  assert.match(lesson, /const IDEAS_REFILL_BELOW = 10;/);
  assert.match(lesson, /setting\("ideas_kept"/);
});

console.log(`\n${passed} tests passed`);
