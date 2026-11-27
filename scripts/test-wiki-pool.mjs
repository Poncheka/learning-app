// Tests for supabase/functions/shelf/wiki-pool.ts. Free, and calls nothing.
// Run from the learning-app folder:   node scripts/test-wiki-pool.mjs
// The fixtures are four pages of Wikipedia's Unusual articles list as fetched on Nov 27, 2026.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const load = async (rel) => {
  const file = join(mkdtempSync(join(tmpdir(), 'wp-')), 'm.mjs');
  writeFileSync(file, ts.transpileModule(readFileSync(new URL(rel, import.meta.url), 'utf8'), { compilerOptions: { module: 'esnext', target: 'es2022' } }).outputText);
  return import(pathToFileURL(file));
};
const W = await load('../supabase/functions/shelf/wiki-pool.ts');
const { sameSubject } = await load('../supabase/functions/lesson/plan.ts');
const page = (p) => W.parseUnusual(readFileSync(new URL(`./fixtures/unusual-${p}.wikitext`, import.meta.url), 'utf8'), p);
const all = ['History', 'Science', 'Food', 'Folklore'].flatMap(page);
const INTERESTS = ['Weird history', 'Weird science', 'Inventions', 'Occult history', 'Conspiracy theories', 'Marine Biology', 'Cooking', 'Particle physics'];

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ', name); };

