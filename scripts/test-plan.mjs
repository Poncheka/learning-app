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
const { chapterLengths, dependencies, fullMinutes, isBlueprint, pickChapters, previousTelling, tellStory, isEssential, essentialRank, hasBeats, keepRevision, keepCorrection, revisePremise, readingRate, minutesOf, FOLDED_LONGEST, sameSubject, isResearchGap, toldBefore, mergeShortChapters } = await import(pathToFileURL(built));
const { FIVE } = await import('./fixtures/five-stories.mjs');
const { readPlans, sourceFamily } = await import('./telling-report.mjs');

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
test('chapter lengths are held to one to four minutes', () => {
  const odd = [ch('Opening'), ch('Long', 9, 1), ch('Short', 1, 1), ch('Zero', 0.2, 1), ch('Payoff', 3)];
  assert.deepEqual(pickChapters(odd, 30).lengths, [1, 4, 1, 1, 3]);
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

// ---------- Tellings that keep the story's heart, within the old budget ----------
const told = (outline, m) => tellStory(outline, m);
const allBeats = (t) => t.told.flatMap((c) => c.beats.map((b) => ({ ...b, chapter: c.chapter })));
const crash = (t) => allBeats(t).find((b) => b.beat.startsWith('The cliff'));
const sf = sourceFamily();
const LENGTHS = [3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20];
const oldOf = (outline, m) => {
  const p = previousTelling(outline, m);
  return { minutes: p.lengths.reduce((a, b) => a + b, 0), chapters: p.picked.length, p };
};

test('no telling runs over the length asked for', () => {
  for (const { id, outline } of readPlans()) for (const m of LENGTHS) assert.ok(told(outline, m).total <= m, `${id} at ${m}`);
});
test('no telling uses more minutes or more chapters than the previous engine did', () => {
  for (const { id, outline } of readPlans()) for (const m of LENGTHS) {
    const t = told(outline, m), o = oldOf(outline, m);
    assert.ok(t.total <= o.minutes, `${id} at ${m}: ${t.total} minutes against ${o.minutes}`);
    assert.ok(t.told.length <= o.chapters, `${id} at ${m}: ${t.told.length} chapters against ${o.chapters}`);
  }
});
test('Source Family: the fatal flight is kept at 5, 10 and 15 minutes, as a signature moment', () => {
  for (const m of [5, 10, 15]) {
    const b = crash(told(sf, m));
    assert.ok(b, `${m} min lost the crash`);
    assert.equal(b.weight, 'signature');
    assert.equal(b.essential, true);
  }
});
test('Source Family: at 5 minutes the crash is told in full and the mansion becomes a summary', () => {
  const t = told(sf, 5);
  assert.equal(t.told.length, 2);
  const last = t.told[1];
  assert.ok(last.folded.includes(3) && last.bridges.includes(1));
  assert.ok(!allBeats(t).some((b) => b.beat.startsWith('$10,000')), 'a secondary moment may go entirely');
  assert.deepEqual(last.beats.filter((b) => b.from === 3).map((b) => b.weight), ['signature'], 'a folded chapter brings its moment and nothing more');
});
test('Source Family: at 10 minutes the second chapter is the one already written, and the archive gives way to the crash', () => {
  const t = told(sf, 10);
  assert.equal(t.told[1].chapter, 1);
  assert.equal(t.told[1].compressed, false);
  const beats = allBeats(t).map((b) => b.beat);
  assert.ok(!beats.some((b) => b.startsWith('Nine LPs')) && !beats.some((b) => b.startsWith('Family history book')));
  assert.ok(beats.some((b) => b.startsWith('Black Monday')));
});
test('the most important moment is kept at every length, in every stored plan', () => {
  for (const { id, outline } of readPlans()) {
    const ranked = outline.flatMap((c, i) => c.beats.map((b, k) => ({ i, k, r: essentialRank(outline, i, k), beat: b.beat }))).filter((x) => x.r !== null && x.i > 0).sort((a, b) => a.r - b.r || b.i - a.i);
    if (!ranked.length) continue;
    for (const m of [5, 10, 15]) assert.ok(allBeats(told(outline, m)).some((b) => b.beat === ranked[0].beat), `${id} at ${m}`);
  }
});
test('a folded chapter brings only its ranked moments, never its supporting material', () => {
  for (const { id, outline } of readPlans()) for (const m of LENGTHS) for (const c of told(outline, m).told) for (const b of c.beats) {
    if (b.from !== undefined) assert.equal(b.essential, true, `${id} at ${m}: "${b.beat}" folded in without being essential`);
  }
});
test('the opening always plays in full, at one minute, with all its beats', () => {
  for (const { outline } of readPlans()) for (const m of [4, 5, 10]) {
    const first = told(outline, m).told[0];
    assert.equal(first.chapter, 0);
    assert.equal(first.minutes, minutesOf(outline, 0));
    assert.equal(first.beats.length, outline[0].beats.length);
  }
});
test('the last chapter always plays and ends on its payoff', () => {
  for (const { id, outline } of readPlans()) for (const m of LENGTHS) {
    const t = told(outline, m).told;
    const last = t[t.length - 1];
    assert.equal(last.chapter, outline.length - 1, id);
    assert.equal(last.beats[last.beats.length - 1].beat, outline[outline.length - 1].beats.at(-1).beat, `${id} at ${m}`);
  }
});
test('the story stays in order, no beat is told twice, and at most one left-out chapter is bridged, the closest cause', () => {
  for (const { id, outline } of readPlans()) for (const m of LENGTHS) {
    const t = told(outline, m);
    const chapters = t.told.map((c) => c.chapter);
    assert.deepEqual(chapters, [...chapters].sort((a, b) => a - b), `${id} ${m}: chapters out of order`);
    const seen = allBeats(t).map((b) => b.beat);
    assert.equal(new Set(seen).size, seen.length, `${id} ${m}: a beat told twice`);
    const covered = new Set([...chapters, ...t.told.flatMap((x) => [...x.folded, ...x.bridges])]);
    for (const c of t.told) {
      const order = c.beats.map((b) => b.from ?? c.chapter);
      assert.deepEqual(order, [...order].sort((a, b) => a - b), `${id} ${m}: folded beats after the chapter's own`);
    }
    // A short telling spends its time on what it plays. One bridging sentence at most, for the latest
    // left-out chapter that a played one depends on, since that is the closest cause of what is told.
    const bridges = t.told.flatMap((x) => x.bridges);
    assert.ok(bridges.length <= 1, `${id} ${m}: ${bridges.length} bridges`);
    const missing = [...new Set(t.told.flatMap((c) => [c.chapter, ...c.folded].flatMap((x) => dependencies(outline, x))))].filter((j) => !chapters.includes(j) && !t.told.some((x) => x.folded.includes(j)));
    if (missing.length) assert.deepEqual(bridges, [Math.max(...missing)], `${id} ${m}: the bridge is not the closest cause`);
  }
});
test('where the previous engine played the second chapter whole, so does the new one', () => {
  for (const { id, outline } of readPlans()) for (const m of LENGTHS) {
    const p = previousTelling(outline, m);
    const was = p.picked[1] === 1 && p.bridges[1].length === 0 && p.lengths[1] === minutesOf(outline, 1) && (p.picked[2] === 2 || outline.length === 2);
    if (!was || p.picked.length === outline.length) continue;
    const t = told(outline, m).told;
    assert.equal(t[1].chapter, 1, `${id} ${m}`);
    assert.equal(t[1].minutes, minutesOf(outline, 1), `${id} ${m}`);
    assert.equal(t[1].beats.length, outline[1].beats.length, `${id} ${m}`);
    assert.ok(t[2] && (t[2].chapter === 2 || outline.length === 2), `${id} ${m}: the third chapter changed`);
  }
});
test('asking for more than the story has plays it whole and adds nothing', () => {
  for (const { outline } of readPlans()) {
    const t = told(outline, 60);
    assert.equal(t.total, fullMinutes(outline));
    assert.ok(t.told.every((c) => !c.compressed && c.folded.length === 0 && c.bridges.length === 0));
  }
});
test('a chapter runs at most four minutes, or five when it carries folded moments', () => {
  for (const { id, outline } of readPlans()) for (const m of LENGTHS) for (const c of told(outline, m).told) {
    assert.ok(c.minutes <= (c.folded.length ? FOLDED_LONGEST : 4), `${id} ${m}: chapter ${c.chapter + 1} runs ${c.minutes}`);
  }
});
test('a plan that numbers its essential moments is taken at its word', () => {
  const ranked = sourceFamily();
  ranked.forEach((c) => c.beats.forEach((b) => (b.essential = false)));
  ranked[3].beats[3].essential = 1; // the crash
  ranked[1].beats[0].essential = 2; // the $10,000 a day
  assert.equal(essentialRank(ranked, 2, 1), null);
  const beats = allBeats(told(ranked, 5)).map((b) => b.beat);
  assert.ok(beats.some((b) => b.startsWith('The cliff')));
  assert.ok(!beats.some((b) => b.startsWith('Fourteen women')), 'an unranked moment gives way');
});
test('plans without beats are still chosen chapter by chapter', () => {
  assert.equal(hasBeats(story), false);
  assert.deepEqual(names(10), ['Opening', 'Setup', 'Turn', 'Payoff']);
});
test('on average, no more chapters and no more minutes than before, at 5, 10 and 15 minutes', () => {
  const plans = readPlans();
  for (const m of [5, 10, 15]) {
    let ch0 = 0, ch1 = 0, mi0 = 0, mi1 = 0;
    for (const { outline } of plans) {
      const o = oldOf(outline, m), t = told(outline, m);
      ch0 += o.chapters; ch1 += t.told.length; mi0 += o.minutes; mi1 += t.total;
    }
    assert.ok(ch1 <= ch0 && mi1 <= mi0, `${m}: chapters ${ch0}->${ch1}, minutes ${mi0}->${mi1}`);
  }
});

// ---------- Revisions ----------
test('a shorter revision is kept: cutting is not a reason to refuse it', () => {
  assert.equal(keepRevision({ draftWords: 450, revisedWords: 330, overLong: false }), true);
  assert.equal(keepRevision({ draftWords: 450, revisedWords: 420, overLong: false }), true);
});
test('a revision that lost most of the chapter is a broken reply, unless the draft was far too long', () => {
  assert.equal(keepRevision({ draftWords: 450, revisedWords: 150, overLong: false }), false);
  assert.equal(keepRevision({ draftWords: 900, revisedWords: 400, overLong: true }), true);
  assert.equal(keepRevision({ draftWords: 450, revisedWords: 0, overLong: true }), false);
});
test('a fact correction is kept unless it lost most of the chapter', () => {
  assert.equal(keepCorrection({ revisedWords: 400, correctedWords: 300 }), true);
  assert.equal(keepCorrection({ revisedWords: 400, correctedWords: 190 }), false);
});

// ---------- The premise ----------
const premise = { central_curiosity: 'How did a Hollywood restaurant sustain a spiritual family, and what remained after its founder was gone?', promise: 'Follow the family through its music and the records members kept.', final_payoff: 'What survives is an archive.', mode: 'focused', engine: 2 };
test('the Story Editor can revise the central question, promise, payoff and mode', () => {
  const { story: next, before } = revisePremise(premise, { central_curiosity: 'How did a restaurant-funded commune and its guru hold together, and what happened to its people when he died?', promise: 'The rise and fall of a Hollywood commune and the man at its centre.', mode: 'focused' });
  assert.match(next.central_curiosity, /when he died/);
  assert.match(next.promise, /rise and fall/);
  assert.equal(next.final_payoff, premise.final_payoff);
  assert.equal(next.engine, 2);
  assert.deepEqual(Object.keys(before).sort(), ['central_curiosity', 'promise']);
});
test('a premise revision is checked field by field, and nothing changes without one', () => {
  assert.equal(revisePremise(premise, undefined).before, null);
  assert.equal(revisePremise(premise, { central_curiosity: 'Why?', mode: 'thrilling', promise: 42 }).before, null);
  assert.equal(revisePremise(premise, { mode: 'broad' }).story.mode, 'broad');
});

// ---------- Reading speed ----------
const samples = (wpm, n) => Array.from({ length: n }, (_, i) => ({ words: Math.round(((wpm + (i % 5) - 2) * 120) / 60), seconds: 120 }));
test('reading speed is the median of recent recordings once there are enough', () => {
  assert.equal(readingRate('ella', samples(158, 21)), 158);
  assert.equal(readingRate('cedar', [...samples(176, 30), { words: 900, seconds: 60 }, { words: 800, seconds: 60 }]), 176);
});
test('with too few recordings, the measured figure for the voice is used, and 150 for an unknown one', () => {
  assert.equal(readingRate('ella', samples(140, 5)), 158);
  assert.equal(readingRate('someone-new', []), 150);
});
test('reading speed ignores recordings under 45 seconds and stays between 120 and 200', () => {
  assert.equal(readingRate('marin', [...samples(250, 20)]), 200);
  assert.equal(readingRate('cedar', samples(160, 30).map((x) => ({ ...x, seconds: 30 }))), 176);
});
test('word ranges follow the reading speed: three minutes of Ella is 427 to 545 words', () => {
  const rate = readingRate('ella', samples(158, 21));
  assert.deepEqual([Math.round(3 * rate * 0.9), Math.round(3 * rate * 1.15)], [427, 545]);
});

test('a chapter folded into an earlier one is never summarized again later', () => {
  for (const { outline } of readPlans()) for (const m of [5, 10, 15]) {
    const told = tellStory(outline, m).told;
    const folded = told.flatMap((t) => t.folded);
    assert.ok(!told.some((t) => t.bridges.some((j) => folded.includes(j))));
  }
});
test('older plans tell every signature beat of the last chapter at 10 minutes, within the same budget', () => {
  for (const { outline } of readPlans()) {
    const last = outline.length - 1;
    const end = tellStory(outline, 10).told.find((t) => t.chapter === last);
    outline[last].beats.forEach((b) => b.weight === 'signature' && assert.ok(end.beats.some((x) => x.beat === b.beat && x.from === undefined)));
  }
});

test('one subject under two titles is caught, different subjects are not', () => {
  for (const [a, b] of [['Cadaver Synod', 'Cadaver Synod'], ['Great Stalacpipe Organ', 'The Great Stalacpipe Organ in Luray Caverns'], ['Ophiocordyceps unilateralis', 'Ophiocordyceps unilateralis, the zombie ant fungus'], ['Hammersmith Ghost murder', 'Hammersmith ghost murder case'], ['Defenestration of Prague', 'Defenestrations of Prague'], ['Pigeon photography', 'Julius Neubronner and pigeon photography'], ['Animal trial', 'Animal trial'], ['Gävle goat', 'Gavle goat']])
    assert.ok(sameSubject(a, b), `${a} / ${b}`);
  for (const [a, b] of [['Pope Joan', 'Pope Sylvester II'], ['Yule', 'Yule log'], ['Muon', 'Muon-catalyzed fusion'], ['Charles VI of France', 'Charles VIII of France'], ['Witch of Endor', 'Witch of Edmonton'], ['Salem witch trials', 'North Berwick witch trials'], ['Yule Lads', 'Yule Cat'], ['', '']])
    assert.ok(!sameSubject(a, b), `${a} / ${b}`);
});

// ---------- The Nov 27 storytelling corrections ----------

test('a note that is only about a gap in our research is recognized', () => {
  for (const gap of [
    "The supplied Human Library extract does not report a study measuring the organization's own effect on participants' prejudice.",
    'The extract does not establish how often eating casu martzu causes illness.',
    'The extract does not explain the legal terms under which the Moulin Rouge managers sued Pujol.',
    'The extract does not state how the Soviet adaptation experiments turned out.',
    'The extracts do not say why the authorities prohibited xenotransfusion.',
    'The article gives no date for the second trial.',
  ]) assert.equal(isResearchGap({ fact: gap }), true, gap);
});
test('facts, hedged facts, open questions and conflicting sources are kept', () => {
  for (const kept of [
    'The boy recovered after the procedure; the extract does not establish that the transfusion caused his recovery.',
    'One theory holds that Gruithuisen’s paper inspired Locke’s articles, but the extract does not establish that connection as certain.',
    'The extract says the period descriptions could fit a striped hyena, a large wolf, a large dog or a wolfdog, and that the animal’s identity remains unsolved.',
    'The spirit was later said to be a murdered peddler, but no record of such a person was ever found.',
    'The two supplied articles give different totals for the 1990 Nike shoe spill: 61,000 in one and some 80,000 in the other.',
    'The article states that Ponzi schemes were not yet illegal when Spitzeder was convicted.',
    'According to the extract, the largest meta-analysis of the contact literature found Allport\'s conditions helpful but not essential.',
    'Historians do not know who wrote the letter.',
    'Snow found a cholera rate fourteen times higher in homes supplied by the Southwark and Vauxhall Waterworks Company.',
  ]) assert.equal(isResearchGap({ fact: kept }), false, kept);
});
test('the next chapter is told what earlier chapters covered, beat by beat, compactly', () => {
  const said = toldBefore([FIVE.octopus[0], FIVE.octopus[1]]);
  assert.ok(said.includes('Chapter 1, carries shells: carries shells'));
  assert.ok(said.includes('Chapter 2, walks on two arms: carrying bulky things'));
  assert.ok(said.includes('with a number added'));
  assert.equal(toldBefore([]), '');
  const long = toldBefore([{ title: 'x', beats: [{ beat: 'word '.repeat(80), weight: 'signature', fact_ids: [] }] }]);
  assert.ok(long.split('\n').at(-1).length < 200, 'a long beat is clipped');
  // Older chapters without beats fall back to their discovery.
  assert.ok(toldBefore([{ title: 'Old', discovery: 'The ship sank on its first voyage.' }]).includes('The ship sank'));
});
test('a short telling bridges at most one left-out chapter and develops the climax', () => {
  const t = tellStory(FIVE.banker, 5);
  assert.equal(t.total, 5);
  assert.ok(t.told.flatMap((c) => c.bridges).length <= 1);
  const beats = t.told.flatMap((c) => c.beats.map((b) => b.beat));
  for (const b of ['collapse', 'Ehinger escape and sentence', 'withdrawals limited', '32,000 lose 38 million']) assert.ok(beats.includes(b), b);
});
test('a story whose notes carry three or four minutes can be an opening and one short chapter', () => {
  const thin = [FIVE.library[0], { ...FIVE.library[1], minutes: 2 }];
  assert.equal(fullMinutes(thin), 3);
  const t = tellStory(thin, 10);
  assert.equal(t.total, 3, 'never padded up to the length asked for');
  assert.deepEqual(t.told.map((c) => c.chapter), [0, 1]);
});
test('the two strong stories tell the same beats as before at 5 and 10 minutes', () => {
  const beatsAt = (o, m) => tellStory(o, m).told.map((c) => [c.chapter, c.minutes, c.beats.map((b) => b.beat)]);
  assert.deepEqual(beatsAt(FIVE.fish, 5), [[0, 1, ['colorless blood', 'icefish family', 'ambush predator']], [3, 3, ['four times the blood', 'inhibited myoglobin', 'iron']]]);
  assert.equal(tellStory(FIVE.fish, 10).total, 9);
  assert.deepEqual(beatsAt(FIVE.cult, 5)[1][2], ['Matsumoto release', 'Kariya note and kidnapping', 'raids uncover', 'Kono apology']);
  assert.deepEqual(tellStory(FIVE.cult, 5).told.flatMap((c) => c.bridges), [2]);
});

test('a short telling offers spare-time beats next to what it tells, never background lines', () => {
  const t = tellStory(FIVE.banker, 5);
  const last = t.told.at(-1);
  assert.deepEqual(last.reserve.map((b) => b.beat), ['backstory: Emilie, six dogs, stipend']);
  for (const story of Object.values(FIVE)) for (const m of [3, 4, 5, 6, 8, 10]) {
    const tt = tellStory(story, m);
    const told = new Set(tt.told.flatMap((c) => c.beats.map((b) => b.beat)));
    const spare = tt.told.flatMap((c) => c.reserve.map((b) => b.beat));
    assert.ok(tt.told.every((c) => c.reserve.length <= 2));
    assert.ok(spare.every((b) => !told.has(b)), 'a spare beat is never one already told');
    assert.equal(new Set(spare).size, spare.length, 'offered once');
    assert.ok(tt.told.flatMap((c) => c.reserve).every((b) => b.weight !== 'connective'));
    assert.ok(tt.told.every((c) => c.compressed || c.reserve.length === 0), 'a whole chapter has nothing spare');
  }
  assert.ok(tellStory(FIVE.fish, 10).told.every((c) => c.reserve.length === 0), 'the whole story needs no spare time');
});
test('neighboring one-minute chapters are joined, and nothing else is', () => {
  const S1 = (beat, essential) => ({ beat, weight: 'signature', fact_ids: [], essential });
  const ch = (title, minutes, needs, beats) => ({ title, brief: '', fact_ids: [], minutes, needs, beats, ending: 'revelation', ending_note: title });
  // The octopus as the new planner wrote it: four one-minute chapters.
  const octo = [ch('A coconut on the move', 1, [], [S1('carry', 1)]), ch('Walking on two arms', 1, [1], [S1('walk', 3)]), ch('A tool, or protection already?', 1, [1], [S1('tool', false)]), ch('The eggs inside the shell', 1, [1, 3], [S1('eggs', 2)])];
  const m = mergeShortChapters(octo);
  assert.deepEqual(m.map((c) => [c.title, c.minutes]), [['A coconut on the move', 1], ['Walking on two arms', 2], ['The eggs inside the shell', 1]]);
  assert.deepEqual(m[1].beats.map((b) => b.beat), ['walk', 'tool'], 'both halves, in order');
  assert.equal(m[1].ending_note, 'A tool, or protection already?', 'ends the way the second half ended');
  assert.deepEqual(m[2].needs, [1, 2], 'a need on the joined half points at the joined chapter');
  // The higher-ranked half names the chapter.
  const swapped = mergeShortChapters([octo[0], ch('Setup', 1, [1], [S1('setup', false)]), ch('The big one', 1, [1], [S1('big', 1)]), ch('End', 3, [], [S1('end', 2)])]);
  assert.equal(swapped[1].title, 'The big one');
  // Stored plans have no one-minute chapters, so nothing changes for them.
  for (const story of Object.values(FIVE)) assert.deepEqual(mergeShortChapters(story).map((c) => c.minutes), story.map((c) => c.minutes));
  for (const { outline } of readPlans()) assert.equal(mergeShortChapters(outline).length, outline.length);
  // A short chapter beside a full one stays where the plan put it.
  assert.equal(mergeShortChapters([octo[0], ch('a', 1, [], [S1('a', 1)]), ch('b', 3, [], [S1('b', 2)])]).length, 3);
});

console.log(`${passed} tests passed`);
