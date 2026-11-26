// Writes a page for every shared story into the website before it is published, so a link to a
// story shows its title and artwork in a text thread. Run by .github/workflows/site.yml.
//   node scripts/build-share-pages.mjs <site folder>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] || '_site';
const API = 'https://ctssexvgotcdbuvlkrou.supabase.co/functions/v1/site';
const ORIGIN = 'https://itspliny.com';
const template = readFileSync(join(out, 's', 'template.html'), 'utf8');

const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const page = ({ title, description, url, image }) =>
  template
    .replaceAll('{{TITLE}}', escape(title))
    .replaceAll('{{DESCRIPTION}}', escape(description))
    .replaceAll('{{URL}}', escape(url))
    .replaceAll('{{IMAGE}}', escape(image));

// Any address under /s/ that has no page yet, such as a story shared a minute ago, falls back to
// GitHub's 404 page, which is this same page without a preview. It plays the story all the same.
writeFileSync(join(out, '404.html'), page({ title: 'A story', description: 'True, strange stories about what you are into, sized to the time you have.', url: ORIGIN, image: `${ORIGIN}/s/og/0.png` }));

const res = await fetch(`${API}?stories=1`);
if (!res.ok) throw new Error(`The story list could not be read: ${res.status}`);
const { stories } = await res.json();
for (const s of stories) {
  if (!/^[a-z0-9-]{1,90}$/.test(s.slug)) continue;
  mkdirSync(join(out, 's', s.slug), { recursive: true });
  writeFileSync(
    join(out, 's', s.slug, 'index.html'),
    page({ title: s.title, description: s.hook || 'A true story from Pliny.', url: `${ORIGIN}/s/${s.slug}`, image: `${ORIGIN}/s/og/${s.art}.png` }),
  );
}
console.log(`Wrote ${stories.length} story pages.`);
