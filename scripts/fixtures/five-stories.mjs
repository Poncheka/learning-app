// The beat structure of five real stories, as stored on Nov 27, 2026: three that played flat and two
// that held up. Beat text is shortened to a label. Used by scripts/compare-tellings.mjs and the tests.
const S = (beat, essential) => ({ beat, weight: 'signature', fact_ids: [], ...(essential === undefined ? {} : { essential }) });
const s = (beat) => ({ beat, weight: 'supporting', fact_ids: [], essential: false });
const c = (beat) => ({ beat, weight: 'connective', fact_ids: [], essential: false });
const ch = (minutes, needs, beats, priority = 1) => ({ title: beats[0].beat, brief: '', fact_ids: [], minutes, priority, needs, beats });
// Older plans that do not number their moments carry no essential field at all.
const plain = (o) => o.map((x) => ({ ...x, beats: x.beats.map(({ essential, ...b }) => b) }));

export const FIVE = {
  banker: [
    ch(1, [], [S('nightgown', false), s('no securities')]),
    ch(3, [1], [S('first deal', 3), s('backstory: Emilie, six dogs, stipend'), S('new money pays old', 2)]),
    ch(3, [2], [s('pious image'), S('charity and clergy', 4), s('newspapers'), c('Ehinger charm')]),
    ch(3, [2, 3], [s('house with customers money'), S('cash in sacks', false), s('authorities search'), s('savings banks drained')]),
    ch(3, [2, 3, 4], [s('withdrawals limited'), S('collapse', 1), s('Ehinger escape and sentence'), s('32,000 lose 38 million')]),
  ],
  octopus: [
    ch(1, [], [S('carries shells', 1), c('Bali and Sulawesi')]),
    ch(2, [1], [S('walks on two arms', 3), s('crawls too'), s('carrying bulky things')], 2),
    ch(2, [1, 2], [s('four octopuses'), S('tool debate', 2)]),
  ],
  library: [
    ch(1, [], [S('festival library', 1), s('Stop Volden'), c('ask what it does')]),
    ch(3, [1], [S('what you borrow', 2), S('spread to 85 countries', 4), s('funding closure'), c('neither tells us')]),
    ch(2, [1, 2], [s('contact hypothesis'), S('meta-analysis', 3), s('anxiety and empathy'), s('research gap')]),
  ],
  fish: [
    ch(1, [], [S('colorless blood', 1), c('icefish family'), s('ambush predator')]),
    ch(3, [1], [s('oxygen in plasma'), s('under 20% oxygen'), S('four times the blood', 2), s('spongy heart')]),
    ch(3, [1, 2], [s('gene remnants'), s('myoglobin'), s('myoglobin works'), S('inhibited myoglobin', 3)]),
    ch(2, [1, 2], [S('thin blood debate', 4), s('iron')]),
  ],
  cult: plain([
    ch(1, [], [S('the warning'), s('14 killed')]),
    ch(3, [1], [s('yoga school'), s('Sakamoto lawsuit'), s('TBS interview'), S('Sakamoto murders'), s('police drop it')]),
    ch(3, [1, 2], [s('1,783 votes'), s('doctrine'), S('anthrax rooftop'), s('Tsuchiya and the plant'), s('29 sheep')]),
    ch(3, [1, 3], [s('judges'), S('Matsumoto release'), S('Kono blamed')]),
    ch(2, [1, 2], [S('Kariya note and kidnapping'), s('raids planned'), s('five trains')]),
    ch(3, [1, 2, 4, 5], [S('raids uncover'), s('remains found'), c('execution'), s('Kono apology')]),
  ]),
};
