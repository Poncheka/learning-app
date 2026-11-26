// Shows what each telling length plays, under the old chapter-by-chapter choice and the new
// beat-by-beat one, for the Source Family plan and for every stored plan. Free: calls nothing.
// Run from the learning-app folder:   node scripts/telling-report.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const source = readFileSync(new URL('../supabase/functions/lesson/plan.ts', import.meta.url), 'utf8');
const built = join(mkdtempSync(join(tmpdir(), 'plan-')), 'plan.mjs');
writeFileSync(built, ts.transpileModule(source, { compilerOptions: { module: 'esnext', target: 'es2022' } }).outputText);
export const plan = await import(pathToFileURL(built));

// The stored plans, one a line: "id=minutes,priority,needs,beats;..." with S signature, s supporting, c connective.
export function readPlans() {
  return readFileSync(new URL('./fixtures/stored-plans.txt', import.meta.url), 'utf8').trim().split('\n').map((line) => {
    const [id, rest] = line.split('=');
    const outline = rest.split(';').map((c, i) => {
      const [minutes, priority, needs, beats] = c.split(',');
      return {
        title: `ch${i + 1}`, brief: '', fact_ids: [], minutes: Number(minutes), priority: Number(priority),
        needs: needs ? needs.split('.').map(Number) : [],
        beats: [...beats].map((w, k) => ({ beat: `${i + 1}.${k + 1}`, weight: w === 'S' ? 'signature' : w === 'c' ? 'connective' : 'supporting', fact_ids: [] })),
      };
    });
    return { id, outline };
  });
}

export const SOURCE_FAMILY_TITLES = ['The guru on kettle drum', 'A mansion on restaurant money', 'Fourteen women and one legal wife', 'The first and last flight', 'What Isis kept'];
export const SOURCE_FAMILY_BEATS = [
  ['Yod on kettle drum, improvised records sold in the restaurant', 'The restaurant’s earnings supported the commune', 'The question'],
  ['$10,000 a day, celebrity customers, 150 people in a mansion', 'Founded 1969, two other restaurants', 'Judo, stuntman ambition', 'Nature Boys, Vedantic monk, Yogi Bhajan'],
  ['Ideals: health, communal living, free love, secret doctrines', 'Fourteen women, three reported children, one legal wife', 'Popper’s marriage, daughter, "dirty old man"', 'Isis as documentarian'],
  ['Band name, garage studio, small pressings', 'Musicians, Sky Saxon, Yod hoped the music would carry his teaching', 'Restaurant sold, hostile move to Hawaii', 'The cliff, no experience, the crash, died nine hours later'],
  ['Black Monday, vigil, ashes, band dissolved', 'Nine LPs, 65 lost, tapes found', 'Family history book, reunion after 33 years', 'Isis’s archive supplied the 2012 documentary'],
];
export function sourceFamily() {
  const p = readPlans().find((x) => x.id === 'a2bba87d').outline;
  p.forEach((c, i) => {
    c.title = SOURCE_FAMILY_TITLES[i];
    c.beats.forEach((b, k) => (b.beat = SOURCE_FAMILY_BEATS[i][k]));
  });
  return p;
}

