// Shared by Explore and the proposer: whether two topics are the same subject. A copy of the helper in lesson/plan.ts.

const SUBJECT_STOPWORDS = new Set(["the", "a", "an", "of", "and", "in", "on", "at", "to", "for", "by", "with", "from", "s"]);
/** The words that name a subject, plain and singular, so "Defenestrations of Prague" matches "Defenestration of Prague". */
export function subjectWords(subject: unknown): Set<string> {
  const plain = String(subject ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ");
  return new Set(plain.split(" ").filter((w) => w && !SUBJECT_STOPWORDS.has(w)).map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)));
}
/**
 * True when two subjects are the same story under different wording: the same words, or every word of
 * a two-word-or-longer subject inside the other ("Great Stalacpipe Organ" and "the Great Stalacpipe Organ in
 * Luray Caverns"). Compares what a story is about, not its headline, so "Animal trial" catches both the
 * rats and the pig. Single words must match exactly, so "Yule" does not swallow "Yule log".
 */
export function sameSubject(a: unknown, b: unknown): boolean {
  const x = subjectWords(a), y = subjectWords(b);
  if (x.size === 0 || y.size === 0) return false;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  if (![...small].every((w) => big.has(w))) return false;
  return small.size >= 2 || small.size === big.size;
}
