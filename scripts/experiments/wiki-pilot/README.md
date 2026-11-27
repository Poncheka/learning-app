# Wikipedia Unusual articles pilot (from Nov 2026)

Behind the `idea_wiki_pool` setting. With `ab`, half of Explore's idea batches carry up to 4 optional
candidates per interest line from Wikipedia's Unusual articles list, and half are the control. It stops
by itself after `idea_wiki_pilot_batches` (30) Wikipedia batches. No extra model calls: the candidates
ride along in the idea call that Explore makes anyway.

When the pilot has run, paste `report.sql` into the Supabase SQL editor (or ask Claude to run it) for:

1. `blind`: every pilot headline in random order, with an ID and empty Rating and Notes columns. Export as CSV and rate 1 to 5.
2. `key`: the same IDs with arm (wiki or control), origin (Wikipedia candidate or the writer's own idea) and batch. Do not open until rated.
3. `batches`: per arm, batches, ideas kept, candidates offered and taken, input and output tokens, and actual cost.
4. `funnel`: per arm and origin, ideas kept, seen in Explore, queued, dismissed, made into stories, and stories whose plan kept the headline.

Cost per kept, seen and queued idea come from 3 and 4. Calls saved through reuse are zero until ideas are shared between people (deferred).