// Rough cost of one telling, from the last week's ledger: each chapter written while listening costs about
// $0.019 in model calls (draft, check, and the revision most chapters get), and Ella's voice about
// $0.036 for each planned minute (about 900 characters at $0.04 per thousand). The opening is written
// when a story is prepared, for every length alike, so it is left out of both sides.
const PER_CHAPTER = 0.019;
const PER_MINUTE = 0.036;
const costOf = (chapters, minutes) => ({ model: (chapters - 1) * PER_CHAPTER, voice: minutes * PER_MINUTE });

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sf = sourceFamily();
  const describe = (outline, m, label) => {
    const old = plan.previousTelling(outline, m);
    console.log(`\n=== ${label}, ${m} minutes`);
    console.log(`  before (${old.lengths.reduce((a, b) => a + b, 0)} min, ${old.picked.length} chapters): ${old.picked.map((i, k) => `${outline[i].title} (${old.lengths[k]})${old.bridges[k].length ? ` + summary of ${old.bridges[k].map((j) => outline[j].title).join(', ')}` : ''}`).join(' | ')}`);
    const now = plan.tellStory(outline, m);
    console.log(`  after (${now.total} min, ${now.told.length} chapters):`);
    for (const t of now.told) {
      console.log(`    ${outline[t.chapter].title}: ${t.minutes} min${t.compressed ? ', shortened' : ''}${t.folded.length ? `, carries ${t.folded.map((j) => outline[j].title).join(', ')}` : ''}${t.bridges.length ? `, summary of ${t.bridges.map((j) => outline[j].title).join(', ')}` : ''}`);
      for (const b of t.beats) console.log(`      - [${b.weight}${b.essential ? ', essential' : ''}${b.from !== undefined ? `, from "${outline[b.from].title}"` : ''}] ${b.beat}`);
    }
  };
  for (const m of [5, 10, 15]) describe(sf, m, 'Source Family');

  const plans = readPlans();
  console.log('\nlength | chapters before -> after | planned minutes before -> after | est. cost before -> after (model + voice) | over | climax kept before -> after | essential moments kept before -> after');
  for (const m of [5, 10, 15]) {
    let ch0 = 0, ch1 = 0, mi0 = 0, mi1 = 0, c0 = 0, c1 = 0, over = 0, top0 = 0, top1 = 0, es0 = 0, es1 = 0, esAll = 0, worse = 0;
    for (const { outline } of plans) {
      const o = plan.previousTelling(outline, m);
      const n = plan.tellStory(outline, m);
      const oMin = o.lengths.reduce((a, b) => a + b, 0);
      ch0 += o.picked.length; ch1 += n.told.length; mi0 += oMin; mi1 += n.total;
      const a = costOf(o.picked.length, oMin), b = costOf(n.told.length, n.total);
      c0 += a.model + a.voice; c1 += b.model + b.voice;
      if (n.total > m) over++;
      if (n.told.length > o.picked.length || n.total > oMin) worse++;
      const ranked = outline.flatMap((c, i) => (c.beats ?? []).map((_, k) => ({ i, k, r: plan.essentialRank(outline, i, k) }))).filter((x) => x.r !== null && x.i > 0).sort((x, y) => x.r - y.r || y.i - x.i);
      // The climax: the strongest ranked moment before the last chapter, which always plays anyway.
      const top = ranked.find((x) => x.i < outline.length - 1);
      esAll += ranked.length;
      const oldKept = new Set(o.picked);
      if (top && oldKept.has(top.i)) top0++;
      const newKept = new Set(n.told.flatMap((t) => t.beats.map((x) => x.beat)));
      if (top && newKept.has(outline[top.i].beats[top.k].beat)) top1++;
      es0 += ranked.filter((x) => oldKept.has(x.i)).length;
      es1 += ranked.filter((x) => newKept.has(outline[x.i].beats[x.k].beat)).length;
    }
    const N = plans.length;
    if (m === 5) console.log('5 min, climax newly kept in: ' + plans.filter(({ outline }) => {
      const ranked = outline.flatMap((c, i) => (c.beats ?? []).map((_, k) => ({ i, k, r: plan.essentialRank(outline, i, k) }))).filter((x) => x.r !== null && x.i > 0 && x.i < outline.length - 1).sort((x, y) => x.r - y.r || y.i - x.i);
      if (!ranked.length) return false;
      const o = plan.previousTelling(outline, 5);
      const n = new Set(plan.tellStory(outline, 5).told.flatMap((t) => t.beats.map((b) => b.beat)));
      return !o.picked.includes(ranked[0].i) && n.has(outline[ranked[0].i].beats[ranked[0].k].beat);
    }).map((x) => x.id).join(' '));
    console.log(`${m} min | ${(ch0 / N).toFixed(2)} -> ${(ch1 / N).toFixed(2)} | ${(mi0 / N).toFixed(2)} -> ${(mi1 / N).toFixed(2)} | $${(c0 / N).toFixed(3)} -> $${(c1 / N).toFixed(3)} | ${over} | ${top0}/${N} -> ${top1}/${N} | ${es0}/${esAll} -> ${es1}/${esAll} | tellings over the old budget: ${worse}`);
  }
}
