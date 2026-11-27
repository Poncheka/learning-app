# Explore headline experiment: Wikipedia lists against AI discovery (Nov 27, 2026)

Blind test of where Explore ideas come from. 100 headlines, rated 1 to 5 by Jeff without knowing the source.

| Group | Headlines | How the subject was found |
| --- | --- | --- |
| AI discovery | 50 | The v2 idea writer chose each subject itself, one per interest line, as in production |
| Wikipedia "Did you know" archive | 25 | The same writer chose 1 of up to 8 hooks from Nov 2025 to Oct 2026 per interest line |
| Wikipedia "Unusual articles" | 25 | The same writer chose 1 of up to 8 listed articles per interest line |

All three groups used the same model (gpt-6.1-terra), the same v2 instructions (`supabase/functions/shelf/ideas.ts`), the same input lines (Jeff's interests, loves, turn-downs and the last 300 subjects offered), and the same rules for keeping an idea (no subject already made, no repeat, card of 56 characters or less). Interest lines were balanced: each of Jeff's 7 interests got 3 lines per Wikipedia group and 6 or 7 in the AI group, plus "Off the map".

Wikipedia candidates were matched to an interest by keywords in the article title and summary, and filled at random where too few matched. That matching is rough, so the Wikipedia groups had weaker material for narrow interests like particle physics. The writer saw each candidate's one-line summary.

Files:
- `pliny_headlines_blind.csv`: ID, Headline, Rating, Notes. For rating.
- `pliny_headlines_answer_key.csv`: source, Wikipedia subject and link, interest line and method for each ID.
- `candidates.json`: the Wikipedia articles offered on each line.
- `results.json`: every kept headline and each call's token use.
- `run.py`: the runner. The calls went through a one-off `idea-lab` edge function that holds the OpenAI key and caps the experiment at $4.

Cost, from the token counts in the cost log (step `experiment`), priced at the estimated $0.75 per million input and $6 per million output tokens:

| Group | Calls | Input tokens | Output tokens (reasoning) | Est. cost |
| --- | --- | --- | --- | --- |
| AI discovery | 10 | 69,739 | 10,801 (9,145) | $0.117 |
| Did you know | 5 | 36,882 | 4,327 (3,608) | $0.054 |
| Unusual articles | 5 | 38,438 | 3,829 (3,103) | $0.052 |
| Total | 20 | 145,059 | 18,957 | $0.222 |

Wikipedia text is CC BY-SA 4.0. The summaries in the answer key come from Wikipedia's lists and hooks.
