#!/usr/bin/env node
// Milestone 1: type a topic and minutes, get a spoken lesson, hear it.
//
//   node scripts/prove-loop.mjs "Kathmandu, 1800 to 1900" 3
//
// The writing and the voice happen in the prove-loop edge function, which is where the
// OpenAI key lives. This script only asks for a lesson, saves it in lessons/ and plays it.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const [topic, minutesArg] = process.argv.slice(2);
const dryRun = topic === '--check';
const minutes = Number(minutesArg ?? 3);
if (!topic || (!dryRun && !Number.isFinite(minutes))) {
  console.error('Usage: node scripts/prove-loop.mjs "a topic" 3');
  process.exit(1);
}

if (!dryRun) console.log(`Writing and voicing about ${minutes} minutes on "${topic}". This can take a minute or two.`);
const started = Date.now();

const res = await fetch(`${url}/functions/v1/prove-loop`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: key },
  body: JSON.stringify(dryRun ? { dryRun: true } : { topic, minutes }),
});
const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  data = { error: text.slice(0, 500) };
}
if (!res.ok) {
  console.error(`Failed (${res.status}): ${data.error ?? 'unknown error'}`);
  if (data.detail) console.error(data.detail);
  process.exit(1);
}
if (dryRun) {
  console.log(data);
  process.exit(0);
}

const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'lesson';
const outDir = join(root, 'lessons');
mkdirSync(outDir, { recursive: true });
const mp3Path = join(outDir, `${slug}.mp3`);
writeFileSync(mp3Path, Buffer.from(data.audio_base64, 'base64'));
writeFileSync(join(outDir, `${slug}.txt`), `${data.title}\n\n${data.script}\n`);

const seconds = Math.round((Date.now() - started) / 1000);
console.log(`\n"${data.title}"`);
console.log(`${data.words} words, ready in ${seconds} seconds.`);
console.log(`Saved to lessons/${slug}.mp3 (the script is next to it as a .txt).`);

if (process.platform === 'darwin') {
  console.log('Playing now. Press Control+C to stop.');
  spawnSync('afplay', [mp3Path], { stdio: 'inherit' });
}
