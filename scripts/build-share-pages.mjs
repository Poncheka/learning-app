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
// The story's words, written into the page so search engines and readers find them without a click.
// A native <details> folds it away; no script is needed to open it.
const CHEVRON = '<svg class="chev" width="14" height="9" viewBox="0 0 18 12" aria-hidden="true"><path d="M2 2l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const transcriptHtml = (t) => {
  if (!t || !Array.isArray(t.chapters) || t.chapters.length === 0) return '';
  const chapters = t.chapters
    .map((c) => `<h2 class="serif">${escape(c.title)}</h2>\n${c.paragraphs.map((p) => `<p>${escape(p)}</p>`).join('\n')}`)
    .join('\n');
  const sources = (t.sources ?? []).length
    ? `<div class="credits"><p class="eyebrow">Sources</p><ul>${t.sources.map((s) => `<li><a href="${escape(s.url)}" rel="noopener" target="_blank">Wikipedia: ${escape(s.title)}</a></li>`).join('')}</ul>` +
      '<p class="note">Researched from the Wikipedia articles above, whose text is available under <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="noopener" target="_blank">CC BY-SA 4.0</a>. Written and narrated with AI. Facts checked against these sources.</p></div>'
    : '';
  return `<details class="transcript" id="transcript"><summary><span>See transcript</span>${CHEVRON}</summary><div class="transcript-body">\n${chapters}\n${sources}</div></details>`;
};
const page = ({ title, description, url, image, art = '', transcript = null }) =>
  template
    .replaceAll('{{TITLE}}', escape(title))
    .replaceAll('{{DESCRIPTION}}', escape(description))
    .replaceAll('{{URL}}', escape(url))
    .replaceAll('{{IMAGE}}', escape(image))
    .replaceAll('{{ART}}', escape(art))
    .replaceAll('{{BODYCLASS}}', transcript ? 'has-transcript' : '')
    .replaceAll('{{TRANSCRIPT}}', transcriptHtml(transcript));

// Any address under /s/ that has no page yet, such as a story shared a minute ago, falls back to
// GitHub's 404 page, which is this same page without a preview. It plays the story all the same.
writeFileSync(join(out, '404.html'), page({ title: 'A story', description: 'Pliny generates custom lessons based on your interests.', url: ORIGIN, image: `${ORIGIN}/s/og/0.png` }));

const res = await fetch(`${API}?stories=1`);
if (!res.ok) throw new Error(`The story list could not be read: ${res.status}`);
const { stories } = await res.json();
for (const s of stories) {
  if (!/^[a-z0-9-]{1,90}$/.test(s.slug)) continue;
  mkdirSync(join(out, 's', s.slug), { recursive: true });
  writeFileSync(
    join(out, 's', s.slug, 'index.html'),
    page({ title: s.title, description: s.hook || 'A true story from Pliny.', url: `${ORIGIN}/s/${s.slug}`, image: `${ORIGIN}/s/og/${s.art}.png`, art: String(s.art), transcript: s.transcript }),
  );
}
console.log(`Wrote ${stories.length} story pages, ${stories.filter((s) => s.transcript).length} with a transcript.`);
