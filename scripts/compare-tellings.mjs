// Compares what a short telling plays, before and after the Nov 27 correction, for five real stories.
// Free, and calls nothing. Run from the learning-app folder:   node scripts/compare-tellings.mjs
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { FIVE } from './fixtures/five-stories.mjs';

const load = async (source, name) => {
  const file = join(mkdtempSync(join(tmpdir(), 'cmp-')), `${name}.mjs`);
  writeFileSync(file, ts.transpileModule(source, { compilerOptions: { module: 'esnext', target: 'es2022' } }).outputText);
  return import(pathToFileURL(file));
};
const before = await load(execSync(`git show ${process.argv[2] ?? 'HEAD'}:supabase/functions/lesson/plan.ts`).toString(), 'before');
const after = await load(readFileSync(new URL('../supabase/functions/lesson/plan.ts', import.meta.url), 'utf8'), 'after');

const show = (outline, t) =>
  t.told
    .map((c) => `ch${c.chapter + 1} ${c.minutes}m [${c.beats.map((b) => (b.from !== undefined ? `<${b.beat}>` : b.beat)).join(' | ')}]${c.bridges.length ? ` bridge: ${c.bridges.map((j) => `ch${j + 1}`).join(',')}` : ''}${c.reserve?.length ? ` spare: ${c.reserve.map((b) => b.beat).join(' | ')}` : ''}`)
    .join('\n      ');
for (const [name, outline] of Object.entries(FIVE)) {
  console.log(`\n${name}: natural length ${before.fullMinutes(outline)} min`);
  for (const m of [5, 10]) {
    const a = before.tellStory(outline, m), b = after.tellStory(outline, m);
    console.log(`  ${m} min before (${a.total}m, ${a.told.flatMap((c) => c.bridges).length} bridges):\n      ${show(outline, a)}`);
    console.log(`  ${m} min after  (${b.total}m, ${b.told.flatMap((c) => c.bridges).length} bridges):\n      ${show(outline, b)}`);
  }
}