test('every table row of the list is read, with its title, description, page and heading', () => {
  const history = page('History');
  assert.ok(history.length >= 75, `${history.length}`);
  const tablet = history.find((c) => c.title === 'Complaint tablet to Ea-nāṣir');
  assert.ok(tablet && /one-star Yelp review/.test(tablet.blurb));
  assert.equal(tablet.section, 'Pre-modern');
  assert.equal(tablet.page, 'History');
  assert.equal(tablet.url, 'https://en.wikipedia.org/wiki/Complaint_tablet_to_Ea-n%C4%81%E1%B9%A3ir');
  const ball = history.find((c) => c.title === 'Bal des Ardents');
  assert.ok(ball, 'rows marked with an icon are read too');
  assert.ok(page('Food').find((c) => c.title === 'Ant egg soup'), 'rows with cell widths are read too');
  assert.ok(all.every((c) => c.blurb.length > 0 && !/\[\[|'''|\{\{/.test(c.blurb)), 'descriptions are plain text');
});
test('links in a description become their words', () => {
  assert.equal(W.plainText("An Ancient Egyptian prince buried in a random cemetery in [[Vermont]]."), 'An Ancient Egyptian prince buried in a random cemetery in Vermont.');
  assert.equal(W.plainText("[[History of China#Imperial era|Chinese history]] before ''[[Wu Zetian]]''<ref>x</ref>"), 'Chinese history before Wu Zetian');
});
test('the pool is balanced across pages, leaves out subjects already made, and is the same every time', () => {
  const made = ['Bal des Ardents', 'Emu War'];
  const pool = W.choosePool(all, { size: 200, made, sameSubject });
  assert.equal(pool.length, 200);
  assert.ok(!pool.some((c) => c.title === 'Bal des Ardents'));
  const per = Object.fromEntries(['History', 'Science', 'Food', 'Folklore'].map((p) => [p, pool.filter((c) => c.page === p).length]));
  // Folklore has fewer entries than its share, so the others make up the rest evenly.
  assert.ok(Math.max(per.History, per.Science, per.Food) - Math.min(per.History, per.Science, per.Food) <= 1, JSON.stringify(per));
  assert.deepEqual(W.choosePool(all, { size: 200, made, sameSubject }).map((c) => c.title), pool.map((c) => c.title));
  assert.equal(new Set(pool.map((c) => c.title)).size, 200, 'no duplicates');
});
test('an interest gets candidates that fit it, and none when nothing fits', () => {
  const pool = W.choosePool(all, { size: 1000, made: [], sameSubject });
  const skip = new Set();
  const food = W.candidatesFor('Cooking', pool, { interests: INTERESTS, n: 4, skip, seed: 'b1' });
  assert.equal(food.length, 4);
  assert.ok(food.every((c) => c.page === 'Food'), food.map((c) => c.title).join(', '));
  const weird = W.candidatesFor('Weird history', pool, { interests: INTERESTS, n: 4, skip, seed: 'b1' });
  assert.ok(weird.length === 4 && weird.every((c) => c.page === 'History'), 'a broad interest takes its own page');
  const physics = pool.filter((c) => W.matchScore('Particle physics', c) >= W.MATCH);
  assert.ok(physics.length > 0 && physics.every((c) => /particle|quantum|atom|electron|neutrino|quark|proton|collider|accelerator|radiation|radioactive|nuclear/i.test(`${c.title} ${c.blurb}`)), physics.map((c) => c.title).join(', '));
  assert.deepEqual(W.candidatesFor('Kayaking', pool, { interests: INTERESTS, n: 4, skip, seed: 'b1' }), [], 'no forced matches');
});
test('a specific interest needs its own subject: Marine Biology gets sea life, never moths, monkeys or spiders', () => {
  const pool = W.choosePool(all, { size: 1000, made: [], sameSubject });
  const marine = pool.filter((c) => W.matchScore('Marine Biology', c) >= W.MATCH);
  assert.ok(marine.length > 0);
  const sea = /marine|seabed|seafloor|reef|coral|whale|shark|octopus|octopuses|squid|jellyfish|dolphin|seaweed|plankton|starfish|seahorse/i;
  for (const c of marine) assert.ok(sea.test(`${c.title} ${c.blurb}`), `${c.title}: ${c.blurb}`);
  for (const wrong of ['moth', 'monkey', 'spider', 'Paracerceis sculpta', 'Madidi titi monkey', 'Funny (spider)']) assert.ok(!marine.some((c) => c.title.toLowerCase().includes(wrong.toLowerCase())), wrong);
  // The section that caused it: names of animals in "Names in biology" do not count as biology for Marine Biology.
  const names = all.filter((c) => c.section === 'Names in biology');
  assert.ok(names.length > 0 && names.every((c) => W.matchScore('Marine Biology', c) === 0 || sea.test(`${c.title} ${c.blurb}`)));
});
test('alternatives in an interest are either one, and broad or mood words never match alone', () => {
  const pool = W.choosePool(all, { size: 1000, made: [], sameSubject });
  const occult = pool.filter((c) => W.matchScore('Occult history', c) >= W.MATCH);
  assert.ok(occult.length > 0 && occult.every((c) => /occult|witch|alchem|satan|demon|exorcis|sorcer|tarot|astrolog|curse|necromanc|grimoire|spiritualis|s[eé]ance/i.test(`${c.title} ${c.blurb}`)), occult.map((c) => c.title).join(', '));
  assert.ok(!occult.some((c) => c.title === 'Prester John'), 'a Folklore entry is not occult just for being folklore');
  assert.equal(W.matchScore('History', { title: 'A thing', blurb: 'nothing here', page: 'Science', section: 'Physics', url: '' }), 0);
  assert.equal(W.matchScore('Weird', { title: 'Weird thing', blurb: 'weird', page: 'History', section: 'History', url: '' }), 0, 'a mood word alone matches nothing');
});
test('sexual subjects never enter the pool', () => {
  const pool = W.choosePool(all, { size: 1000, made: [], sameSubject });
  assert.ok(all.some((c) => W.isAdult(c)), 'the fixtures do have some');
  assert.ok(!pool.some((c) => W.isAdult(c)));
});
test('a candidate already offered, used or given to another line is not offered again, and the least offered come first', () => {
  const pool = W.choosePool(all, { size: 400, made: [], sameSubject }).map((c, i) => ({ ...c, offered: i % 3 }));
  const first = W.candidatesFor('Cooking', pool, { interests: INTERESTS, n: 3, skip: new Set(), seed: 'b2' });
  const skip = new Set(first.map((c) => c.title.toLowerCase()));
  const second = W.candidatesFor('Cooking', pool, { interests: INTERESTS, n: 3, skip, seed: 'b2' });
  assert.ok(second.every((c) => !skip.has(c.title.toLowerCase())));
});
test('the candidate an idea was built on is found by name or by subject', () => {
  const offered = page('History').slice(0, 5);
  assert.equal(W.pickedCandidate(offered[2].title, offered, sameSubject)?.title, offered[2].title);
  assert.equal(W.pickedCandidate(`The ${offered[2].title}`, offered, sameSubject)?.title, offered[2].title);
  assert.equal(W.pickedCandidate('Emu War', offered, sameSubject), null);
});
test('the candidates are shown under their line, and nothing is added when there are none', () => {
  const lines = W.candidateLines(page('Food').slice(0, 2));
  assert.ok(lines.startsWith("\n   Optional subjects from Wikipedia's Unusual articles list:\n   - "));
  assert.equal(W.candidateLines([]), '');
});

console.log(`${passed} tests passed`);
