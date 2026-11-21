#!/usr/bin/env node
// A full lesson, grounded in Wikipedia, made chapter by chapter and played as it arrives.
//
//   node scripts/lesson.mjs "The secret lives of mushrooms" 8     prepare a topic, then play 8 minutes of it
//   node scripts/lesson.mjs --topics                              list topics already prepared (free)
//   node scripts/lesson.mjs --topic <id> 15                       start a prepared topic, the way a tap will
//   node scripts/lesson.mjs "Kathmandu, 1800 to 1900" --prepare-only
//
// This plays the part the phone app will play. Preparing a topic (reading, outlining,
// writing the opening) is the slow step, and in the app it happens ahead of time. Starting
// a prepared topic is the step that has to feel instant: the opening is voiced and sent
// while it is still being generated. Later chapters are asked for in order, staying two
// ahead of the one being heard. Everything is saved in lessons/, one folder per lesson.
//
// --no-play     make and save every chapter without playing any of it
// --speed 0.9   play back slower (or faster, above 1) on this Mac. The saved audio is unchanged.
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
const takeValue = (flag) => {
  const at = args.indexOf(flag);
  if (at === -1) return undefined;
  return args.splice(at, 2)[1];
};
const takeFlag = (flag) => {
  const at = args.indexOf(flag);
  if (at !== -1) args.splice(at, 1);
  return at !== -1;
};
const speed = Number(takeValue('--speed') ?? 1);
const topicId = takeValue('--topic');
const listOnly = takeFlag('--topics');
const prepareOnly = takeFlag('--prepare-only');
const play = !takeFlag('--no-play') && process.platform === 'darwin';
const typedTopic = topicId ? undefined : args[0];
const minutes = Number((topicId ? args[0] : args[1]) ?? 8);

if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
  console.error('--speed takes a number between 0.5 and 2, such as 0.9.');
  process.exit(1);
}
if (!listOnly && !topicId && !typedTopic) {
  console.error('Usage: node scripts/lesson.mjs "a topic" 8     (or --topics, or --topic <id> 8)');
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

const seconds = (since) => ((Date.now() - since) / 1000).toFixed(1);
const slugify = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

let player = null;
process.on('SIGINT', () => {
  if (player) player.kill();
  console.log('\nStopped. Chapters already made are saved, and nothing more will be generated.');
  process.exit(0);
});

try {
  if (listOnly) {
    const { topics } = await call({ action: 'topics' });
    if (topics.length === 0) console.log('No topics are prepared yet.');
    for (const t of topics) console.log(`${t.id}  ${t.title}  (up to ${t.max_minutes} min)\n    ${t.hook}`);
    process.exit(0);
  }

  let topic = { id: topicId };
  if (!topicId) {
    console.log(`Preparing "${typedTopic}": reading, taking notes, outlining, writing the opening.`);
    console.log('In the app this part happens ahead of time, before you ever see the topic.');
    const prepareStarted = Date.now();
    topic = await call({ action: 'prepare', topic: typedTopic });
    console.log(`\nPrepared in ${seconds(prepareStarted)} seconds: "${topic.title}"`);
    console.log(`  ${topic.hook}`);
    console.log(`  ${topic.fact_count} fact notes from: ${topic.sources.map((s) => s.title).join(', ')}`);
    console.log(`  Outline: ${topic.chapters.join(' / ')}`);
    console.log(`  Topic id: ${topic.id}  (good for up to ${topic.max_minutes} minutes)`);
    if (prepareOnly) process.exit(0);
  }

  // From here on is what happens when a topic is tapped.
  const tapped = Date.now();
  const lesson = await call({ action: 'start', topic_id: topic.id, minutes });
  const count = lesson.segments.length;
  console.log(`\n"${lesson.title}", ${lesson.chosen_minutes} minutes, ${count} chapters:`);
  for (const s of lesson.segments) console.log(`  ${s.position}. ${s.title}  (${s.target_minutes} min)`);

  const outDir = join(root, 'lessons', `${slugify(lesson.title) || 'lesson'}-${lesson.id.slice(0, 8)}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'lesson.json'), JSON.stringify(lesson, null, 2));
  const fileFor = (segment) => join(outDir, `${String(segment.position).padStart(2, '0')}-${slugify(segment.title) || 'chapter'}`);
  const saveScript = (segment) => {
    const sources = (segment.source_refs ?? []).map((s) => s.url ?? s.title).join('\n');
    writeFileSync(`${fileFor(segment)}.txt`, `${segment.title}\n\n${segment.script}\n\nSources:\n${sources}\n`);
  };

  // The opening is played while it is still being generated. On the phone, sound starts when
  // the first audio arrives. This Mac cannot play a file that is still arriving, so here the
  // moment is only timed, and playback waits for the whole opening.
  const openingAudio = (async () => {
    const res = await fetch(`${url}/functions/v1/lesson?lesson_id=${lesson.id}&position=1&apikey=${encodeURIComponent(key)}`);
    if (!res.ok) throw new Error(`The opening could not be voiced [${res.status}]: ${(await res.text()).slice(0, 300)}`);
    const reader = res.body.getReader();
    const pieces = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (pieces.length === 0) console.log(`  First sound would start ${seconds(tapped)} seconds after the tap.`);
      pieces.push(value);
    }
    const file = `${fileFor(lesson.segments[0])}.mp3`;
    writeFileSync(file, Buffer.concat(pieces));
    saveScript(lesson.segments[0]);
    console.log(`  [ready] chapter 1 of ${count}, fully voiced ${seconds(tapped)} seconds after the tap`);
    return file;
  })();

  // Later chapters have to be written in order, so each waits for the one before it to be
  // made. Chapter 2 can start at once, because the opening is already written.
  const made = new Map([[1, openingAudio]]);
  const ensure = (position) => {
    if (position > count || made.has(position)) return;
    const before = position === 2 ? Promise.resolve() : made.get(position - 1);
    made.set(
      position,
      before.then(async () => {
        const started = Date.now();
        const segment = await call({ action: 'segment', lesson_id: lesson.id, position });
        if (segment.status !== 'ready' || !segment.audio_url) throw new Error(`Chapter ${position} came back as "${segment.status}".`);
        const audio = await fetch(segment.audio_url);
        if (!audio.ok) throw new Error(`Chapter ${position} audio could not be downloaded [${audio.status}].`);
        writeFileSync(`${fileFor(segment)}.mp3`, Buffer.from(await audio.arrayBuffer()));
        saveScript(segment);
        console.log(`  [ready] chapter ${position} of ${count}, made in ${seconds(started)} seconds`);
        return `${fileFor(segment)}.mp3`;
      }),
    );
    made.get(position).catch(() => {});
  };

  for (let position = 1; position <= count; position++) {
    // Without playback there is no listener to stay ahead of, so just make them one by one.
    for (let ahead = 1; ahead <= (play ? AHEAD : 1); ahead++) ensure(position + ahead);
    const waitStarted = Date.now();
    const file = await made.get(position);
    if (!play) continue;
    const waited = Number(seconds(waitStarted));
    if (position > 1 && waited > 0.5) console.log(`  (a gap of ${waited} seconds before this chapter was ready)`);
    console.log(`\nNow playing ${position}. ${lesson.segments[position - 1].title}`);
    await new Promise((resolve) => {
      player = spawn('afplay', speed === 1 ? [file] : ['-r', String(speed), '-q', '1', file], { stdio: 'ignore' });
      player.on('exit', resolve);
      player.on('error', resolve);
    });
    player = null;
  }
  console.log(`\nDone. Saved in ${outDir.replace(`${root}/`, '')}`);
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
}
