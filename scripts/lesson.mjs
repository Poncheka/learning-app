#!/usr/bin/env node
// Milestone 2, part 1: a full lesson, grounded in Wikipedia, made chapter by chapter.
//
//   node scripts/lesson.mjs "The secret lives of mushrooms" 8
//   node scripts/lesson.mjs "Kathmandu, 1800 to 1900" 30 --no-play
//
// This plays the part the phone app will play later. It asks the lesson function for a
// plan, then asks for chapters in order, staying two ahead of the one being heard, and
// plays each as it arrives. Everything is saved in lessons/, one folder per lesson.
// --no-play makes and saves every chapter without playing any of it.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AHEAD = 2;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Read .env by hand so this needs no packages installed.
const envPath = join(root, '.env');
const env = {};
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}
const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? env.EXPO_PUBLIC_SUPABASE_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_KEY. They belong in the .env file next to package.json.');
  process.exit(1);
}

const args = process.argv.slice(2);
const play = !args.includes('--no-play') && process.platform === 'darwin';
const [topic, minutesArg] = args.filter((a) => !a.startsWith('--'));
const minutes = Number(minutesArg ?? 8);
if (!topic || !Number.isFinite(minutes)) {
  console.error('Usage: node scripts/lesson.mjs "a topic" 8');
  process.exit(1);
}

async function call(body) {
  const res = await fetch(`${url}/functions/v1/lesson`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text.slice(0, 500) };
  }
  if (!res.ok) throw new Error(`${data.error ?? 'unknown error'}${data.detail ? ` (${data.detail})` : ''} [${res.status}]`);
  return data;
}

const seconds = (since) => Math.round((Date.now() - since) / 1000);
const slugify = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

let player = null;
process.on('SIGINT', () => {
  if (player) player.kill();
  console.log('\nStopped. Chapters already made are saved, and nothing more will be generated.');
  process.exit(0);
});

try {
  console.log(`Reading up on "${topic}" and planning ${minutes} minutes...`);
  const planStarted = Date.now();
  const lesson = await call({ action: 'start', topic, minutes });
  const count = lesson.segments.length;

  console.log(`\n"${lesson.title}"  (planned in ${seconds(planStarted)} seconds, from ${lesson.fact_count} fact notes)`);
  for (const s of lesson.segments) console.log(`  ${s.position}. ${s.title}  (${s.target_minutes} min)`);
  console.log(`Sources: ${lesson.sources.map((s) => s.title).join(', ')}\n`);

  const outDir = join(root, 'lessons', `${slugify(lesson.title) || 'lesson'}-${lesson.id.slice(0, 8)}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'lesson.json'), JSON.stringify(lesson, null, 2));

  // Chapters have to be made in order, so each one waits for the one before it.
  const made = new Map();
  const ensure = (position) => {
    if (position > count || made.has(position)) return;
    const before = made.get(position - 1) ?? Promise.resolve();
    made.set(
      position,
      before.then(async () => {
        const started = Date.now();
        const segment = await call({ action: 'segment', lesson_id: lesson.id, position });
        if (segment.status !== 'ready' || !segment.audio_url) throw new Error(`Chapter ${position} came back as "${segment.status}".`);
        const audio = await fetch(segment.audio_url);
        if (!audio.ok) throw new Error(`Chapter ${position} audio could not be downloaded [${audio.status}].`);
        const name = `${String(position).padStart(2, '0')}-${slugify(segment.title) || 'chapter'}`;
        const file = join(outDir, `${name}.mp3`);
        writeFileSync(file, Buffer.from(await audio.arrayBuffer()));
        const sources = (segment.source_refs ?? []).map((s) => s.url ?? s.title).join('\n');
        writeFileSync(join(outDir, `${name}.txt`), `${segment.title}\n\n${segment.script}\n\nSources:\n${sources}\n`);
        console.log(`  [ready] chapter ${position} of ${count}, made in ${seconds(started)} seconds`);
        return file;
      }),
    );
  };

  const lessonStarted = Date.now();
  for (let position = 1; position <= count; position++) {
    // Without playback there is no listener to stay ahead of, so just make them one by one.
    for (let ahead = 0; ahead <= (play ? AHEAD : 0); ahead++) ensure(position + ahead);
    const file = await made.get(position);
    if (position === 1) console.log(`  First audio ready ${seconds(planStarted)} seconds after you asked.`);
    if (!play) continue;
    console.log(`\nNow playing ${position}. ${lesson.segments[position - 1].title}`);
    await new Promise((resolve) => {
      player = spawn('afplay', [file], { stdio: 'ignore' });
      player.on('exit', resolve);
      player.on('error', resolve);
    });
    player = null;
  }
  console.log(`\nDone in ${seconds(lessonStarted)} seconds. Saved in ${outDir.replace(`${root}/`, '')}`);
  if (play) console.log('Press Control+C any time during playback to stop a lesson early.');
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
}
