// The lesson engine: prepares topics from real sources ahead of time, then writes and voices
// a lesson one chapter at a time, saving each chapter as it is made.
//
// POST { action: "prepare", topic, force? }       step one for a named subject: read and plan the story. Text only.
// POST { action: "finish", topic_id }             step two: review the plan and write the opening. Text only.
// POST { action: "topics" }                       prepared topics that have not been played yet.
// POST { action: "refill" }                       do the next step toward keeping three topics waiting.
// POST { action: "interests" }                    the listener's tags, and tags Pliny suggests.
// POST { action: "add_interest", label } / { action: "remove_interest", id }
// POST { action: "start", topic_id, minutes }     turn a prepared topic into a lesson. Instant, no model call.
// POST { action: "segment", lesson_id, position }  write and voice one chapter. Safe to call twice.
// POST { action: "prepare", topic, engine: 2 }      the same, with the newer writer that is still on trial.
// POST { action: "second", topic_id }             engine 2 only: write the chapter after the opening ahead of time.
// POST { action: "script", lesson_id, position }   write and check one chapter's script, with no voice.
// POST { action: "get", lesson_id }               the lesson, its chapters, and links to finished audio.
// POST { action: "lessons" }                      lessons with something to replay, newest first.
// POST { action: "check", titles?: string[] }      free self-test. Calls no paid service.
// GET  ?lesson_id=...&position=...&apikey=...      the chapter's audio, played while it is being made.
//
// Why a lesson starts quickly: everything slow is done before the listener taps. Preparing a
// topic reads the sources, plans the chapters and writes a one minute opening, all as text,
// in two steps of about a minute each. Starting a lesson then only has to voice that opening, and the GET route sends the
// audio out while it is still being generated, so playback begins within a couple of seconds.
//
// No voice is made until it is asked for. The caller asks for chapters in order and stays a
// couple ahead of the listener, so an abandoned lesson costs only what was heard plus a buffer.
//
// How a story is planned: one call does the research notes, decides what makes the subject
// worth telling (the story discovery) and lays out a chapter blueprint. A second call, the
// editorial review, challenges that blueprint and hands back a better one. Each chapter is
// then written from its blueprint and checked against its notes before it is voiced.
//
// How a lesson is grounded: a small model names Wikipedia articles worth reading, their text
// is fetched, and the writer model boils them down to short fact notes and an outline.
// Chapters are written from those notes. Dates, numbers and names come from the notes, never
// from the model's memory.
//
// Callers must send the project's publishable key, as an `apikey` header or query parameter.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "npm:@supabase/supabase-js@2";
import { type Chapter, chapterLengths, fullMinutes, isBlueprint, pickChapters } from "./plan.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const WRITER_MODEL = Deno.env.get("OPENAI_WRITER_MODEL") ?? "gpt-6.1-terra";
// Naming articles to read is a small job, so it goes to the cheapest model.
const SCOUT_MODEL = Deno.env.get("OPENAI_SCOUT_MODEL") ?? "gpt-6-luna";
const VOICE_MODEL = Deno.env.get("OPENAI_VOICE_MODEL") ?? "gpt-4o-mini-tts";
const VOICE = Deno.env.get("OPENAI_VOICE") ?? "cedar";
const VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"];

const WORDS_PER_MINUTE = 150;
const MAX_MINUTES = 60;
// A story is the opening plus at most this many chapters, less one. Most need far fewer:
// the planner is told to use only what the material can carry.
const OUTLINE_CHAPTERS = 13;
// For plans made before blueprints, which had no length on each chapter.
const CHAPTER_MINUTES = 3;
// Preparing a topic is done in two steps, each its own request, because one request has
// about two and a half minutes and the whole job was running right up against that.
const BUCKET = "lesson-audio";
// Wikipedia asks every client to say who it is.
const WIKI_AGENT = "LearningApp/0.1 (personal project; https://github.com/Poncheka/learning-app)";
const MAX_SOURCES = 5;
const SOURCE_CHARS = 14000;
// A chapter is voiced in a single request, because each request is a fresh performance and
// the narrator audibly shifts between them. The voice model takes about 2,000 tokens at a
// time, which is why no chapter is planned longer than six minutes. Splitting is only a
// fallback for a script that runs long.
const CHUNK_CHARS = 6500;
// Work claimed longer ago than this is assumed to have died and can be picked up again.
// No request outlives 150 seconds, so a step still marked as under way after this was cut off.
const STALE_MS = 160 * 1000;
// A chapter being made says so every ten seconds. Silence for this long means its maker was cut off.
const CLAIM_MS = 35 * 1000;
const LINK_SECONDS = 6 * 60 * 60;

// The narrator's direction: who they are, their pace and their tone. The voice model has no
// speed setting, so pace is asked for in words. This is only the fallback. The live wording
// is the narrator_direction row in the settings table, which can be changed without a redeploy.
const VOICE_STYLE =
  "You are telling a friend something fascinating you just learned, across a kitchen table. " +
  "Relaxed and conversational, not a presenter and not a documentary announcer. " +
  "Pace: slow and easy, well under normal talking speed. Take your time. Let each sentence finish, " +
  "pause for a beat before the next one, and pause longer between ideas. " +
  "Tone: warm, low-key, a little amused at the surprising parts. " +
  "Keep exactly the same voice, pace and energy from the first word to the last. Never rushed, never performed.";

const SCOUT_BRIEF =
  "You help research an audio lesson. Name the English Wikipedia articles that would give the richest " +
  "material for the topic: one or two core articles, then narrower ones where the story lives. Look for " +
  "the people behind it, the argument over it, what it cost and what it changed, and any strange episode " +
  "along the way, not only the thing itself. " +
  "Use real article titles. Reply with only a JSON array of five strings.";

// The house view of what makes a lesson interesting. This is only the fallback: the live
// wording is the story_brief row in the settings table, which Jeff edits by ear.
const STORY_BRIEF =
  "Tell it like the best dinner-table storyteller you know, not like an encyclopedia. Find the angle first: " +
  "the question that makes someone lean in. Why did anyone want this? Who thought it was madness, and why " +
  "were they almost right? What was at stake, who paid for it, who got rich, who got hurt? What did it " +
  "change that we still live with? What is the strangest true thing about it? Lead with people, motives, " +
  "conflict and consequences. Describe how something was physically done only when the how is itself " +
  "astonishing, and then give it as one clear picture, not a procedure. Skip anything a listener could have " +
  "guessed. About once a minute the listener should think: wait, really?";

const plannerBriefV1 = (story: string) =>
  "You are the story editor and narrative architect for Pliny, which tells short true stories aloud to one " +
  "curious adult, often while driving. You are given a subject and extracts from Wikipedia articles. Your job " +
  "is not to summarize the subject. It is to find what is extraordinary about it and plan the most compelling, " +
  "factually defensible order in which to reveal it. A story is not a collection of interesting facts. It is a " +
  "deliberately ordered sequence of discoveries.\n\n" +
  `The house style:\n${story}\n\n` +
  "STEP 1, RESEARCH NOTES. Pull out what a storyteller would want: anecdotes, obstacles, failures, reversals, " +
  "strange details, competing explanations, consequences, and what nobody knows. Each note is one or two " +
  "sentences in your own words, understandable on its own, with every name, date and number copied exactly " +
  "from the extract. Note only what the extracts say, and name the article each came from. Give each note a " +
  "status: \"fact\" for what is well established, \"account\" for a credible telling that rests on one source or " +
  "on tradition, \"disputed\" where versions conflict or the story is doubted, \"hypothesis\" for an explanation " +
  "that is not settled, \"unknown\" for an open question. A disputed anecdote can be the best thing in the " +
  "story, as long as it is told as disputed. Aim for about forty-five notes, fewer if the extracts are thin. " +
  "Go looking for the odd, funny and human details as hard as for the explanatory ones: they are what give a " +
  "story its personality.\n\n" +
  "STEP 2, STORY DISCOVERY. Decide what makes this worth telling. Be aggressive about finding the most " +
  "entertaining way in, not the most explanatory one. The test: what is the part someone would be excited to " +
  "repeat to a friend at dinner? Before you settle, write down at least two genuinely different angles, each " +
  "with the moment it would open on: for example the strange human story against the technical marvel, or " +
  "the mystery against the consequence. Weigh each on intrigue, how well the notes support it, emotional " +
  "pull and momentum, then choose one and say why it beats the other. A disputed or funny human anecdote is " +
  "often the best opening, told as disputed. Then name the core fascination, the one central question the listener " +
  "will want answered, the narrative engine (mystery, transformation, escalation, problem-solving, " +
  "contradiction or discovery, or two of them), the emotional character (funny, eerie, thrilling, whimsical, " +
  "tragic, awed: let the subject decide, and do not make everything a solemn documentary), the three to six " +
  "discoveries that carry the story, the final payoff, and the research you are deliberately leaving out. " +
  "Sort what you found into three piles. Essential: needed to follow the story. Texture: unusual, funny or " +
  "vivid details that are not strictly needed but give the story personality and surprise. Tangent: accurate " +
  "but dull, or a detour that stalls the story. Keep the essential and the texture. Cut only the tangents. " +
  "The aim is economy, not sterility.\n\n" +
  "STEP 3, CHAPTER BLUEPRINT. Build the story in three movements: intrigue, then discovery and complication, " +
  "then payoff. Order it by what is most gripping while staying clear about cause and effect. Never use " +
  "chronological or encyclopedic order just because the sources do. Do not resolve the central question " +
  "early. Put the best anecdote where it does the most work, not buried late.\n" +
  `Write an opening and then two to ${OUTLINE_CHAPTERS - 1} chapters. Use as many chapters as the material can ` +
  "carry and no more: do not pad a thin story, and do not squeeze a rich one down to a summary.\n" +
  "The opening is a chapter of its own and runs one minute. It is a hook that delivers, never a teaser: its " +
  "first two sentences are the most extraordinary concrete moment of the angle you chose, it gives just " +
  "enough context to follow, it hands the listener one real discovery inside the minute, and it ends by " +
  "posing the central question. Someone who hears only this minute should come away with something worth " +
  "repeating.\n" +
  "Every other chapter runs two to four minutes and is a small story of its own: a situation or question, a " +
  "development through concrete events or evidence, a turn or revelation, and a consequence. Something must " +
  "change for the listener between its first line and its last: a question answered, an assumption " +
  "overturned, a problem solved, a new obstacle, higher stakes, a hidden consequence, a mechanism understood. " +
  "A chapter that only adds information gets merged or cut. Build chapters around developments, never around " +
  "sub-topics.\n" +
  "The chapter straight after the opening also orients the listener: when and where this is, who these " +
  "people are, what was normal before. Weave it into what happens. Never start a chapter with it.\n" +
  "Keep the story escalating. Each chapter should feel more extraordinary than the one before. Technical or " +
  "scientific detail goes inside a development, as the answer to a question the listener already has. It " +
  "never gets a chapter to itself that stalls the story.\n" +
  "Chapter titles are concrete and make someone want to hear what happens: 'The patent office says it is " +
  "impossible', 'Move the body and the fungus dies', 'The boy who hit his head'. Never academic or generic: " +
  "not 'A specialized manipulation', 'The useful part' or 'From trail to leaf'. No clickbait, and never give " +
  "away the chapter's own discovery.\n" +
  "The last chapter is the payoff. It answers the central question, says what it changed or means where the " +
  "notes support that, and lands the final insight. It is always played, however short the lesson.\n" +
  "The listener chooses the length later, and a shorter lesson has to be a complete shorter story, not this " +
  "one with a hole in it. So map the chain of cause and effect. For each chapter give 'needs': the numbers of " +
  "the earlier chapters the listener must have heard for this one to make sense, counting the first chapter " +
  "as 1. Give 'short': the chapter's essential beat in one or two plain sentences, with its key fact, which " +
  "is how it gets folded into a neighboring chapter when there is no time to play it in full. And give a " +
  "priority to every middle chapter: 1 if it is part of the story's spine, 2 if it is strong but the story " +
  "survives without it, 3 for texture that is the first to go.\n" +
  "Give each chapter three to five note ids. Use each note in one chapter only. Leave tangents unused.\n\n" +
  "Also give the lesson its title, following the title rule in the house style exactly, and a hook: one " +
  "sentence that would make someone want to hear it.\n\n" +
  'Reply with only JSON in this shape: {"title": "...", "hook": "...", "story": {"core_fascination": "...", ' +
  '"central_curiosity": "...", "engine": "...", "tone": "...", "dinner_line": "...", "angles": [{"angle": "...", "opens_on": "...", ' +
  '"for": "...", "against": "..."}], "chosen_because": "...", "discoveries": ["..."], ' +
  '"final_payoff": "...", "left_out": ["..."]}, "facts": [{"id": 1, "fact": "...", "source": "Article title", ' +
  '"status": "fact"}], "chapters": [{"title": "...", "minutes": 3, "priority": 1, "situation": "the question or ' +
  'situation it opens on", "development": "what happens or is explained, concretely", "discovery": "the main ' +
  'thing the listener finds out", "turn": "what changes in their understanding", "matters": "why that matters", ' +
  '"transition": "the question this naturally raises next, or empty", "tone": "...", "needs": [1], "short": "its ' +
  'essential beat in a sentence or two", "fact_ids": [1, 2]}]}';

// Engine 2, behind a flag: the same planner, asked for fuller notes on the best moments, a
// sequence of weighted beats in every chapter, an honest length, and a kind of ending.
const plannerBrief = (story: string, engine = 1) =>
  engine !== 2
    ? plannerBriefV1(story)
    : plannerBriefV1(story)
        .replace(
          "Aim for about forty-five notes, fewer if the extracts are thin.",
          "For the two to four most extraordinary moments, the ones the story will be built around, keep everything " +
            "the extracts document about them, spread over several notes: what led up to it, what stood in the way, " +
            "who decided what, what was tried, what the evidence was, what happened next, and any telling detail. " +
            "Those moments are told in full later, and they can only be told from what is in the notes. For the one " +
            "or two people the story turns on, note what the extracts document about who they were: their role, what " +
            "set them apart, what they wanted or were up against, and what they looked like if a source says. Aim for " +
            "about sixty notes, fewer if the extracts are thin.",
        )
        .replace(
          "Then name the core fascination,",
          "MODE AND PROMISE. Decide which of two kinds of story this is. \"focused\": one particular event, person, " +
            "mystery or invention, told in depth. Every chapter develops that one subject, and wider history comes in " +
            "only where it explains it. \"broad\": a deliberately wide look at a subject through several incidents, " +
            "held together by one question and a progression in which each example brings a new development, never " +
            "just another item. Choose by what the notes can carry. Then write the promise: what someone who reads " +
            "the title and hook expects to hear. For a focused story, the person, event or discovery that stays at " +
            "the centre. For a broad one, the question and the progression. The title, hook, opening, every chapter " +
            "and the payoff all keep that one promise. Never widen a focused story to fill time: if its material " +
            "carries five minutes, plan five, and put the wider subject in \"wider\" as a separate idea with its own " +
            "title and hook (otherwise null). A broad story is titled as one, like 'Why people once put animals on " +
            "trial' or 'The strange history of vending machines', never after one incident inside it. List the cast: " +
            "the protagonist or two the story follows and the supporting figures who matter, each with the few " +
            "documented words that identify them. Everyone else is minor and usually goes unnamed. " +
            "Then name the core fascination,",
        )
        .replace(
          '"left_out": ["..."]}, "facts"',
          '"left_out": ["..."], "mode": "focused", "promise": "...", "cast": [{"name": "...", "role": "protagonist", ' +
            '"tag": "who they are, in a few words"}], "wider": {"title": "...", "hook": "..."}}, "facts"',
        )
        .replace(
          "A chapter that only adds information gets merged or cut. Build chapters around developments, never around sub-topics.\n",
          "Each chapter is driven by a problem or question the story has just raised. It shows what was tried or " +
            "found, and ends on the complication that drives the next chapter. A run of examples in date order is a " +
            "catalog, not a chapter: group them by the problem they were answers to. Do not force this on a story " +
            "whose natural shape is different. A chapter that only adds information, or that shares the broad subject " +
            "without advancing the promise, is cut, even if the story gets shorter.\n",
        )
        .replace(
          "The last chapter is the payoff. It answers the central question, says what it changed or means where the notes support that, and lands the final insight. It is always played, however short the lesson.\n",
          "The last chapter is the payoff. It answers the central question, and its final beat is the strongest " +
            "supported conclusion of the whole story, returning to the opening's image, person or contradiction " +
            "where that fits. No lesser fact comes after it. It is always played, however short the lesson.\n",
        )
        .replace(
          "Give each chapter three to five note ids.",
          "Give each chapter every note its beats use, usually five to ten.",
        )
        .replace(
          "Also give the lesson its title,",
          "BEATS. For every chapter list its beats in the order they are told, three to six of them. A beat is one " +
            "thing that happens or is found out. Give each a weight. \"signature\": one of the most extraordinary or " +
            "consequential moments of the whole story, which will be told in full, with its setup, the obstacle or " +
            "contradiction, what was done or found, the reveal and what followed. A signature beat needs at least " +
            "three notes behind it, and most chapters have one, never more than two. \"supporting\": an event, " +
            "mechanism or piece of context that moves the story on and gets a few good sentences. \"connective\": " +
            "background needed only for clarity, which gets a line. Do not give mundane background and an " +
            "extraordinary reversal the same weight. Give each beat the ids of the notes it is told from.\n" +
            "THE CHAPTER AFTER THE OPENING is the one most likely to lose a listener. It must begin with a new " +
            "development, something the opening did not contain, and move the story toward the central question. It " +
            "never retells or re-describes the opening's moment, and it shares no beat and no note with the opening. " +
            "It picks up from the opening's person, image or question, not somewhere unrelated, and weaves " +
            "orientation into what happens.\n" +
            "LENGTH. Set each chapter's minutes from its beats, not from habit. As a guide, a signature beat with " +
            "good notes carries sixty to ninety seconds, a supporting beat about thirty, a connective beat ten. If a " +
            "chapter's beats cannot fill two minutes, first look for more notes that belong to it, then for a better " +
            "choice of beats, then merge it with a neighbor. Never promise minutes the notes cannot fill.\n" +
            "ENDINGS. Say how each chapter ends: \"revelation\" (the discovery itself is the last thing heard), " +
            "\"reversal\", \"consequence\" (a plain statement of what it led to), \"complication\" (a new problem " +
            "left standing), \"handoff\" (the story simply moves toward the next development) or \"question\". The " +
            "opening ends on the central question. After that, at most one chapter may end on a question, and no two " +
            "chapters in a row end the same way. In ending_note say what the chapter should arrive at: a " +
            "destination for the writer, never a sentence to be copied.\n\n" +
            "Also give the lesson its title,",
        )
        .replace(
          '"transition": "the question this naturally raises next, or empty", ',
          '"beats": [{"beat": "what happens or is found out", "weight": "signature", "fact_ids": [1, 2, 3]}], ' +
            '"ending": "revelation", "ending_note": "what the last line lands on", ',
        );

const REVIEWER_V2 =
  "First check the promise. The story discovery states a mode and a promise, and you are given the title and " +
  "hook. Does every chapter advance that promise or deepen it? Cut any chapter that merely shares the broad " +
  "subject and let the story be shorter, down to an opening and two chapters: never fill the gap with " +
  "neighbouring material. A focused story goes deep on its one subject. In a broad one every example must " +
  "bring a new development. If the title or hook promises something the chapters do not deliver, also return " +
  "a corrected \"title\" (nine words at most: 'The X that Y' for a focused story, 'Why ...' or 'The strange " +
  "history of ...' for a broad one) and \"hook\" beside the chapters; otherwise leave them out. Does the chapter " +
  "where a protagonist first appears hold the notes that make them memorable, and are there more names than a " +
  "listener can hold?\n\n" +
  "This plan also gives every chapter its beats, each weighted signature, supporting or connective, and a kind " +
  "of ending. Check them, and check the shape. Does each chapter turn on a problem the one before it raised, " +
  "or is the middle a catalog in date order? If so, regroup it by problem. Does the last chapter end on the " +
  "story's strongest conclusion, with nothing lesser after it? Are the truly extraordinary moments marked signature, and does each have at least " +
  "three notes to be told from? If one is thin, bring unused notes to it. Is mundane background being given " +
  "the weight of a great reversal? Are the minutes honest for the beats? Where a chapter cannot fill its " +
  "minutes, first give it more notes that belong to it, then choose better beats, then merge it with a " +
  "neighbor, and only then lower its minutes. The chapter straight after the opening matters most: it must " +
  "reward the curiosity the opening raised with something extraordinary of its own, not settle into setup, " +
  "and it must not retell the opening's moment or reuse its notes. If it does, give it different beats. " +
  "Do the endings vary? Only the opening and at most one other chapter may end on a question, and no two " +
  "chapters in a row end the same way. Return beats, ending and ending_note on every chapter, with the " +
  "chapter's fact_ids covering all of its beats.\n\n";

const REVIEWER_BRIEF =
  "You are the editorial reviewer for Pliny, which tells short true stories aloud. You are handed a story " +
  "plan: the story discovery, the research notes and a chapter blueprint. Challenge it, then hand back a " +
  "better blueprint. Specific fixes, not general advice.\n\n" +
  "Judge it hard. Start with the angle. The plan lists the angles it weighed: is the one it chose really the " +
  "most entertaining, or only the most explanatory? If there is a stranger, funnier or more human way in " +
  "among the notes, such as a disputed anecdote about a person, and it is sitting in a middle chapter, move " +
  "it to the front. Does the one minute opening start on something extraordinary and deliver a real " +
  "discovery of its own, or does it only tease? Is the central question compelling, and is it left open until the end? Is " +
  "the best material placed where it does the most work, or buried? Does every chapter change something for " +
  "the listener, or do some only add information? Do the chapters follow developments, or sub-topics and the " +
  "calendar? Does the story escalate, each chapter more extraordinary than the last, or does a technical " +
  "chapter stall it in the middle? Does each discovery raise the next chapter's question? Is anything " +
  "repeated, and is there background nobody needs? Does the last chapter answer the central question and " +
  "land an insight? Are the chapter titles concrete and inviting, or academic and generic?\n\n" +
  "Then fix what you find. You may reorder chapters, rewrite any field, retitle, move notes between " +
  "chapters, change priorities and minutes, and strengthen the opening. Merge or cut a chapter only " +
  "when nothing changes for the listener in it. Do not shrink the story just to be brief: entertaining " +
  "detail that gives the story personality, humor or surprise stays, even when the explanation would " +
  "survive without it. Cut boring tangents, not texture. Bring back a good unused note if it earns its " +
  "place. Use only note ids that exist, each in one chapter. Keep the rules: the opening comes first, runs " +
  "one minute and delivers a real discovery of its own, every other chapter runs two to four minutes, and " +
  "the last chapter is the payoff. After any reordering, make 'needs' right again: for each chapter, the numbers of the " +
  "earlier chapters it cannot be understood without, counting from 1 in your new order. Keep 'short' true " +
  "to each chapter. If the plan is already strong, change little.\n\n" +
  "Score the plan as you received it, from 1 to 10, on opening, momentum, payoffs, selection, ending and " +
  "economy. The scores are a diagnostic, not proof of quality.\n\n" +
  'Reply with only JSON: {"scores": {"opening": 0, "momentum": 0, "payoffs": 0, "selection": 0, "ending": 0, ' +
  '"economy": 0}, "problems": ["a specific weakness"], "changes": ["what you changed"], "chapters": [the full ' +
  "revised chapter list, in the same shape you were given]}";

const writerBrief = (story: string) =>
  "You are the voice of Pliny: a very smart, charismatic storyteller who is fascinated by the subject and " +
  "knows exactly what makes it worth telling. You write one chapter of a true story that is read aloud to one " +
  "curious adult, often while driving. Think of a great documentary crossed with the best narrative podcasts. " +
  "Not a lecture, and not an encyclopedia.\n\n" +
  `The house style:\n${story}\n\n` +
  "You are given the chapter's blueprint: the situation it opens on, how it develops, the discovery it " +
  "delivers, the turn in the listener's understanding and why it matters. Follow it. Open on the situation, " +
  "not on background. Get to the discovery and make it land. Everything in the chapter serves that. Cut what " +
  "does not.\n\n" +
  "Voice: conversational, with natural contractions. Sentences of varied length, some very short. Concrete " +
  "observations. A surprising comparison where it helps. Understated humor when the material is funny, real " +
  "wonder or disbelief when it is earned, unease when it is eerie. Match the tone you are given, and do not " +
  "make everything solemn. Never academic, and never cautious for its own sake: state an uncertainty once, " +
  "plainly, where it belongs, then move on. Avoid stock narrator phrases such as 'it is important to note', " +
  "'that distinction matters', 'what makes this fascinating', 'this raises an interesting question', 'it is " +
  "tempting to think', 'little did they know', 'what happened next would change everything', 'today we will " +
  "explore' and 'have you ever wondered'.\n\n" +
  "Write for the ear: plain spoken sentences, one idea at a time, no lists, no headings, no markdown, no " +
  "parentheses, no stage directions. Spell out numbers the way a person would say them. Never stack dates, " +
  "numbers or names close together.\n\n" +
  "Truth first. Every date, number, name, quotation and event must come from the fact notes, kept faithful to " +
  "them. Each note carries a status in square brackets. Tell a fact plainly. Tell an account as what is said " +
  "or recorded. Tell a disputed note as disputed. Tell a hypothesis as what researchers think, not as what is " +
  "known. Say so when something is unknown. Never invent dialogue, scenes, feelings, motives or sensory " +
  "detail. Use your own knowledge only to connect ideas and say why something mattered. Do not repeat " +
  "anything listed as already covered.\n\n" +
  "The length you are given is a ceiling, not a quota. Stop when the chapter has done its job.\n\n" +
  "Reply with the narration only. Then, on its own line, write ===SUMMARY=== followed by two sentences " +
  "saying what this chapter covered, for the writer of the next chapter.";

const writerBriefV2 = (story: string) =>
  writerBrief(story)
    .replace(
      "Follow it. Open on the situation, not on background. Get to the discovery and make it land. Everything in the chapter serves that. Cut what does not.",
      "Follow it. Open on the situation, not on background. You are also given the chapter's beats, in order, " +
        "each with a weight and the notes it is told from. Spend your words by weight. A signature beat is told, " +
        "not reported: set up what was expected or at stake, bring in the obstacle or contradiction, give what was " +
        "done or found in a deliberate order, let the reveal land, then say what followed from it. Show the " +
        "listener why it is extraordinary instead of telling them that it is. A supporting beat gets a few good " +
        "sentences. A connective beat gets a line. Summarizing a signature beat in two or three sentences is the " +
        "worst mistake you can make here. Everything you use to develop a beat comes from its notes: when the " +
        "notes run out, the beat is finished.",
    )
    .replace(
      "The length you are given is a ceiling, not a quota. Stop when the chapter has done its job.",
      "Length. You are given a range of words that the chapter's material was judged able to carry. Aim to land " +
        "inside it by developing the signature beats fully. Spend the words on the best documented moments, and " +
        "take them from repeated explanation and context nobody needs. Never fill space by restating why " +
        "something matters or stretching sentences. If the notes truly cannot carry " +
        "the range, stop short: a shorter chapter that is all story beats a longer one with padding.\n\n" +
        "Continuity. This is one continuous telling, not a set of essays. You are given the previous chapter's " +
        "closing lines: begin as their next thought. No recap, no announcing what comes next, and no jump to an " +
        "unrelated person or date without a phrase that links it. Stay on the story's promise: nothing goes in only " +
        "because it shares the subject.\n\n" +
        "People. A cast may be listed, and the covered summary says who the listener has met. The first time a " +
        "protagonist appears, make them stick, from the notes only: who they are, what set them apart, what they " +
        "wanted or were up against, and what they looked like if a note says. With no description, use a " +
        "documented detail of what they did. A supporting figure gets one identifying phrase and their tie to the " +
        "story. Leave minor figures unnamed where you can: too many names lose a listener. Do not reintroduce " +
        "someone already met, but when they return after a chapter away, give a few natural words of reminder, not " +
        "the full name and title again. Keep it in proportion: an introduction is a clause or a sentence or two, " +
        "never a biography, and the opening stays fast.\n\n" +
        "Endings. You are told where the chapter should arrive. Write toward it and land it in your own closing " +
        "sentences: never paste the note in as a line. Do not end on a question unless told to, and never tease " +
        "what is coming.",
    )
    .replace("saying what this chapter covered, for", "saying what this chapter covered and which people the listener has now met, for");

const CHECKER_V2 =
  "You are the fact checker and editor for a chapter of narration that is about to be recorded. You are given " +
  "the chapter's beats with their weights, the fact notes, which are the only permitted source of specifics, " +
  "the target length and the script.\n\n" +
  "FACTS. List every specific claim in the script that the notes do not support or that contradicts them: a " +
  "name, date, number, quotation, event, cause or mechanism. Also list anything the script states as certain " +
  "that its note marks as an account, disputed, a hypothesis or unknown, and any invented dialogue, scene, " +
  "feeling, motive or sensory detail. General connecting knowledge that is common and uncontroversial is " +
  "allowed. Be exact, and do not list something unless you are sure the notes do not cover it.\n\n" +
  "EDITORIAL. List only significant problems, at most three, the ones a listener would notice. Give each a " +
  "kind. \"summarized\": a signature beat reported in a sentence or two when its notes hold more that is worth " +
  "telling, and name the unused details. \"repetition\": the same point made twice in a way that drags, or " +
  "something earlier chapters already told, retold here. A deliberate callback, or a payoff that names the " +
  "answer, is not repetition. \"padding\": words that add nothing, such as restating why something matters, general " +
  "background, a sentence stretched out, or trivia that shares the subject but leaves the story's promise. \"ending\": the chapter ends on a rhetorical question or a teaser " +
  "when it was not told to, a closing line that does not follow from what came before it, or in the last " +
  "chapter a lesser fact after the main conclusion. \"voice\": a lecturing, academic or over-cautious " +
  "passage, a stock narrator phrase, talk of 'the notes', 'the extract' or 'the sources' themselves, or a stretch with no personality where the material invited some. " +
  "\"join\": the chapter does not follow on from the previous chapter's closing lines (a hard reset, a recap, " +
  "or a new name dropped in unexplained), or it starts on background. Quote the words, and say in " +
  "one line what would fix it. A fix says what to put in the place of the weak words, drawn from the notes, " +
  "not only what to remove: the aim is a better chapter, not a shorter one. Do not list small polish. If it " +
  "reads well, list nothing.\n\n" +
  'Reply with only JSON: {"facts": [{"claim": "the words in the script", "problem": "what is wrong"}], ' +
  '"editorial": [{"kind": "summarized", "quote": "the words", "fix": "what to do"}]}';

const CHECKER_BRIEF =
  "You are the fact checker and last editor for a chapter of narration that is about to be recorded. You are " +
  "given the fact notes, which are the only permitted source of specifics, and the script.\n\n" +
  "FACTS. List every specific claim in the script that the notes do not support or that contradicts them: a " +
  "name, date, number, quotation, event, cause or mechanism. Also list anything the script states as certain " +
  "that its note marks as an account, disputed, a hypothesis or unknown, and any invented dialogue, scene, " +
  "feeling or motive. General connecting knowledge that is common and uncontroversial is allowed and is not " +
  "a problem. Be exact, and do not list something unless you are sure the notes do not cover it.\n\n" +
  "DELIVERY. List at most three concrete problems for the ear: a stock narrator phrase, a lecturing or " +
  "over-cautious passage, repetition of what earlier chapters covered, background before anything happens, " +
  "or the chapter's discovery not landing. Quote the words. If it reads well, list nothing.\n\n" +
  'Reply with only JSON: {"facts": [{"claim": "the words in the script", "problem": "what is wrong"}], ' +
  '"delivery": ["..."]}';

const SUGGEST_BRIEF =
  "You suggest interests to a listener of Pliny, an audio app for the endlessly curious. Given the tags " +
  "they already have, name four more they are likely to enjoy: two close neighbors of what they like and " +
  "two a step further out. Each is one to three words, written like 'Himalayan trade' or 'Gutenberg'. " +
  "Do not repeat a tag they have. Reply with only a JSON array of four strings.";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

class Problem extends Error {
  constructor(public status: number, message: string, public detail?: string) {
    super(message);
  }
}

function envKeys(name: string): string[] {
  try {
    const named = JSON.parse(Deno.env.get(name) ?? "{}");
    return Object.values(named).filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function allowedKeys(): string[] {
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  return [...envKeys("SUPABASE_PUBLISHABLE_KEYS"), ...(anon ? [anon] : [])];
}

// The secret key lets this function past row level security. It never leaves the server.
const SECRET_KEY = envKeys("SUPABASE_SECRET_KEYS")[0] ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const service = createClient(Deno.env.get("SUPABASE_URL") ?? "", SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Each person's own things are read and written as that person, so the database itself
// keeps one account from ever seeing another's: interests, likes, history, chapters, swipes
// and their narrator. Stories and everything else are the server's, and are shared.
const OWN = new Set(["interests", "signals", "lessons", "segments", "dismissals", "user_settings"]);
/** The database as the signed-in person sees it, or as the server sees it when nobody is signed in. */
const mine = (): any => (who.getStore() as any)?.client ?? service;
const me = (): string | null => ((who.getStore() as any)?.user_id as string | undefined) ?? null;
const db = {
  from: (table: string) => (OWN.has(table) ? mine() : service).from(table),
  storage: service.storage,
};

/** A value from the settings table, which Jeff can change by hand, or the built-in default. */
async function setting(key: string, fallback: string): Promise<string> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  const value = typeof data?.value === "string" ? data.value.trim() : "";
  return value || fallback;
}

// ---------- A second narrator ----------
//
// New recordings can be read by an ElevenLabs voice instead of OpenAI's. The settings table
// decides: narrator_engine "eleven" turns it on, and anything else is OpenAI as before. Stories
// already begun in the OpenAI voice are finished in it, so no story changes narrator part way
// and nothing already recorded is recorded again. If ElevenLabs refuses for lack of credit or a
// bad key, the switch is thrown back to OpenAI at once, so stories keep coming.
const ELEVEN_KEY = Deno.env.get("ELEVENLABS_API_KEY") ?? "";
const ELEVEN_VOICE_ID = "ANYdMtqQZTRmq10Nw496"; // Ella, casual New Zealand female.
const ELEVEN_MODEL = "eleven_v4_turbo";
/** A narrator's name is OpenAI's when it is on their list. Any other name is an ElevenLabs voice. */
const isEleven = (voice: string) => !VOICES.includes(voice);

/**
 * The ElevenLabs voices on trial, kept in the settings table as eleven_voices: a list of
 * {"name", "id", "on"}. Each new story is given one of the voices that are on, in turn, and keeps
 * it to the end. A voice switched off still finishes the stories it began.
 */
type ElevenVoice = { name: string; id: string; on: boolean };
async function elevenVoices(): Promise<ElevenVoice[]> {
  const fallback = [{ name: (await setting("eleven_voice_name", "ella")).toLowerCase(), id: await setting("eleven_voice_id", ELEVEN_VOICE_ID), on: true }];
  try {
    const list = JSON.parse(await setting("eleven_voices", "[]"));
    const voices = (Array.isArray(list) ? list : [])
      .filter((v: any) => typeof v?.name === "string" && typeof v?.id === "string" && v.name.trim() && v.id.trim())
      .map((v: any) => ({ name: v.name.trim().toLowerCase(), id: v.id.trim(), on: v.on !== false }))
      .filter((v: ElevenVoice) => !VOICES.includes(v.name));
    return voices.length > 0 ? voices : fallback;
  } catch {
    return fallback;
  }
}
/** A steady number from a lesson's id, so every chapter of one story lands on the same voice. */
function turnOf(id: unknown): number {
  let sum = 0;
  for (const c of String(id ?? "")) sum = (sum * 31 + c.charCodeAt(0)) >>> 0;
  return sum;
}

async function voiceModel(voice: string): Promise<string> {
  return isEleven(voice) ? await setting("eleven_model", ELEVEN_MODEL) : VOICE_MODEL;
}

/**
 * Who reads, and how. `segments` are the chapters of the lesson being recorded, when there is
 * one: a lesson that already has a chapter in an OpenAI voice keeps that voice to the end.
 */
async function narrator(owner?: string | null, segments?: any[]): Promise<{ voice: string; direction: string }> {
  // The narrator is each listener's own choice. A recording uses the choice of whoever owns the lesson.
  let asked = db.from("user_settings").select("value").eq("key", "voice");
  if (owner) asked = asked.eq("user_id", owner);
  const { data } = await asked.limit(1).maybeSingle();
  const chosen = typeof data?.value === "string" && data.value.trim() ? data.value.trim() : VOICE;
  // One narrator for everyone, so a recording made for one listener can be played to the next.
  // Setting voice_lock to "off" in the settings table gives each listener their own choice back.
  const openai = (await setting("voice_lock", "cedar")) === "off" ? chosen : "cedar";
  const direction = await setting("narrator_direction", VOICE_STYLE);
  const begun = (segments ?? []).find((s) => s.status === "ready" && typeof s.voice === "string" && s.voice);
  const fromOpenai = begun && VOICES.includes(begun.voice) ? begun.voice : null;
  if (!fromOpenai && ELEVEN_KEY && (await setting("narrator_engine", "openai")) === "eleven") {
    const voices = await elevenVoices();
    // A story already begun in one of these voices keeps it. A new story takes the next voice in turn.
    const kept = begun ? voices.find((v) => v.name === begun.voice) : null;
    const open = voices.filter((v) => v.on);
    const pool = open.length > 0 ? open : voices;
    return { voice: (kept ?? pool[turnOf(segments?.[0]?.lesson_id) % pool.length]).name, direction };
  }
  return { voice: fromOpenai ?? (VOICES.includes(openai) ? openai : VOICE), direction };
}

// ---------- The usage ledger ----------
//
// Every paid call is written down with what it was for: which story, which lesson, which
// chapter. Each request carries its own note of that, so calls made deep inside the work
// are filed under the right story without every function having to pass it along.
const who = new AsyncLocalStorage<Record<string, unknown>>();
function mark(tags: Record<string, unknown>) {
  const store = who.getStore();
  if (store) Object.assign(store, tags);
}
/** Writes one line to the ledger. It must never stop a lesson, so every failure is swallowed. */
async function record(row: Record<string, unknown>) {
  try {
    const { topic_id = null, lesson_id = null, position = null, user_id = null } = (who.getStore() ?? {}) as Record<string, unknown>;
    await db.from("usage").insert({ topic_id, lesson_id, position, user_id, ...row });
  } catch {
    // Nothing to do. The work matters more than the note about it.
  }
}

/** How long an mp3 runs, read from its own header. Null if it cannot be read. */
function mp3Seconds(audio: Uint8Array): number | null {
  let at = 0;
  // Skip a leading ID3 tag if there is one.
  if (audio.length > 10 && audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) {
    at = 10 + ((audio[6] & 0x7f) << 21) + ((audio[7] & 0x7f) << 14) + ((audio[8] & 0x7f) << 7) + (audio[9] & 0x7f);
  }
  for (let i = at; i < Math.min(audio.length - 4, at + 8192); i++) {
    if (audio[i] !== 0xff || (audio[i + 1] & 0xe0) !== 0xe0) continue;
    const version = (audio[i + 1] >> 3) & 3; // 3 is MPEG 1, 2 is MPEG 2, 0 is MPEG 2.5
    const layer = (audio[i + 1] >> 1) & 3; // 1 is layer three
    const index = (audio[i + 2] >> 4) & 15;
    if (version === 1 || layer !== 1 || index === 0 || index === 15) continue;
    const kbps = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[index];
    return Math.round(((audio.length - i) * 8) / (kbps * 1000));
  }
  return null;
}

/**
 * The sound of a recording as a row of digits, one for each quarter second or so: 0 is silence and
 * 9 is the narrator at full voice. It is read straight from the mp3's own bookkeeping (every frame
 * notes how loud it is), so nothing has to be decoded and no model is asked. The player draws it.
 */
function mp3Shape(audio: Uint8Array): { shape: string; seconds: number } | null {
  let at = 0;
  if (audio.length > 10 && audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33) {
    at = 10 + ((audio[6] & 0x7f) << 21) + ((audio[7] & 0x7f) << 14) + ((audio[8] & 0x7f) << 7) + (audio[9] & 0x7f);
  }
  const loud: number[] = [];
  let frameSeconds = 0.024;
  while (at < audio.length - 16) {
    if (audio[at] !== 0xff || (audio[at + 1] & 0xe0) !== 0xe0) { at++; continue; }
    const version = (audio[at + 1] >> 3) & 3;
    const layer = (audio[at + 1] >> 1) & 3;
    const checked = (audio[at + 1] & 1) === 0;
    const index = (audio[at + 2] >> 4) & 15;
    const rateIndex = (audio[at + 2] >> 2) & 3;
    const padded = (audio[at + 2] >> 1) & 1;
    const mono = ((audio[at + 3] >> 6) & 3) === 3;
    if (version === 1 || layer !== 1 || index === 0 || index === 15 || rateIndex === 3) { at++; continue; }
    const one = version === 3;
    const kbps = (one ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[index];
    const rate = [44100, 48000, 32000][rateIndex] / (one ? 1 : version === 2 ? 2 : 4);
    frameSeconds = (one ? 1152 : 576) / rate;
    // Where the frame's first block of sound keeps its count of values and its gain.
    const start = (at + 4 + (checked ? 2 : 0)) * 8 + (one ? (mono ? 18 : 20) : mono ? 9 : 10);
    const bits = (from: number, length: number) => {
      let value = 0;
      for (let k = 0; k < length; k++) value = (value << 1) | ((audio[(from + k) >> 3] >> (7 - ((from + k) & 7))) & 1);
      return value;
    };
    // A frame holding no values is silence, whatever gain it carries.
    loud.push(bits(start + 12, 9) === 0 ? 0 : bits(start + 21, 8));
    at += Math.max(1, Math.floor(((one ? 144 : 72) * kbps * 1000) / rate) + padded);
  }
  if (loud.length < 10) return null;
  const per = Math.max(1, Math.round(0.24 / frameSeconds));
  const points: number[] = [];
  for (let i = 0; i < loud.length; i += per) points.push(Math.max(...loud.slice(i, i + per)));
  const top = [...points].sort((a, b) => a - b)[Math.floor(points.length * 0.98)] ?? 0;
  // Each step of gain is a dB and a half. Thirty dB under the loud parts reads as silence.
  return { shape: points.map((g) => Math.max(0, Math.min(9, Math.round(9 - (top - g) / 2.2)))).join(""), seconds: loud.length * frameSeconds };
}

/** Draws the sound of chapters recorded before shapes were kept, a few each minute. It costs nothing. */
async function shapeOld() {
  const { data } = await service.from("segments").select("audio_path").eq("status", "ready").is("shape", null).not("audio_path", "is", null).limit(40);
  const paths = [...new Set((data ?? []).map((s: any) => String(s.audio_path)))].slice(0, 6);
  for (const path of paths) {
    try {
      const { data: file } = await service.storage.from(BUCKET).download(path);
      const read = file ? mp3Shape(new Uint8Array(await file.arrayBuffer())) : null;
      // An empty shape marks a recording that could not be read, so it is not tried every minute.
      await service.from("segments").update(read ? { shape: read.shape, duration_sec: Math.round(read.seconds) } : { shape: "" }).eq("audio_path", path).is("shape", null);
    } catch (err) {
      console.log("shape:", String(err));
    }
  }
}

// ---------- The cheaper, slower tier ----------
//
// OpenAI will do the same work with the same model for about half the price if it may take its
// time ("flex"). That suits stories prepared ahead for a listener who already has something to
// play, and nothing else. A slow or refused flex call is made again at once at the normal tier,
// and flex is then rested for half an hour, so a busy spell at OpenAI never holds stories back.
const FLEX_FLOOR = 2; // Stories a listener must already have ready before theirs are made on flex.
const FLEX_PATIENCE_MS = 150_000;
const FLEX_REST_MS = 30 * 60_000;

/** True when cheap, slow work is allowed right now. */
async function flexOpen(): Promise<boolean> {
  if ((await setting("flex", "off")) !== "on") return false;
  return Date.now() > Date.parse(await setting("flex_rest_until", "2000-01-01"));
}

async function restFlex(why: string) {
  console.log("flex rested:", why);
  mark({ flex: false });
  await service.from("settings").upsert({ key: "flex_rest_until", value: new Date(Date.now() + FLEX_REST_MS).toISOString() }).then(() => {}, () => {});
}

// ---------- OpenAI ----------

async function openaiProblem(step: string, res: Response): Promise<Problem> {
  let detail = await res.text();
  try {
    detail = JSON.parse(detail)?.error?.message ?? detail;
  } catch {
    // Keep the raw text.
  }
  return new Problem(502, `OpenAI failed while ${step}.`, `${res.status}: ${detail.slice(0, 500)}`);
}

/**
 * `once` marks a prompt that is never sent again, such as a story's plan. Writing a prompt to OpenAI's
 * cache costs a quarter more than not doing so, and only pays off when the same prompt comes back. So
 * for these the cache is turned off. If the model does not accept the setting, the call is made without it.
 */
async function ask(step: string, model: string, instructions: string, input: string, once = false): Promise<string> {
  const send = (extra: Record<string, unknown>, patience?: number) =>
    fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions, input, ...extra }),
      signal: patience ? AbortSignal.timeout(patience) : undefined,
    });
  const caching = once ? { prompt_cache_options: { mode: "explicit" } } : {};
  if (who.getStore()?.flex) {
    // Work nobody is waiting on. Any trouble at all, and it is done the normal way instead.
    try {
      const cheap = await send({ ...caching, service_tier: "flex" }, FLEX_PATIENCE_MS);
      if (cheap.ok) return await settle(step, model, await cheap.json());
      await restFlex(`${cheap.status} ${(await cheap.text()).slice(0, 200)}`);
    } catch (err) {
      if (err instanceof Problem) throw err;
      await restFlex(String(err));
    }
  }
  let res = await send(caching);
  if (once && res.status === 400) res = await send({});
  if (!res.ok) throw await openaiProblem(step, res);
  return await settle(step, model, await res.json());
}

/**
 * Starts a long model call on OpenAI's side and comes straight back with its id. The call is the
 * same one ask() would make. It simply is not waited for inside one request, because a request
 * that runs much over a minute can be cut off when its worker's time is up.
 */
async function askLater(step: string, model: string, instructions: string, input: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, instructions, input, background: true, store: true }),
  });
  if (!res.ok) throw await openaiProblem(step, res);
  const data = await res.json();
  if (typeof data.id !== "string") throw new Problem(502, `OpenAI did not start ${step}.`);
  return data.id;
}

/**
 * Collects a call started with askLater, waiting up to forty seconds for it. Null means it is
 * still running, or that another request got to the finished reply first. `claim` is asked once
 * the reply is in, so only one request pays attention to it and writes it to the ledger.
 */
async function collect(step: string, model: string, id: string, claim: () => Promise<boolean>): Promise<string | null> {
  for (let waited = 0; ; waited += 4000) {
    const res = await fetch(`https://api.openai.com/v1/responses/${id}`, { headers: { Authorization: `Bearer ${OPENAI_KEY}` } });
    if (!res.ok) throw await openaiProblem(step, res);
    const data = await res.json();
    if (data.status !== "queued" && data.status !== "in_progress") {
      if (data.status !== "completed") throw new Problem(502, `OpenAI did not finish ${step}.`, `${data.status} ${data.error?.message ?? data.incomplete_details?.reason ?? ""}`);
      return (await claim()) ? await settle(step, model, data) : null;
    }
    if (waited >= 40_000) return null;
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
}

/** Reads a finished model reply: writes it to the ledger and returns its text. */
async function settle(step: string, model: string, data: any): Promise<string> {
  // Every model call is written to the usage ledger, so cost is measured, not guessed. The
  // whole usage report is kept too, so anything it says about cache writes is not lost.
  const details = data.usage?.input_tokens_details ?? {};
  await record({
    kind: "text",
    step,
    model,
    input_tokens: data.usage?.input_tokens ?? 0,
    output_tokens: data.usage?.output_tokens ?? 0,
    cached_tokens: details.cached_tokens ?? 0,
    cache_write_tokens: details.cache_write_tokens ?? details.cache_creation_tokens ?? details.cache_write_30m_tokens ?? 0,
    // The tier is kept beside the usage, so flex work can be told apart and priced at its own rate.
    raw: data.usage ? { ...data.usage, service_tier: data.service_tier ?? null } : null,
  });
  let text = "";
  for (const item of data.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") text += part.text;
    }
  }
  if (!text.trim()) throw new Problem(502, `OpenAI returned nothing while ${step}.`);
  return text.trim();
}

/** Reads JSON out of a model reply, tolerating code fences or a stray sentence around it. */
function parseJson(step: string, text: string, open: string, close: string): unknown {
  const from = text.indexOf(open);
  const to = text.lastIndexOf(close);
  try {
    if (from === -1 || to <= from) throw new Error("no JSON found");
    return JSON.parse(text.slice(from, to + 1));
  } catch {
    throw new Problem(502, `The model's reply could not be read while ${step}.`, text.slice(0, 300));
  }
}

/** Asks for speech. The reply's body arrives piece by piece while the audio is generated. */
async function speech(text: string, voice: string, direction: string): Promise<Response> {
  if (isEleven(voice)) {
    // ElevenLabs takes no written direction. The voice itself carries the manner.
    const id = (await elevenVoices()).find((v) => v.name === voice)?.id ?? ELEVEN_VOICE_ID;
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${id}/stream?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": ELEVEN_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: await setting("eleven_model", ELEVEN_MODEL) }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400);
      // Out of credit, or the key no longer works: go back to the OpenAI narrator until someone looks.
      if (res.status === 401 || res.status === 402 || /quota|credit|payment/i.test(detail)) {
        await service.from("settings").upsert({ key: "narrator_engine", value: "openai" }).then(() => {}, () => {});
        await service.from("settings").upsert({ key: "narrator_engine_note", value: `${new Date().toISOString()} ElevenLabs refused: ${res.status} ${detail}`.slice(0, 500) }).then(() => {}, () => {});
      }
      throw new Problem(502, "ElevenLabs failed while voicing the chapter.", `${res.status}: ${detail}`);
    }
    return res;
  }
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: VOICE_MODEL, voice, input: text, instructions: direction, response_format: "mp3" }),
  });
  if (!res.ok) throw await openaiProblem("voicing the chapter", res);
  return res;
}

function chunkScript(script: string): string[] {
  const sentences = script.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [script];
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > CHUNK_CHARS) {
      chunks.push(current.trim());
      current = "";
    }
    current += sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function speakAll(script: string, voice: string, direction: string): Promise<Uint8Array> {
  const parts = await Promise.all(
    chunkScript(script).map(async (chunk) => new Uint8Array(await (await speech(chunk, voice, direction)).arrayBuffer())),
  );
  const joined = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

// ---------- Wikipedia ----------

type Source = { title: string; url: string; text: string };

async function wiki(params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams({ format: "json", formatversion: "2", ...params });
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${query}`, {
    headers: { "User-Agent": WIKI_AGENT, "Api-User-Agent": WIKI_AGENT },
  });
  if (!res.ok) throw new Problem(502, "Wikipedia could not be reached.", `${res.status}`);
  return await res.json();
}

/** Turns a guessed article name into a real page and its plain text, or null if there is none. */
async function readArticle(guess: string): Promise<Source | null> {
  const found = await wiki({ action: "query", list: "search", srsearch: guess, srlimit: "1" });
  const title = found?.query?.search?.[0]?.title;
  if (!title) return null;
  const page = await wiki({ action: "query", prop: "extracts", explaintext: "1", redirects: "1", titles: title });
  const hit = page?.query?.pages?.[0];
  const text = typeof hit?.extract === "string" ? hit.extract.trim() : "";
  if (text.length < 500) return null;
  return {
    title: hit.title,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
    text: text.slice(0, SOURCE_CHARS),
  };
}

async function readArticles(guesses: string[]): Promise<Source[]> {
  const results = await Promise.all(guesses.slice(0, MAX_SOURCES + 2).map((g) => readArticle(g).catch(() => null)));
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const source of results) {
    if (!source || seen.has(source.title)) continue;
    seen.add(source.title);
    sources.push(source);
  }
  return sources.slice(0, MAX_SOURCES);
}

// ---------- Preparing a topic ahead of time ----------

type Fact = { id: number; fact: string; source: string; status?: string };
type Story = Record<string, unknown>;

const STATUSES = ["fact", "account", "disputed", "hypothesis", "unknown"];

const notesFor = (facts: Fact[], ids: number[]) => facts.filter((f) => ids.includes(f.id));
// Each note goes to the writer with its standing, so a doubtful story is told as doubtful.
const noteLines = (notes: Fact[]) =>
  notes.map((f) => `- [${f.status ?? "fact"}] ${f.fact} (from ${f.source})`).join("\n") ||
  "- None given. Stay general and state no specific figures.";

function splitReply(reply: string): { script: string; summary: string } {
  const [scriptPart, summaryPart] = reply.split("===SUMMARY===");
  return { script: scriptPart.trim(), summary: (summaryPart ?? "").trim() };
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const WEIGHTS = ["signature", "supporting", "connective"];
const ENDINGS = ["revelation", "reversal", "consequence", "complication", "handoff", "question"];

/** Reads a chapter list out of a model's reply, keeping only note ids that exist. */
function toChapters(raw: unknown, facts: Fact[]): Chapter[] {
  const known = new Set(facts.map((f) => f.id));
  return (Array.isArray(raw) ? raw : [])
    .filter((c: any) => c && typeof c.title === "string" && c.title.trim())
    .slice(0, OUTLINE_CHAPTERS)
    .map((c: any, i: number) => {
      const situation = text(c.situation);
      const discovery = text(c.discovery);
      return {
        title: c.title.trim(),
        // One line on what the chapter is for, kept for anything that reads the older shape.
        brief: text(c.brief) || [situation, discovery].filter(Boolean).join(" "),
        fact_ids: [
          ...new Set<number>(
            [...(Array.isArray(c.fact_ids) ? c.fact_ids : []), ...(Array.isArray(c.beats) ? c.beats : []).flatMap((b: any) => (Array.isArray(b?.fact_ids) ? b.fact_ids : []))].map(Number),
          ),
        ].filter((id: number) => known.has(id)),
        // The opening is always one minute. Every other chapter runs two to four.
        minutes: i === 0 ? 1 : Math.max(2, Math.min(4, Math.round(Number(c.minutes) || 3))),
        priority: Math.max(1, Math.min(3, Math.round(Number(c.priority) || 2))),
        situation,
        development: text(c.development),
        discovery,
        turn: text(c.turn),
        matters: text(c.matters),
        transition: text(c.transition),
        tone: text(c.tone),
        // Only earlier chapters can be depended on. Numbers count from 1.
        needs: (Array.isArray(c.needs) ? c.needs : []).map(Number).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= i),
        short: text(c.short) || discovery,
        // Engine 2 only. Older plans have no beats and no named ending.
        beats: (Array.isArray(c.beats) ? c.beats : [])
          .filter((b: any) => b && text(b.beat))
          .slice(0, 8)
          .map((b: any) => ({
            beat: text(b.beat),
            weight: WEIGHTS.includes(b.weight) ? b.weight : "supporting",
            fact_ids: (Array.isArray(b.fact_ids) ? b.fact_ids : []).map(Number).filter((id: number) => known.has(id)),
          })),
        ending: ENDINGS.includes(c.ending) ? c.ending : "",
        ending_note: text(c.ending_note),
      };
    });
}

/** The blueprint as the writer sees it. Older chapters have only their one line brief. */
function blueprintLines(chapter: Chapter): string {
  if (!chapter.situation && !chapter.discovery) return `What it is for: ${chapter.brief}`;
  return [
    `Opens on: ${chapter.situation}`,
    `Develops through: ${chapter.development}`,
    `The discovery: ${chapter.discovery}`,
    `The turn: ${chapter.turn}`,
    `Why it matters: ${chapter.matters}`,
    chapter.tone ? `Tone: ${chapter.tone}` : "",
    // In a shorter lesson, beats from chapters that are not played are folded in here.
    (chapter as any).skipped?.length
      ? "This is a shorter telling, and the listener has NOT heard the following parts of the story. This chapter " +
        `depends on them, so work each one in, ${chapter.beats?.length ? "with the room its importance deserves" : "in a sentence or two"}, as a natural part of the telling and not as ` +
        `a recap:\n${(chapter as any).skipped.map((b: any) => `  - ${text(b?.short)}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The people the planner said matter, so every chapter introduces and recalls them the same way. */
const castLine = (story: Story): string => {
  const cast = (Array.isArray(story.cast) ? story.cast : [])
    .filter((c: any) => c && text(c.name))
    .slice(0, 8)
    .map((c: any) => `${text(c.name)} (${[text(c.role), text(c.tag)].filter(Boolean).join(": ")})`);
  return cast.length ? `\nCast: ${cast.join("; ")}` : "";
};

const storyLines = (story: Story | null | undefined, angle: string) =>
  story
    ? `The central question: ${text(story.central_curiosity) || angle}\nWhat makes it worth telling: ${text(story.core_fascination)}\n` +
      `The feel of the whole story: ${text(story.tone)}\nWhere it ends up: ${text(story.final_payoff)}` +
      (text(story.promise) ? `\nThe promise (a ${text(story.mode) || "focused"} story): ${text(story.promise)}` : "") +
      castLine(story)
    : `The angle: ${angle || "not stated"}`;

/**
 * The editorial review. One pass, and it can only make the plan better or leave it alone:
 * if the reviewer's reply cannot be used, the plan it was given stands.
 */
const reviewerBrief = (story: Story) =>
  story.engine === 2 ? REVIEWER_BRIEF.replace("Score the plan as you received it", REVIEWER_V2 + "Score the plan as you received it") : REVIEWER_BRIEF;
const reviewerInput = (story: Story, facts: Fact[], outline: Chapter[], title: string, hook: string) =>
  (story.engine === 2 && title ? `Title: ${title}\nHook: ${hook}\n\n` : "") + `Story discovery:\n${JSON.stringify(story)}\n\nResearch notes:\n${facts.map((f) => `${f.id}. [${f.status ?? "fact"}] ${f.fact}`).join("\n")}\n\n` +
  `Chapter blueprint:\n${JSON.stringify(outline)}`;

async function reviewPlan(story: Story, facts: Fact[], outline: Chapter[], title = "", hook = "", given?: string): Promise<{ outline: Chapter[]; review: Record<string, unknown>; title?: string; hook?: string }> {
  try {
    // A reply collected by an earlier request is used as it is. An empty one means the review could not be had.
    const reply = given ?? (await ask("reviewing the story plan", WRITER_MODEL, reviewerBrief(story), reviewerInput(story, facts, outline, title, hook), true));
    const verdict = parseJson("reviewing the story plan", reply, "{", "}") as Record<string, unknown>;
    const revised = toChapters(verdict.chapters, facts);
    const usable = revised.length >= 3 && revised.every((c) => c.fact_ids.length > 0);
    // A corrected title is taken only with the revised plan it was written for.
    const retitled = usable && story.engine === 2 ? text(verdict.title).slice(0, 80) : "";
    return {
      ...(retitled ? { title: retitled, hook: text(verdict.hook) || hook } : {}),
      outline: usable ? revised : outline,
      review: { scores: verdict.scores ?? null, problems: verdict.problems ?? [], changes: verdict.changes ?? [], ...(retitled ? { retitled_from: title } : {}), applied: usable, chapters_before: outline.length, chapters_after: usable ? revised.length : outline.length, first_draft: outline.map((c) => `${c.title} (${c.minutes} min)`) },
    };
  } catch (err) {
    return { outline, review: { applied: false, skipped: err instanceof Problem ? err.message : String(err) } };
  }
}

/**
 * The last gate before a script is recorded. Facts are checked against the notes, and the
 * delivery is checked for the ear. A script with a fact problem is always rewritten once.
 * One with only delivery problems is rewritten when there are several and time allows.
 * If the check itself fails, the script goes ahead: a checker fault must not stop a lesson.
 */
async function checkScript(
  script: string,
  summary: string,
  notes: Fact[],
  context: string,
  story: string,
  patient: boolean,
): Promise<{ script: string; summary: string; review: Record<string, unknown> }> {
  let facts: unknown[] = [];
  let delivery: unknown[] = [];
  try {
    const reply = await ask("checking the chapter", WRITER_MODEL, CHECKER_BRIEF, `Fact notes:\n${noteLines(notes)}\n\n${context}\n\nScript:\n${script}`);
    const verdict = parseJson("checking the chapter", reply, "{", "}") as Record<string, unknown>;
    facts = Array.isArray(verdict.facts) ? verdict.facts : [];
    delivery = Array.isArray(verdict.delivery) ? verdict.delivery : [];
  } catch (err) {
    return { script, summary, review: { checked: false, reason: err instanceof Problem ? err.message : String(err) } };
  }
  const review: Record<string, unknown> = { checked: true, facts, delivery, revised: false };
  if (facts.length === 0 && !(patient && delivery.length >= 2)) return { script, summary, review };
  try {
    const fixed = splitReply(
      await ask(
        "revising the chapter",
        WRITER_MODEL,
        writerBrief(story),
        `${context}\n\nFact notes:\n${noteLines(notes)}\n\nHere is your draft:\n${script}\n\n` +
          "An editor found these problems. Fix exactly these and change nothing else. Where a claim is not in the " +
          "notes, cut it or say only what the notes support. Keep the length the same or shorter.\n" +
          `Fact problems:\n${facts.map((f: any) => `- "${text(f?.claim)}": ${text(f?.problem)}`).join("\n") || "- none"}\n` +
          `Delivery problems:\n${delivery.map((d) => `- ${String(d)}`).join("\n") || "- none"}`,
      ),
    );
    if (fixed.script) return { script: fixed.script, summary: fixed.summary || summary, review: { ...review, revised: true } };
  } catch {
    // The revision failed. The draft stands, with its problems on record.
  }
  return { script, summary, review };
}

// ---------- Engine 2: writing a chapter from its beats ----------

const wordCount = (script: string) => script.split(/\s+/).filter(Boolean).length;

/** The beats as the writer and the checker see them, each with the notes it is told from. */
function beatLines(chapter: Chapter, notes: Fact[]): string {
  const used = new Set<number>();
  const lines = (chapter.beats ?? []).map((b, i) => {
    const mine = notesFor(notes, b.fact_ids ?? []);
    mine.forEach((f) => used.add(f.id));
    return `${i + 1}. [${b.weight}] ${b.beat}\n${mine.map((f) => `   - [${f.status ?? "fact"}] ${f.fact} (from ${f.source})`).join("\n") || "   - no notes of its own"}`;
  });
  const rest = notes.filter((f) => !used.has(f.id));
  return `Beats, in order:\n${lines.join("\n")}` + (rest.length ? `\n\nOther notes for this chapter:\n${noteLines(rest)}` : "");
}

const ENDING_LINES: Record<string, string> = {
  revelation: "End on the discovery itself. Make it the last thing heard, and stop.",
  reversal: "End on the reversal, stated plainly, and stop.",
  consequence: "End on a plain statement of what this led to.",
  complication: "End with the new problem left standing. State it. Do not ask it as a question.",
  handoff: "End by moving naturally toward the next development, in a statement. No teaser and no question.",
  question: "End on the one real question this leaves open, in a single line.",
};

/**
 * Writes one chapter the engine 2 way: a draft from the beats, one check of facts and of the
 * storytelling, one revision if anything significant was found or the draft came in well
 * under its length, then a second check of the revision. At most five model calls.
 */
async function writeChapter(o: {
  context: string;
  chapter: Chapter;
  notes: Fact[];
  covered: string;
  minutes: number;
  role: "opening" | "middle" | "last";
  /** The chapter straight after the opening, where a listener is most easily lost. */
  afterOpening?: boolean;
  /** The closing lines of the chapter before this one. */
  before?: string;
  houseStyle: string;
}): Promise<{ script: string; summary: string; review: Record<string, unknown> }> {
  // The range sits around the promised length, so a chapter that lands inside it runs about as long as promised.
  const [low, high] = o.role === "opening" ? [125, 160] : [Math.round(o.minutes * WORDS_PER_MINUTE * 0.9), Math.round(o.minutes * WORDS_PER_MINUTE * 1.15)];
  const WHOLE =
    "Hand back the whole chapter, and make sure it reads as one continuous telling when you are done: no sentence " +
    "left stranded on its own, no paragraph reduced to a single leftover fact, no reference to something you " +
    "removed, every transition intact, and the ending still landing the way it was meant to.";
  const material = beatLines(o.chapter, o.notes);
  const ending =
    o.role === "opening"
      ? "This is the opening: a one minute chapter of its own, and the first thing the listener hears. It is a hook " +
        "that delivers, not a teaser. No greeting and no introduction. The first two sentences are the " +
        "extraordinary concrete moment the blueprint opens on. Then just enough to follow it, then the discovery, " +
        "told in full, so that this minute is worth hearing even if the listener stops here. End by asking the " +
        "central question plainly. Do not list what is coming."
      : o.role === "last"
        ? "This is the last chapter. Answer the central question. The final one to three sentences are the strongest " +
          "supported conclusion of the whole story, tied back to the opening where that fits, and no secondary fact " +
          "comes after them. No summary of the lesson, no moral, no thanks, no 'history teaches us'."
        : `${ENDING_LINES[o.chapter.ending ?? ""] ?? ENDING_LINES.handoff}${o.chapter.ending_note ? ` Arrive at: ${o.chapter.ending_note}` : ""}`;
  // The last few sentences the listener heard, so this chapter can pick up from them.
  const join = o.before ? `The previous chapter's closing lines:\n${o.before}\n\n` : "";
  const frame =
    `${o.context}\n\nLength: ${low} to ${high} words.\n` +
    (o.role === "opening" ? "" : "This continues a story already under way. Do not greet the listener or reintroduce the subject. Pick up as the next part of the same telling.\n") +
    (o.afterOpening
      ? "The listener has just heard the one minute opening, summarized below under what is already covered. This is the moment they decide whether to stay. Do not retell the opening or describe its moment again. Start where it left off, and give them something new and striking within the first three sentences.\n"
      : "") +
    `${ending}\n\nAlready covered in earlier chapters:\n${o.covered || "Nothing yet."}\n\n${join}${material}`;
  const brief = writerBriefV2(o.houseStyle);

  const check = async (script: string) => {
    const reply = await ask("checking the chapter", WRITER_MODEL, CHECKER_V2, `${o.context}\n\nHow it should end: ${ending}\n${o.afterOpening ? "This is the chapter straight after the opening. If it retells the opening instead of moving on from it, list that as repetition.\n" : ""}Target length: ${low} to ${high} words.\n\nAlready covered in earlier chapters:\n${o.covered || "Nothing yet."}\n\n${join}${material}\n\nThis script is ${wordCount(script)} words.\n\nScript:\n${script}`);
    const verdict = parseJson("checking the chapter", reply, "{", "}") as Record<string, unknown>;
    return { facts: Array.isArray(verdict.facts) ? verdict.facts : [], editorial: Array.isArray(verdict.editorial) ? verdict.editorial : [] };
  };
  const factLines = (facts: unknown[]) => facts.map((f: any) => `- "${text(f?.claim)}": ${text(f?.problem)}`).join("\n") || "- none";

  let { script, summary } = splitReply(await ask("writing the chapter", WRITER_MODEL, brief, frame));
  const review: Record<string, unknown> = { engine: 2, target: [low, high], first_words: wordCount(script), checked: false, revised: false };
  try {
    const first = await check(script);
    review.checked = true;
    review.facts = first.facts;
    review.editorial = first.editorial;
    const under = wordCount(script) < low * 0.9;
    const over = wordCount(script) > high * 1.2;
    if (first.facts.length || first.editorial.length || under || over) {
      const fixed = splitReply(
        await ask(
          "revising the chapter",
          WRITER_MODEL,
          brief,
          `${frame}\n\nHere is your draft:\n${script}\n\nAn editor read it. Make the chapter better, not shorter, and leave what already works alone. ` +
            "Keep every signature beat fully told. Where the editor found repetition, padding or weak writing, do not simply delete: " +
            "put something better in its place, a detail or development from the notes that the draft has not used yet. " +
            `Only if the notes hold nothing more may a passage just go. ${WHOLE}\n` +
            `Fact problems, which must all be fixed by saying only what the notes support, and repairing the sentences around the change:\n${factLines(first.facts)}\n` +
            `Storytelling problems:\n${first.editorial.map((e: any) => `- ${text(e?.kind)}: "${text(e?.quote)}". ${text(e?.fix)}`).join("\n") || "- none"}\n` +
            (under
              ? `Length: the draft is ${wordCount(script)} words against ${low} to ${high}. Go back to the signature beats and look at their notes for what you passed over: the circumstances, the obstacle, the order things were found out, what followed. Tell those moments in full. Do not add anything that is not in the notes, and do not repeat or explain to fill space. If the notes hold nothing more worth telling, leave it short.\n`
              : over
                ? `Length: the draft is ${wordCount(script)} words against ${low} to ${high}. Cut the weakest material first.\n`
                : `Length: the draft is ${wordCount(script)} words. Do not hand back fewer.\n`),
        ),
      );
      // A revision that only made the chapter shorter, when nothing in it was untrue, is not an
      // improvement. The draft stands, with the editor's notes on record.
      const shrunk = !over && first.facts.length === 0 && wordCount(fixed.script) < wordCount(script) * 0.92;
      if (shrunk) review.kept_draft = true;
      if (fixed.script && !shrunk) {
        script = fixed.script;
        summary = fixed.summary || summary;
        review.revised = true;
        const second = await check(script);
        review.after = second;
        if (second.facts.length) {
          const safe = splitReply(await ask("correcting the chapter", WRITER_MODEL, brief, `${frame}\n\nHere is your draft:\n${script}\n\nThese claims are not supported by the notes. Correct each one so it says only what the notes support, or take it out. Then repair the passage around each change, rewriting the neighboring sentences as needed, so nothing is left broken. Change nothing else about the chapter. ${WHOLE}\n${factLines(second.facts)}`));
          // A correction that guts the chapter has broken it. Fall back to the revision before it.
          if (safe.script && wordCount(safe.script) >= wordCount(script) * 0.8) {
            script = safe.script;
            summary = safe.summary || summary;
            review.fact_fix = true;
          }
        }
      }
    }
  } catch (err) {
    // A fault in the checking must not stop a lesson. What was written so far stands.
    review.fault = err instanceof Problem ? err.message : String(err);
  }
  review.words = wordCount(script);
  review.minutes = Math.round((wordCount(script) / WORDS_PER_MINUTE) * 10) / 10;
  review.short = wordCount(script) < low * 0.9;
  return { script, summary, review };
}

/** The last two or three sentences of a script, for the next chapter to pick up from. */
function closing(script: unknown): string {
  const sentences = (typeof script === "string" ? script : "").replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+["')\]]*/g) ?? [];
  return sentences.slice(-3).join(" ").trim().slice(-420);
}

const chapterContext = (title: string, story: Story | null, angle: string, titles: string[], position: number, chapter: Chapter) =>
  `Lesson: ${title}\n${storyLines(story, angle)}\nChapters: ${titles.map((t, i) => `${i + 1}. ${t}`).join("; ")}\n\n` +
  `Chapter ${position}: "${chapter.title}"\n${blueprintLines(chapter)}`;

// The lengths offered for a story. The chapter after the opening is written ahead for each of them.
const SHORT_LENGTHS = [5, 10];

/**
 * Which chapters a telling of a given length plays, and how long each runs. The opening and the payoff
 * are always in. The middle is filled by priority, for as long as there is time.
 */
function telling(outline: Chapter[], minutes: number, engine2: boolean) {
  const { picked, lengths, bridges } = pickChapters(outline, minutes);
  // A chapter that is left out but depended on is carried by the chapter that needs it: its
  // essential beat and its notes go along, so the shorter story still holds together. A
  // chapter's lead-in to the next is kept only if that next chapter is really the next one played.
  const chosen = picked.map((i, k) => ({
    ...outline[i],
    fact_ids: [...new Set([...(outline[i].fact_ids ?? []), ...bridges[k].flatMap((j) => outline[j].fact_ids ?? [])])],
    transition: picked[k + 1] === i + 1 ? outline[i].transition ?? "" : "",
    skipped: bridges[k].map((j) => ({ title: outline[j].title, short: outline[j].short || outline[j].discovery || outline[j].brief })),
  }));
  if (engine2) {
    // A shorter telling should still fill the time that was asked for where the story allows.
    // Chapters carrying folded-in material have more to tell, so they get the spare minutes.
    let spare = Math.round(minutes) - lengths.reduce((sum, m) => sum + m, 0);
    for (let k = lengths.length - 1; k >= 1 && spare > 0; k--) {
      const room = Math.min(spare, bridges[k].length, 5 - lengths[k]);
      if (room > 0) {
        lengths[k] += room;
        spare -= room;
      }
    }
  }
  const total = lengths.reduce((sum, m) => sum + m, 0);
  // True when the chapter after the opening is the plan's own second chapter, untouched.
  const whole = picked[1] === 1 && bridges[1]?.length === 0 && lengths[1] === (outline[1].minutes ?? 0) && (picked[2] === 2 || outline.length === 2);
  // What the chapter after the opening is made of in this telling, so one written ahead is only used for the same thing.
  const mark = JSON.stringify([picked[1], lengths[1], bridges[1] ?? [], picked[2] ?? null, picked.length]);
  return { picked, lengths, bridges, chosen, total, whole, mark };
}

/** The short lengths for which a story's second chapter has still to be written ahead. */
function shortsToWrite(topic: any): number[] {
  if (topic.story?.engine !== 2 || !Array.isArray(topic.outline) || topic.outline.length < 3) return [];
  return SHORT_LENGTHS.filter((m) => {
    if (topic.story.seconds?.[String(m)]) return false;
    const plan = telling(topic.outline, m, true);
    return !plan.whole && plan.chosen.length >= 2;
  });
}

/** Writes ahead the chapter after the opening for one short length, where it carries folded-in material. */
async function writeShortSecond(topicId: string, minutes: number) {
  const { data: topic } = await db.from("topics").select().eq("id", topicId).maybeSingle();
  if (!topic || topic.status !== "ready" || topic.story?.engine !== 2) return;
  mark({ topic_id: topic.id });
  const plan = telling(topic.outline as Chapter[], minutes, true);
  const chapter = plan.chosen[1] as Chapter;
  const facts: Fact[] = topic.source_notes ?? [];
  let written: Record<string, unknown> = { script: "" };
  try {
    written = await writeChapter({
      context: chapterContext(topic.title, topic.story, topic.angle ?? "", plan.chosen.map((c) => c.title), 2, chapter),
      chapter,
      notes: notesFor(facts, chapter.fact_ids),
      covered: `Chapter 1, ${topic.outline[0].title}: ${topic.opening_summary || "the opening."}`,
      minutes: plan.lengths[1],
      role: plan.chosen.length === 2 ? "last" : "middle",
      afterOpening: true,
      before: closing(topic.opening_script),
      houseStyle: await setting("story_brief", STORY_BRIEF),
    });
  } catch {
    // Left marked as tried, so one bad chapter cannot hold up everything behind it. It is written when asked for.
  }
  // Read again before saving, so a chapter written for another length in the meantime is not lost.
  const { data: fresh } = await db.from("topics").select("story").eq("id", topic.id).maybeSingle();
  const story = fresh?.story ?? topic.story;
  await db.from("topics").update({ story: { ...story, seconds: { ...(story.seconds ?? {}), [String(minutes)]: { ...written, shape: plan.mark } } } }).eq("id", topic.id);
}

/**
 * Engine 2 writes the chapter after the opening ahead of time, for the whole-story telling,
 * so the most important handover in the story gets the full edit with no clock running.
 */
async function writeSecond(topicId: string) {
  const { data: topic } = await db.from("topics").select().eq("id", topicId).maybeSingle();
  if (!topic || topic.status !== "ready" || topic.story?.engine !== 2) throw new Problem(409, "That is not a ready topic made by engine 2.");
  if (topic.story.second?.script) return { title: topic.outline[1].title, ...topic.story.second };
  mark({ topic_id: topic.id });
  const outline: Chapter[] = topic.outline;
  const facts: Fact[] = topic.source_notes ?? [];
  const second = await writeChapter({
    context: chapterContext(topic.title, topic.story, topic.angle ?? "", outline.map((c) => c.title), 2, outline[1]),
    chapter: outline[1],
    notes: notesFor(facts, outline[1].fact_ids),
    covered: `Chapter 1, ${outline[0].title}: ${topic.opening_summary || "the opening."}`,
    minutes: outline[1].minutes ?? CHAPTER_MINUTES,
    role: outline.length === 2 ? "last" : "middle",
    afterOpening: true,
    before: closing(topic.opening_script),
    houseStyle: await setting("story_brief", STORY_BRIEF),
  });
  await db.from("topics").update({ story: { ...topic.story, second } }).eq("id", topic.id);
  return { title: outline[1].title, ...second };
}

/**
 * Step one of preparing a topic: read the sources and plan the story. Saves the research
 * notes, the story discovery and the first draft of the chapter blueprint, and marks the
 * topic "planned". Returns null if the subject turns out to be one already offered.
 */
async function planTopic(asked: string, proposed?: any, force = false, wanted?: number, later = false) {
  const began = Date.now();
  // New stories use the newer writer. Setting writer_engine to 1 in the settings table goes
  // back to the older one for stories planned from then on, with no redeploy.
  const engine = wanted ?? ((await setting("writer_engine", "2")) === "1" ? 1 : 2);
  let topic = proposed;
  if (!topic) {
    const { data, error } = await db.from("topics").insert({ asked, title: asked, status: "preparing", proposed_for: me() }).select().single();
    if (error) throw new Problem(500, "The topic could not be saved.", error.message);
    topic = data;
  }
  mark({ topic_id: topic.id });
  try {
    const houseStyle = await setting("story_brief", STORY_BRIEF);
    const guessesText = await ask("choosing what to read", SCOUT_MODEL, SCOUT_BRIEF, `Topic: ${asked}`);
    const guesses = (parseJson("choosing what to read", guessesText, "[", "]") as unknown[]).filter(
      (g): g is string => typeof g === "string",
    );
    const sources = await readArticles([...guesses, asked]);
    if (sources.length === 0) throw new Problem(502, "No Wikipedia articles could be found for that topic.");

    // The same subject can be proposed twice under different names ("Vasa", "Vasa (ship)").
    // Its main article gives it away, and this is caught before the costly planning step.
    if (!force) {
      const { data: others } = await db.from("topics").select("id, title, sources").neq("id", topic.id).in("status", ["ready", "hidden", "preparing"]).limit(400);
      const twin = (others ?? []).find((o: any) => o.sources?.[0]?.title === sources[0].title);
      if (twin) {
        await db.from("topics").update({ status: "hidden", stage: null, error: `The same subject as "${twin.title}".` }).eq("id", topic.id);
        return null;
      }
    }

    // Research notes, story discovery and the chapter blueprint, in one pass over the sources.
    const planInput = `Subject: ${asked}\n\n` + sources.map((s) => `=== ${s.title} ===\n${s.text}`).join("\n\n");
    if (later) {
      // The same single call, started on OpenAI's side. A later request collects it (see refill).
      const call = await askLater("planning the story", WRITER_MODEL, plannerBrief(houseStyle, engine), planInput);
      const { data: started } = await db
        .from("topics")
        .update({ status: "preparing", stage: "planning", sources: sources.map(({ title, url }) => ({ title, url })), review: { plan_call: call, plan_began: began, engine } })
        .eq("id", topic.id)
        .select()
        .single();
      return started;
    }
    const planText = await ask("planning the story", WRITER_MODEL, plannerBrief(houseStyle, engine), planInput, true);
    return await savePlan(topic, asked, planText, sources, engine, began);
  } catch (err) {
    const message = err instanceof Problem ? `${err.message} ${err.detail ?? ""}`.trim() : String(err);
    await db.from("topics").update({ status: "failed", stage: null, error: message.slice(0, 500) }).eq("id", topic.id);
    throw err;
  }
}

/** Turns the planner's reply into a saved plan, and marks the topic "planned". */
async function savePlan(topic: any, asked: string, planText: string, sources: { title: string; url: string }[], engine: number, began: number) {
  try {
    const plan = parseJson("planning the story", planText, "{", "}") as Record<string, unknown>;
    const facts: Fact[] = (Array.isArray(plan.facts) ? plan.facts : [])
      .filter((f: any) => f && typeof f.fact === "string" && Number.isFinite(Number(f.id)))
      .map((f: any) => ({ id: Number(f.id), fact: f.fact, source: String(f.source ?? ""), status: STATUSES.includes(f.status) ? f.status : "fact" }));
    const outline = toChapters(plan.chapters, facts);
    if (facts.length === 0 || outline.length < 3) {
      throw new Problem(502, "The story plan came back incomplete. Try again.", `facts ${facts.length}, chapters ${outline.length}`);
    }
    const story: Story = plan.story && typeof plan.story === "object" ? (plan.story as Story) : {};
    if (engine === 2) story.engine = 2;
    const { data: planned, error: saveError } = await db
      .from("topics")
      .update({
        title: text(plan.title) || asked,
        hook: text(plan.hook),
        angle: text(story.central_curiosity) || text(plan.angle),
        status: "preparing",
        stage: "planned",
        sources: sources.map(({ title, url }) => ({ title, url })),
        source_notes: facts,
        outline,
        story,
        review: { plan_seconds: Math.round((Date.now() - began) / 1000) },
      })
      .eq("id", topic.id)
      .select()
      .single();
    if (saveError) throw new Problem(500, "The story plan could not be saved.", saveError.message);
    return planned;
  } catch (err) {
    const message = err instanceof Problem ? `${err.message} ${err.detail ?? ""}`.trim() : String(err);
    await db.from("topics").update({ status: "failed", stage: null, error: message.slice(0, 500) }).eq("id", topic.id);
    throw err;
  }
}

/**
 * Step two: the editorial review of the plan, then the opening, written and checked. After
 * this the topic is ready, and starting a lesson from it only has to voice the opening.
 */
async function finishTopic(topic: any, reviewReply?: string) {
  const began = Date.now();
  mark({ topic_id: topic.id });
  try {
    const houseStyle = await setting("story_brief", STORY_BRIEF);
    const facts: Fact[] = Array.isArray(topic.source_notes) ? topic.source_notes : [];
    const story: Story = topic.story && typeof topic.story === "object" ? topic.story : {};
    const { outline, review, title: newTitle, hook: newHook } = await reviewPlan(story, facts, topic.outline as Chapter[], topic.title ?? "", topic.hook ?? "", reviewReply);
    if (newTitle) topic = { ...topic, title: newTitle, hook: newHook || topic.hook };
    story.recommended_minutes = fullMinutes(outline);

    const openingNotes = notesFor(facts, outline[0].fact_ids);
    const openingContext =
      `Lesson: ${topic.title}\n${storyLines(story, topic.angle ?? "")}\nChapters: ${outline.map((c, i) => `${i + 1}. ${c.title}`).join("; ")}\n\n` +
      `The opening: "${outline[0].title}"\n${blueprintLines(outline[0])}`;
    const draft = story.engine === 2 ? { script: "", summary: "" } : splitReply(
      await ask(
        "writing the opening",
        WRITER_MODEL,
        writerBrief(houseStyle),
        `${openingContext}\n` +
          `Length: up to about ${WORDS_PER_MINUTE} words, which is one minute read aloud.\n` +
          "This is the opening: a one minute chapter of its own, and the first thing the listener hears. It is " +
          "a hook that delivers, not a teaser. No greeting and no introduction. The first two sentences are the " +
          "extraordinary concrete moment the blueprint opens on. Then just enough to follow it, then the " +
          "discovery, told in full, so that this minute is worth hearing even if the listener stops here. End " +
          "by asking the central question plainly. Do not list what is coming.\n\n" +
          `Fact notes for the opening:\n${noteLines(openingNotes)}`,
      ),
    );
    const opening =
      story.engine === 2
        ? await writeChapter({ context: openingContext, chapter: outline[0], notes: openingNotes, covered: "", minutes: 1, role: "opening", houseStyle })
        : await checkScript(draft.script, draft.summary, openingNotes, openingContext, houseStyle, false);

    const { data: ready, error: saveError } = await db
      .from("topics")
      .update({
        status: "ready",
        stage: null,
        title: topic.title,
        hook: topic.hook,
        outline,
        story,
        review: { ...(topic.review ?? {}), ...review, opening: opening.review, finish_seconds: Math.round((Date.now() - began) / 1000) },
        opening_script: opening.script,
        opening_summary: opening.summary,
        prepared_at: new Date().toISOString(),
      })
      .eq("id", topic.id)
      .select()
      .single();
    if (saveError) throw new Problem(500, "The prepared topic could not be saved.", saveError.message);
    return describeTopic(ready);
  } catch (err) {
    const message = err instanceof Problem ? `${err.message} ${err.detail ?? ""}`.trim() : String(err);
    await db.from("topics").update({ status: "failed", stage: null, error: message.slice(0, 500) }).eq("id", topic.id);
    throw err;
  }
}

function describeTopic(topic: any) {
  const outline: Chapter[] = Array.isArray(topic.outline) ? topic.outline : [];
  return {
    id: topic.id,
    title: topic.title,
    hook: topic.hook,
    // The interest this topic grew out of. "Off the map" marks a wildcard.
    tag: topic.tag ?? null,
    // Whether it was made from this person's interests, or is a shared story filling the screen.
    for_you: topic._rank !== undefined && topic._rank < 2,
    sources: topic.sources,
    fact_count: Array.isArray(topic.source_notes) ? topic.source_notes.length : 0,
    chapters: outline.map((c) => c.title),
    // A blueprint knows how long the whole story runs. Older plans only know their chapter count.
    max_minutes: Math.min(MAX_MINUTES, isBlueprint(outline) ? fullMinutes(outline) : 1 + (outline.length - 1) * CHAPTER_MINUTES),
    // The length at which the whole story is told. Shorter lessons leave out middle chapters.
    recommended_minutes: isBlueprint(outline) ? Math.min(MAX_MINUTES, fullMinutes(outline)) : null,
    story: topic.story ?? null,
    review: topic.review ?? null,
    blueprint: isBlueprint(outline) ? outline : null,
  };
}

/** Prepared topics that have never been started. Once a topic is played it lives in the Library. */
async function unplayedTopics(): Promise<any[]> {
  // Stories are shared, but which ones a person has played or swiped away is their own. Read
  // as that person, the lessons and dismissals that come back are only theirs.
  const { data } = await mine().from("topics").select("*, lessons(id, user_id), dismissals(topic_id, user_id)").eq("status", "ready").order("prepared_at", { ascending: false }).limit(60);
  // The scheduled job reads on a person's behalf without their pass, so "theirs" is also checked here by name.
  const theirs = (rows: any[] | null) => (rows ?? []).filter((r: any) => !me() || r.user_id === me());
  const open = (data ?? []).filter((t: any) => theirs(t.lessons).length === 0 && theirs(t.dismissals).length === 0);
  if (!me()) return open;
  // Stories thought up for this person come first, then ones that match their interests, then the rest.
  const { data: tags } = await db.from("interests").select("label").eq("hidden", false).eq("user_id", me());
  const labels = new Set((tags ?? []).map((t: any) => String(t.label).toLowerCase()));
  // Someone new is shown the starter stories early: they are finished, so they start at once and cost nothing.
  const { count: heard } = await db.from("lessons").select("id", { count: "exact", head: true }).eq("user_id", me());
  const fresh = (heard ?? 0) < 3;
  const rank = (t: any) => (t.proposed_for === me() ? 0 : fresh && t.starter ? 0.5 : labels.has(String(t.tag ?? "").toLowerCase()) ? 1 : 2);
  return open
    .map((t: any, i: number) => ({ t: { ...t, _rank: rank(t) }, i }))
    .sort((a: any, b: any) => a.t._rank - b.t._rank || a.i - b.i)
    .map((x: any) => x.t);
}

async function listTopics() {
  return { topics: (await unplayedTopics()).slice(0, 6).map(describeTopic) };
}

// ---------- Interests and topic suggestions ----------

const MAX_TAGS = 10;
// How many prepared topics Pliny keeps waiting, so there is always something that starts at once.
const READY_TARGET = 3;
// How many stories made from a person's own interests are kept ready or on their way. The
// rest of their Listen screen is filled from stories already made for others.
const OWN_TARGET = 1;
// The reserve: how many finished stories a listener has not heard yet are kept available to them by
// the scheduled job, with the app closed. Most come from the shared catalog. New ones are made only
// when the catalog runs short for that person.
const RESERVE = 6;
// At most this many new stories are made for one person in a day, however fast they swipe.
const DAILY_NEW = 10;
// At most this many stories are being prepared at once, across everyone.
const SIDE_BY_SIDE = 3;
// How many ideas are kept on offer in Explore for each listener. Ideas cost almost nothing to think up.
const IDEAS_KEPT = 40;
// How many of a person's queued stories may be made or waiting unheard at once, and how many are made in a day.
const QUEUE_WAITING = 3;
const QUEUE_PER_DAY = 10;

/**
 * The scheduled job. Once a minute it does one piece of preparation for whichever recently active
 * listener is short of stories. No phone is involved. Setting "reserve" to "off" in the settings
 * table stops it at once, with no redeploy.
 */
async function tick() {
  if ((await setting("reserve", "on")) === "off") return;
  await shapeOld().catch(() => {});
  const secret = await setting("cron_secret", "");
  const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const day = new Date(Date.now() - 86_400_000).toISOString();
  // Recently active: listened in the last week, or joined in the last two days.
  const { data: heard } = await service.from("lessons").select("user_id").gt("started_at", week).limit(2000);
  const ids = new Set<string>((heard ?? []).map((l: any) => l.user_id).filter(Boolean));
  const { data: joined } = await service.auth.admin.listUsers({ page: 1, perPage: 200 }).catch(() => ({ data: null as any }));
  for (const u of joined?.users ?? []) if (Date.now() - Date.parse(u.created_at) < 2 * 86_400_000) ids.add(u.id);
  // Anyone who has asked for a story in Explore is served, however long since they last listened.
  const { data: asking } = await service.from("topics").select("proposed_for").eq("status", "proposed").not("queued_at", "is", null).limit(200);
  for (const t of asking ?? []) if (t.proposed_for) ids.add(t.proposed_for);
  const think = (id: string, fill: boolean) =>
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/shelf`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: allowedKeys()[0] ?? "", "x-pliny-cron": secret },
      body: JSON.stringify({ action: "propose", as_user: id, fill }),
    }).catch(() => null);

  for (const id of ids) {
    const { count: made } = await service.from("topics").select("id", { count: "exact", head: true }).eq("proposed_for", id).gt("proposed_at", day).in("status", ["ready", "preparing", "failed"]);
    const seat: Record<string, unknown> = { user_id: id, client: service, reserve: true, capped: (made ?? 0) >= DAILY_NEW };
    // Keep Explore stocked with ideas for this person.
    // Only ideas for interests they still have are counted, since those are the only ones Explore
    // shows. Counting the rest left Explore nearly empty after someone changed all their interests.
    const { data: theirTags } = await service.from("interests").select("label").eq("user_id", id).eq("hidden", false);
    const kept = new Set<string>((theirTags ?? []).map((t: any) => String(t.label).toLowerCase()));
    const { data: waiting } = await service.from("topics").select("tag").eq("proposed_for", id).eq("status", "proposed").is("queued_at", null).limit(400);
    const have = (waiting ?? []).filter((t: any) => !t.tag || t.tag === "Off the map" || kept.has(String(t.tag).toLowerCase())).length;
    if (have < IDEAS_KEPT) await think(id, true);
    await who.run(seat, async () => {
      try {
        let step: any = await refill();
        if (step?.needs_proposals && !seat.capped) {
          // No idea is waiting for this person. Think some up as them, then try again.
          await think(id, false);
          step = await refill();
        }
      } catch (err) {
        console.log("tick:", err instanceof Problem ? `${err.message} ${err.detail ?? ""}` : String(err));
      }
    });
    // One piece of real work per run. The next run, a minute later, takes the next piece.
    if (seat.worked) return;
  }
  // With nobody short of stories, the starter stories are finished, a chapter at a time.
  await starterStep().catch((err) => console.log("starter:", err instanceof Problem ? `${err.message} ${err.detail ?? ""}` : String(err)));
}

/**
 * Starter stories are a few of the best, marked by hand. Each is written and recorded to the end at
 * the short lengths, once. After that anyone who picks one gets the finished recordings at no cost,
 * so a new listener's first stories start at once. One chapter is made per run. True if one was.
 */
async function starterStep(): Promise<boolean> {
  const owner = await setting("starter_owner", "");
  if (!isId(owner)) return false;
  const { data: topics } = await service.from("topics").select("id, outline, story").eq("starter", true).eq("status", "ready").order("prepared_at").limit(20);
  for (const topic of topics ?? []) {
    const outline = topic.outline as Chapter[];
    if (!Array.isArray(outline) || outline.length < 2) continue;
    for (const minutes of SHORT_LENGTHS) {
      const plan = telling(outline, minutes, topic.story?.engine === 2);
      const { data: made } = await service.from("lessons").select("id, segments(position, status)").eq("topic_id", topic.id).eq("chosen_minutes", plan.total).limit(12);
      if ((made ?? []).some((l: any) => l.segments.length === plan.chosen.length && l.segments.every((s: any) => s.status === "ready"))) continue;
      let did = false;
      // Nobody is waiting on a starter story, so it is always made the cheap, slow way when that is open.
      const flex = await flexOpen();
      await who.run({ user_id: owner, client: service, reserve: true, flex }, async () => {
        const lesson = await start(topic.id, minutes);
        // One made only for this is kept out of the owner's History.
        if ((made ?? []).length === 0) await service.from("lessons").update({ hidden: true }).eq("id", lesson.id);
        const next = lesson.segments.find((s: any) => s.status !== "ready");
        if (next) {
          await makeSegment(lesson.id, next.position);
          did = true;
        }
      });
      if (did) return true;
    }
  }
  return false;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0) : []);

async function listInterests() {
  const { data } = await db.from("interests").select("id, label").eq("hidden", false).order("created_at");
  const interests = data ?? [];
  const have = new Set(interests.map((t) => t.label.toLowerCase()));
  let suggestions: string[] = [];
  try {
    const { data: kept } = await db.from("user_settings").select("value").eq("key", "interest_suggestions").limit(1).maybeSingle();
    suggestions = strings(JSON.parse(typeof kept?.value === "string" ? kept.value : "[]"));
  } catch {
    // Nothing usable saved. Show no suggestions.
  }
  return { interests, suggestions: suggestions.filter((s) => !have.has(s.toLowerCase())).slice(0, 4), max: MAX_TAGS };
}

async function refreshSuggestions() {
  const { data } = await db.from("interests").select("label").eq("hidden", false);
  const labels = (data ?? []).map((t) => t.label);
  if (labels.length === 0 || !OPENAI_KEY) return;
  try {
    const reply = await ask("suggesting interests", SCOUT_MODEL, SUGGEST_BRIEF, `Tags: ${labels.join(", ")}`);
    const list = strings(parseJson("suggesting interests", reply, "[", "]")).slice(0, 6);
    await db.from("user_settings").upsert({ key: "interest_suggestions", value: JSON.stringify(list), updated_at: new Date().toISOString() }, { onConflict: "user_id,key" });
  } catch {
    // Suggestions are a nicety. The tags themselves are already saved.
  }
}

/** Saves several tags in one go, for a new person's first picks. Suggestions are worked out afterward, not waited for. */
async function addInterests(labels: string[]) {
  const { data: all } = await db.from("interests").select("id, label, hidden");
  const have = all ?? [];
  let room = MAX_TAGS - have.filter((t: any) => !t.hidden).length;
  const fresh: { label: string }[] = [];
  for (const label of labels) {
    const same = have.find((t: any) => t.label.toLowerCase() === label.toLowerCase());
    if ((same && !same.hidden) || fresh.some((f) => f.label.toLowerCase() === label.toLowerCase())) continue;
    if (room <= 0) break;
    room--;
    if (same) await db.from("interests").update({ hidden: false }).eq("id", same.id);
    else fresh.push({ label });
  }
  if (fresh.length) {
    const { error } = await db.from("interests").insert(fresh);
    if (error) throw new Problem(500, "The tags could not be saved.", error.message);
  }
  EdgeRuntime.waitUntil(refreshSuggestions());
  return await listInterests();
}

async function addInterest(label: string) {
  const { data: all } = await db.from("interests").select("id, label, hidden");
  const same = (all ?? []).find((t) => t.label.toLowerCase() === label.toLowerCase());
  if (same && !same.hidden) return await listInterests();
  if ((all ?? []).filter((t) => !t.hidden).length >= MAX_TAGS) throw new Problem(400, `You can have up to ${MAX_TAGS} tags. Remove one first.`);
  const { error } = same ? await db.from("interests").update({ hidden: false }).eq("id", same.id) : await db.from("interests").insert({ label });
  if (error) throw new Problem(500, "The tag could not be saved.", error.message);
  await refreshSuggestions();
  return await listInterests();
}

async function removeInterest(id: string) {
  // Hidden, not deleted, so anything learned about the tag is kept.
  await db.from("interests").update({ hidden: true }).eq("id", id);
  await refreshSuggestions();
  return await listInterests();
}

/**
 * Does the next step toward keeping three topics waiting, one step per call, because each
 * step takes about a minute. A step is either planning a proposed topic or finishing a
 * planned one. Topics are proposed by the shelf function, which knows the listener's taste.
 * The app calls this quietly, again and again, while the Listen screen is open.
 *
 * `working` tells the caller whether calling again will get anywhere.
 */
async function refill() {
  // A step that never came back was cut off. Clear it out so it is not counted as under way.
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  const { data: cut } = await db.from("topics").select("id, stage, review").eq("status", "preparing").or("stage.is.null,stage.eq.finishing").lt("proposed_at", stale);
  for (const t of cut ?? []) {
    // A story cut off while being finished still has its plan, which was paid for. It gets one more go.
    if (t.stage === "finishing" && !t.review?.requeued) {
      await db.from("topics").update({ stage: "planned", review: { ...(t.review ?? {}), requeued: true } }).eq("id", t.id).eq("stage", "finishing");
    } else {
      await db.from("topics").update({ status: "failed", stage: null, error: "Preparing took too long and was stopped." }).eq("id", t.id).eq("status", "preparing");
    }
  }

  const unplayed = await unplayedTopics();
  const ready = unplayed.length;
  // Stories made ahead by the scheduler go the cheap, slow way, but only for someone who already
  // has enough to listen to. A short shelf is always filled at full speed.
  if (who.getStore()?.reserve && ready >= FLEX_FLOOR && (await flexOpen())) mark({ flex: true });

  // The two long model calls, the plan and its review, run on OpenAI's side. Collect one that is under way.
  const { data: running } = await db.from("topics").select().eq("status", "preparing").in("stage", ["planning", "reviewing"]).order("proposed_at").limit(1).maybeSingle();
  if (running) {
    const planning = running.stage === "planning";
    const step = planning ? "planning the story" : "reviewing the story plan";
    const call = planning ? running.review?.plan_call : running.review?.review_call;
    const began = Number(planning ? running.review?.plan_began : running.review?.review_began) || 0;
    // Whoever collects the reply takes the topic on to its next stage, so it is only handled once.
    const take = async () => {
      const { data } = await db
        .from("topics")
        .update({ stage: planning ? null : "finishing", proposed_at: new Date().toISOString() })
        .eq("id", running.id)
        .eq("stage", running.stage)
        .select()
        .maybeSingle();
      return Boolean(data);
    };
    mark({ topic_id: running.id });
    let reply: string | null = null;
    let lost = "";
    try {
      reply = await collect(step, WRITER_MODEL, String(call), take);
      // Five minutes is far longer than either call takes. One still running then is stuck.
      if (reply === null && Date.now() - began > 5 * 60 * 1000) lost = "It took too long and was stopped.";
    } catch (err) {
      lost = err instanceof Problem ? `${err.message} ${err.detail ?? ""}`.trim() : String(err);
    }
    if (planning) {
      if (lost) await db.from("topics").update({ status: "failed", stage: null, error: lost.slice(0, 500) }).eq("id", running.id).eq("stage", "planning");
      else if (reply !== null) await savePlan(running, running.asked ?? running.title, reply, running.sources ?? [], Number(running.review?.engine) || 2, began).catch(() => null);
      return { ready, prepared: null, working: true };
    }
    // A review that could not be had does not stop the story: the plan stands as it was written.
    if (lost && !(await take())) return { ready, prepared: null, working: true };
    if (!lost && reply === null) return { ready, prepared: null, working: true };
    return { ready: ready + 1, prepared: await finishTopic({ ...running, stage: "finishing" }, lost ? "" : reply ?? ""), working: true };
  }

  // A topic that is planned and waiting gets finished before anything new is begun.
  const { data: planned } = await db.from("topics").select().eq("status", "preparing").eq("stage", "planned").order("proposed_at").limit(1).maybeSingle();
  if (planned) {
    const story: Story = planned.story && typeof planned.story === "object" ? planned.story : {};
    const facts: Fact[] = Array.isArray(planned.source_notes) ? planned.source_notes : [];
    const { data: mine } = await db
      .from("topics")
      .update({ stage: "finishing", proposed_at: new Date().toISOString() })
      .eq("id", planned.id)
      .eq("stage", "planned")
      .select()
      .maybeSingle();
    if (!mine) return { ready, prepared: null, working: true };
    // Measured on 23 Nov: run on OpenAI's side, the plan took 270 seconds against about 100 done directly.
    // So both long calls are made directly again, and the "prepare" function gives them a fresh worker.
    // Setting plan_mode to "later" in the settings table goes back to OpenAI's side, with no redeploy.
    mark({ worked: true });
    if ((await setting("plan_mode", "direct")) !== "later") return { ready: ready + 1, prepared: await finishTopic(mine), working: true };
    try {
      // Start the review on OpenAI's side. The next request collects it and writes the opening.
      mark({ topic_id: mine.id });
      const call = await askLater("reviewing the story plan", WRITER_MODEL, reviewerBrief(story), reviewerInput(story, facts, mine.outline as Chapter[], mine.title ?? "", mine.hook ?? ""));
      await db.from("topics").update({ stage: "reviewing", review: { ...(mine.review ?? {}), review_call: call, review_began: Date.now() } }).eq("id", mine.id);
      return { ready, prepared: null, working: true };
    } catch {
      // If it cannot be started that way, do it the old way, in this request.
      return { ready: ready + 1, prepared: await finishTopic(mine), working: true };
    }
  }

  // A ready story made by the newer writer gets its second chapter written ahead, one story per
  // call. If the listener starts it first, that chapter is simply written when it is asked for.
  const reserve = Boolean((who.getStore() as any)?.reserve);
  const want = reserve ? RESERVE : READY_TARGET;
  // For the reserve, only the stories this person would be shown get their next chapter written ahead.
  const waiting = (reserve ? unplayed.slice(0, RESERVE) : unplayed).find((t: any) => t.story?.engine === 2 && !t.story.second);
  // The short lengths come next: their second chapter carries folded-in material and is the slowest to
  // write, which is what left silence after the opening. Only the scheduled job does this.
  const short = !waiting && reserve ? unplayed.slice(0, RESERVE).find((t: any) => shortsToWrite(t).length > 0) : null;
  if (short) {
    mark({ worked: true });
    await writeShortSecond(short.id, shortsToWrite(short)[0]);
    return { ready, prepared: null, working: true };
  }
  if (waiting) {
    mark({ worked: true });
    try {
      await writeSecond(waiting.id);
    } catch {
      // Marked as tried, so one bad chapter cannot hold up everything behind it.
      await db.from("topics").update({ story: { ...waiting.story, second: { script: "" } } }).eq("id", waiting.id);
    }
    return { ready, prepared: null, working: true };
  }

  // A story this person asked for in Explore is made whether or not their reserve is full.
  if (reserve && me()) {
    const { data: asked } = await db.from("topics").select().eq("status", "proposed").eq("proposed_for", me()).not("queued_at", "is", null).order("queued_at").limit(1).maybeSingle();
    // The queue is a list of wishes, made a few at a time: at most QUEUE_WAITING of a person's queued stories
    // are being made or waiting unheard at once, and at most QUEUE_PER_DAY are made in a day.
    let room = false;
    if (asked) {
      const { data: theirs } = await db.from("topics").select("id, status, proposed_at, lessons(id, user_id), dismissals(topic_id, user_id)").eq("proposed_for", me()).not("queued_at", "is", null).in("status", ["preparing", "ready"]);
      const own = (rows: any[] | null) => (rows ?? []).filter((r: any) => r.user_id === me());
      const waiting = (theirs ?? []).filter((t: any) => t.status !== "ready" || (own(t.lessons).length === 0 && own(t.dismissals).length === 0)).length;
      const today = (theirs ?? []).filter((t: any) => Date.parse(t.proposed_at) > Date.now() - 86_400_000).length;
      room = waiting < QUEUE_WAITING && today < QUEUE_PER_DAY;
    }
    if (asked && room) {
      const { count: busy } = await db.from("topics").select("id", { count: "exact", head: true }).eq("status", "preparing");
      if ((busy ?? 0) >= SIDE_BY_SIDE) return { ready, prepared: null, working: true };
      const { data: taken } = await db.from("topics").update({ status: "preparing", stage: null, proposed_at: new Date().toISOString() }).eq("id", asked.id).eq("status", "proposed").select().maybeSingle();
      if (taken) {
        mark({ worked: true });
        await planTopic(taken.asked, taken, false, undefined, (await setting("plan_mode", "direct")) === "later");
      }
      return { ready, prepared: null, working: true };
    }
  }

  // Only this person's own stories in progress count. Someone else's are not on their way to this screen.
  let preparing = db.from("topics").select("id", { count: "exact", head: true }).eq("status", "preparing");
  if (me()) preparing = preparing.eq("proposed_for", me());
  const { count } = await preparing;
  // Shared stories fill the screen, but they do not count toward this person's own three:
  // only stories thought up for them, or matching their interests, do.
  const readyMine = unplayed.filter((t: any) => t._rank === undefined || t._rank < 2).length;
  // Enough means both: at least one story of their own, and a full screen of three. Shared
  // stories fill the screen where there are some. Where there are not, more of their own are made.
  const enough = me() ? readyMine + (count ?? 0) >= OWN_TARGET && ready + (count ?? 0) >= want : ready + (count ?? 0) >= want;
  if (enough) return { ready, prepared: null, working: (count ?? 0) > 0 };

  if (reserve) {
    // The day's ceiling for this person, and the limit on how much is prepared at once for everyone.
    if ((who.getStore() as any)?.capped) return { ready, prepared: null, working: false };
    const { count: busy } = await db.from("topics").select("id", { count: "exact", head: true }).eq("status", "preparing");
    if ((busy ?? 0) >= SIDE_BY_SIDE) return { ready, prepared: null, working: true };
  }
  // Ideas thought up for this person come first. Ones thought up for someone else are theirs to prepare.
  const { data: ideas } = await db.from("topics").select().eq("status", "proposed").order("proposed_at").limit(30);
  // Of this person's ideas, the oldest goes first. One they asked for by name was already taken care of above.
  const next = (ideas ?? []).find((t: any) => t.proposed_for === me() && !t.queued_at) ?? null;
  if (!next) return { ready, prepared: null, working: false, needs_proposals: true };

  // Claim it, so two calls at once cannot both pay to plan the same topic.
  const { data: claimed } = await db
    .from("topics")
    .update({ status: "preparing", stage: null, proposed_at: new Date().toISOString() })
    .eq("id", next.id)
    .eq("status", "proposed")
    .select()
    .maybeSingle();
  if (!claimed) return { ready, prepared: null, working: true };
  mark({ worked: true });
  await planTopic(claimed.asked, claimed, false, undefined, (await setting("plan_mode", "direct")) === "later");
  return { ready, prepared: null, working: true };
}

/** Lessons that have at least one chapter made, newest first. This is what the Library shows. */
async function listLessons() {
  const { data } = await db
    .from("lessons")
    .select("id, title, chosen_minutes, started_at, segments(position, status)")
    .order("started_at", { ascending: false })
    .limit(40);
  const lessons = (data ?? [])
    .map((l: any) => ({
      id: l.id,
      title: l.title,
      chosen_minutes: l.chosen_minutes,
      started_at: l.started_at,
      chapters: l.segments.length,
      made: l.segments.filter((s: any) => s.status === "ready").length,
    }))
    .filter((l) => l.made > 0);
  return { lessons };
}

// ---------- Starting a lesson ----------

async function start(topicId: string, minutes: number) {
  const { data: topic } = await db.from("topics").select().eq("id", topicId).maybeSingle();
  if (!topic) throw new Problem(404, "No topic with that id.");
  if (topic.status !== "ready") throw new Problem(409, `That topic is not ready yet. It is "${topic.status}".`);
  const outline: Chapter[] = topic.outline;

  // The opening and the payoff are always in. The middle is filled by priority, for as long
  // as there is time. A lesson is never stretched past the story it has.
  const engine2 = topic.story?.engine === 2;
  const { picked, lengths, bridges, chosen, total, whole, mark: shape } = telling(outline, minutes, engine2);
  // The chapter after the opening is written ahead: once for the whole story, and once for each of the
  // short lengths, where it carries folded-in material and takes longest to write. It is used when this
  // telling plays exactly the chapter that was written.
  const ahead = topic.story?.seconds?.[String(Math.round(minutes))];
  const second = !engine2 ? null : whole && topic.story.second?.script ? topic.story.second : ahead?.script && ahead.shape === shape ? ahead : null;

  // The same topic at the same length is the same lesson. Hand back the one that exists,
  // so its saved audio is reused and nothing is paid for twice.
  const { data: existing } = await db
    .from("lessons")
    .select("id")
    .eq("topic_id", topic.id)
    .eq("chosen_minutes", total)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return await get(existing.id);

  // Someone else may already have heard this story at this length. Their chapters are the same
  // chapters, written from the same plan and read by the same narrator, so the finished ones are
  // lent to this listener: nothing is written or recorded twice. Chapters are written in order, each
  // knowing what came before, so only an unbroken run from the start is lent.
  const voiceNow = (await narrator(me())).voice;
  // With several voices on trial, a story recorded in any of them can be lent. It stays in that voice.
  const lendable = new Set<string>(isEleven(voiceNow) ? (await elevenVoices()).map((v) => v.name) : []);
  const { data: heardBefore } = await service
    .from("lessons")
    .select("id, segments(position, title, target_minutes, script, summary, review, writer_model, source_refs, status, audio_path, voice, voice_model, duration_sec, shape)")
    .eq("topic_id", topic.id)
    .eq("chosen_minutes", total)
    .order("started_at", { ascending: false })
    .limit(8);
  let lent: any[] = [];
  for (const other of heardBefore ?? []) {
    const theirs = [...(other.segments ?? [])].sort((a: any, b: any) => a.position - b.position);
    if (theirs.length !== lengths.length) continue;
    const run: any[] = [];
    for (const s of theirs) {
      if (s.position !== run.length + 1 || s.status !== "ready" || !s.audio_path || !s.script || !(run.length ? s.voice === run[0].voice : s.voice === voiceNow || s.voice === "cedar" || lendable.has(s.voice)) || s.title !== chosen[run.length].title) break;
      run.push(s);
    }
    if (run.length > lent.length) lent = run;
  }

  // The opening is the same whatever length is chosen. If it has been voiced before, for a
  // lesson of another length, that recording is used again.
  const { data: voiced } = await db
    .from("segments")
    .select("audio_path, voice, voice_model, lessons!inner(topic_id)")
    .eq("position", 1)
    .eq("status", "ready")
    .eq("lessons.topic_id", topic.id)
    .limit(1)
    .maybeSingle();

  const { data: lesson, error: lessonError } = await db
    .from("lessons")
    .insert({
      topic_id: topic.id,
      topic: topic.asked,
      title: topic.title,
      chosen_minutes: total,
      angle: topic.angle,
      story: topic.story ?? null,
      source_notes: topic.source_notes,
      sources: topic.sources,
      covered_summary:
        lent.length > 1
          ? lent.map((s: any) => `Chapter ${s.position}, ${s.title}: ${s.summary || "no summary given."}`).join("\n")
          : `Chapter 1, ${outline[0].title}: ${topic.opening_summary || "the opening."}` + (second ? `\nChapter 2, ${chosen[1].title}: ${second.summary || "no summary given."}` : ""),
      writer_model: WRITER_MODEL,
      // Named outright for the scheduled job, which works on a person's behalf without their pass.
      ...(me() ? { user_id: me() } : {}),
    })
    .select()
    .single();
  if (lessonError) throw new Problem(500, "The lesson could not be saved.", lessonError.message);

  const sourcesByTitle = new Map<string, any>((topic.sources ?? []).map((s: any) => [s.title, s]));
  const openingRefs = [...new Set(notesFor(topic.source_notes, outline[0].fact_ids).map((f) => f.source))].map(
    (t) => sourcesByTitle.get(t) ?? { title: t },
  );
  // The opening arrives already written. Every row carries the same fields, filled or
  // empty, because rows saved together in one request must all have the same shape.
  const rows = lengths.map((target_minutes, i) => lent[i] ? ({
    lesson_id: lesson.id,
    position: i + 1,
    title: chosen[i].title,
    target_minutes: lent[i].target_minutes,
    brief: chosen[i].brief,
    fact_ids: chosen[i].fact_ids,
    blueprint: chosen[i],
    script: lent[i].script,
    summary: lent[i].summary,
    review: lent[i].review,
    writer_model: lent[i].writer_model,
    source_refs: lent[i].source_refs ?? [],
    status: "ready",
    audio_path: lent[i].audio_path,
    voice: lent[i].voice,
    voice_model: lent[i].voice_model,
    shape: lent[i].shape ?? null,
    duration_sec: lent[i].duration_sec ?? null,
    ready_at: new Date().toISOString(),
  }) : ({
    lesson_id: lesson.id,
    position: i + 1,
    title: chosen[i].title,
    // A chapter that is already written is listed at its real length.
    target_minutes: i === 1 && second ? Math.max(1, Math.round(wordCount(second.script) / WORDS_PER_MINUTE)) : target_minutes,
    brief: chosen[i].brief,
    fact_ids: chosen[i].fact_ids,
    blueprint: chosen[i],
    script: i === 0 ? topic.opening_script : i === 1 && second ? second.script : null,
    summary: i === 0 ? topic.opening_summary : i === 1 && second ? second.summary : null,
    review: i === 1 && second ? second.review : null,
    writer_model: i === 0 || (i === 1 && second) ? WRITER_MODEL : null,
    source_refs: i === 0 ? openingRefs : [],
    status: i === 0 && voiced ? "ready" : "planned",
    audio_path: i === 0 && voiced ? voiced.audio_path : null,
    voice: i === 0 && voiced ? voiced.voice : null,
    voice_model: i === 0 && voiced ? voiced.voice_model : null,
    shape: i === 0 && voiced ? (voiced as any).shape ?? null : null,
    duration_sec: i === 0 && voiced ? (voiced as any).duration_sec ?? null : null,
    ready_at: i === 0 && voiced ? new Date().toISOString() : null,
  }));
  const { error: segmentsError } = await db.from("segments").insert(rows);
  if (!segmentsError && lent.length > 0) {
    // One line in the ledger per chapter lent, so what reuse saves can be counted.
    for (const s of lent) {
      mark({ topic_id: topic.id, lesson_id: lesson.id, position: s.position });
      await record({ kind: "voice_reused", step: "reusing another listener's recording", model: s.voice_model ?? VOICE_MODEL, voice: s.voice, audio_seconds: s.duration_sec ?? null });
    }
  } else if (!segmentsError && voiced) {
    mark({ topic_id: topic.id, lesson_id: lesson.id, position: 1 });
    await record({ kind: "voice_reused", step: "reusing the opening recording", model: voiced.voice_model ?? VOICE_MODEL, voice: voiced.voice });
  }
  if (segmentsError) {
    // Do not leave a lesson behind with no chapters in it.
    await db.from("lessons").delete().eq("id", lesson.id);
    throw new Problem(500, "The chapters could not be saved.", segmentsError.message);
  }
  return await get(lesson.id);
}

// ---------- Reading back ----------

async function link(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await db.storage.from(BUCKET).createSignedUrl(path, LINK_SECONDS);
  return data?.signedUrl ?? null;
}

async function describe(segment: any) {
  return {
    position: segment.position,
    title: segment.title,
    target_minutes: segment.target_minutes,
    status: segment.status,
    error: segment.error,
    script: segment.script,
    review: segment.review ?? null,
    source_refs: segment.source_refs,
    audio_url: segment.status === "ready" ? await link(segment.audio_path) : null,
    // The sound of the recording, a digit per slice, and its length. The player draws it.
    shape: segment.status === "ready" ? segment.shape ?? null : null,
    seconds: segment.duration_sec ?? null,
  };
}

async function get(lessonId: string) {
  const { data: lesson } = await db.from("lessons").select().eq("id", lessonId).maybeSingle();
  if (!lesson) throw new Problem(404, "No lesson with that id.");
  const { data: segments } = await db.from("segments").select().eq("lesson_id", lessonId).order("position");
  return {
    id: lesson.id,
    title: lesson.title,
    topic: lesson.topic,
    chosen_minutes: lesson.chosen_minutes,
    sources: lesson.sources,
    fact_count: Array.isArray(lesson.source_notes) ? lesson.source_notes.length : 0,
    segments: await Promise.all((segments ?? []).map(describe)),
  };
}

// ---------- Writing and voicing one chapter ----------

async function load(lessonId: string, position: number) {
  const { data: lesson } = await db.from("lessons").select().eq("id", lessonId).maybeSingle();
  if (!lesson) throw new Problem(404, "No lesson with that id.");
  const { data: all } = await db.from("segments").select().eq("lesson_id", lessonId).order("position");
  const segments = all ?? [];
  const segment = segments.find((s) => s.position === position);
  if (!segment) throw new Problem(404, "That lesson has no chapter at that position.");
  return { lesson, segments, segment };
}

/** Claims a chapter, so two requests for the same one cannot both pay to make it. */
async function claim(segment: any): Promise<boolean> {
  const stale = new Date(Date.now() - CLAIM_MS).toISOString();
  const { data } = await db
    .from("segments")
    .update({ status: segment.script ? "voicing" : "writing", error: null, claimed_at: new Date().toISOString() })
    .eq("id", segment.id)
    .or(`status.in.(planned,failed),claimed_at.lt."${stale}"`)
    .neq("status", "ready")
    .select()
    .maybeSingle();
  if (data) {
    // Keep saying "still on it" until the chapter is ready or has failed. If this worker is cut
    // off the signal stops with it, and the next request for the chapter takes over.
    const began = Date.now();
    const beat = setInterval(async () => {
      try {
        const { data: still } = await db.from("segments").update({ claimed_at: new Date().toISOString() }).eq("id", segment.id).in("status", ["writing", "voicing"]).select("id");
        if (!still?.length || Date.now() - began > 150_000) clearInterval(beat);
      } catch {
        // One missed signal is not worth stopping the chapter for.
      }
    }, 10_000);
  }
  return Boolean(data);
}

async function fail(segment: any, err: unknown) {
  const message = err instanceof Problem ? `${err.message} ${err.detail ?? ""}`.trim() : String(err);
  await db.from("segments").update({ status: "failed", error: message.slice(0, 500) }).eq("id", segment.id);
}

/** Returns the chapter's script, writing it first if that has not been done. */
async function ensureScript(lesson: any, segments: any[], segment: any): Promise<string> {
  if (segment.script) return segment.script;
  mark({ topic_id: lesson.topic_id ?? null, lesson_id: lesson.id, position: segment.position });
  // Chapters are written in order, because each one is told what the earlier ones covered.
  const previous = segments.find((s) => s.position === segment.position - 1);
  if (previous && !previous.script) throw new Problem(409, "The chapter before this one has not been written yet.");

  const facts: Fact[] = Array.isArray(lesson.source_notes) ? lesson.source_notes : [];
  const mine = notesFor(facts, segment.fact_ids ?? []);
  const sourcesByTitle = new Map<string, any>((lesson.sources ?? []).map((s: any) => [s.title, s]));
  const sourceRefs = [...new Set(mine.map((f) => f.source))].map((t) => sourcesByTitle.get(t) ?? { title: t });
  const next = segments.find((s) => s.position === segment.position + 1);
  const blueprint: Chapter = segment.blueprint ?? { title: segment.title, brief: segment.brief ?? "", fact_ids: segment.fact_ids ?? [] };
  const planned = Boolean(segment.blueprint);
  const story: Story | null = lesson.story ?? null;
  // No forced cliffhangers. A chapter ends on the question it naturally raises, if it raises one.
  const ending = !next
    ? "This is the last chapter. Answer the central question and land the payoff. End on one specific, earned " +
      "line. No summary of the lesson, no moral, no thanks, no 'history teaches us'."
    : !planned
      ? `End with one sentence that leans toward the next chapter, which is "${next.title}", without summarizing it.`
      : blueprint.transition
        ? `End on the question this naturally raises, in one line: ${blueprint.transition}. Not a cliffhanger, and no teaser of what is coming.`
        : "End when the discovery has landed. Do not add a teaser.";
  const houseStyle = await setting("story_brief", STORY_BRIEF);
  if (story?.engine === 2 && planned) {
    const made = await writeChapter({
      context: chapterContext(lesson.title, story, lesson.angle ?? "", segments.map((s) => s.title), segment.position, blueprint),
      chapter: blueprint,
      notes: mine,
      covered: lesson.covered_summary ?? "",
      minutes: segment.target_minutes,
      role: next ? "middle" : "last",
      afterOpening: segment.position === 2,
      before: closing(previous?.script),
      houseStyle,
    });
    await db.from("segments").update({ review: made.review }).eq("id", segment.id);
    // Once a chapter is written its real length is known, so the estimate gives way to it.
    await db.from("segments").update({ target_minutes: Math.max(1, Math.round(wordCount(made.script) / WORDS_PER_MINUTE)) }).eq("id", segment.id);
    await db.from("segments").update({ script: made.script, summary: made.summary, source_refs: sourceRefs, status: "voicing", writer_model: WRITER_MODEL }).eq("id", segment.id);
    await db
      .from("lessons")
      .update({ covered_summary: `${lesson.covered_summary}\nChapter ${segment.position}, ${segment.title}: ${made.summary || "no summary given."}`.trim() })
      .eq("id", lesson.id);
    return made.script;
  }
  const context =
    `Lesson: ${lesson.title}\n${storyLines(story, lesson.angle ?? "")}\nChapters: ${segments.map((s) => `${s.position}. ${s.title}`).join("; ")}\n\n` +
    `Chapter ${segment.position}: "${segment.title}"\n${blueprintLines(blueprint)}`;

  const draft = splitReply(
    await ask(
      "writing the chapter",
      WRITER_MODEL,
      writerBrief(houseStyle),
      `${context}\n` +
        `Length: up to about ${segment.target_minutes * WORDS_PER_MINUTE} words, which is ${segment.target_minutes} minutes read aloud.\n` +
        "This continues a story already under way. Do not greet the listener or reintroduce the subject. " +
        `Pick up as the next part of the same telling.\n${ending}\n\n` +
        `Already covered in earlier chapters:\n${lesson.covered_summary || "Nothing yet."}\n\n` +
        `Fact notes for this chapter:\n${noteLines(mine)}`,
    ),
  );
  // The chapter after the opening is needed about a minute after the lesson starts, so it
  // is only rewritten for a fact problem. Later chapters have minutes in hand.
  const { script, summary, review } = await checkScript(
    draft.script,
    draft.summary,
    mine,
    `${context}\n\nAlready covered in earlier chapters:\n${lesson.covered_summary || "Nothing yet."}`,
    houseStyle,
    segment.position > 2,
  );
  await db.from("segments").update({ review }).eq("id", segment.id);
  await db.from("segments").update({ script, summary, source_refs: sourceRefs, status: "voicing", writer_model: WRITER_MODEL }).eq("id", segment.id);
  await db
    .from("lessons")
    .update({ covered_summary: `${lesson.covered_summary}\nChapter ${segment.position}, ${segment.title}: ${summary || "no summary given."}`.trim() })
    .eq("id", lesson.id);
  return script;
}

async function saveAudio(segment: any, audio: Uint8Array, voice: string) {
  const path = `${segment.lesson_id}/${String(segment.position).padStart(2, "0")}.mp3`;
  const { error } = await db.storage.from(BUCKET).upload(path, audio, { contentType: "audio/mpeg", upsert: true });
  if (error) throw new Problem(500, "The audio could not be saved.", error.message);
  // Each recording made is a line in the ledger, including one made again for the same chapter.
  mark({ lesson_id: segment.lesson_id, position: segment.position });
  const sound = mp3Shape(audio);
  const model = await voiceModel(voice);
  await record({ kind: "voice", step: "voicing the chapter", model, voice, chars: typeof segment.script === "string" ? segment.script.length : null, audio_bytes: audio.length, audio_seconds: mp3Seconds(audio) });
  const { data } = await db
    .from("segments")
    .update({ status: "ready", audio_path: path, voice_model: model, voice, ready_at: new Date().toISOString(), shape: sound?.shape ?? "", duration_sec: sound ? Math.round(sound.seconds) : null })
    .eq("id", segment.id)
    .select()
    .single();
  return data;
}

/** Makes a chapter and answers when it is finished and saved. Used to stay ahead of the listener. */
async function makeSegment(lessonId: string, position: number) {
  const { lesson, segments, segment } = await load(lessonId, position);
  if (segment.status === "ready" || !(await claim(segment))) return await describe(segment);
  try {
    const script = await ensureScript(lesson, segments, segment);
    const { voice, direction } = await narrator(lesson.user_id, segments);
    return await describe(await saveAudio(segment, await speakAll(script, voice, direction), voice));
  } catch (err) {
    await fail(segment, err);
    throw err;
  }
}

/**
 * Writes and checks a chapter's script without recording it, so the writing can be read
 * and judged for the cost of the text alone. The script is kept: when the lesson is played
 * later, only the voice has to be made.
 */
async function scriptOnly(lessonId: string, position: number) {
  const { lesson, segments, segment } = await load(lessonId, position);
  if (segment.script || segment.status === "ready" || !(await claim(segment))) return await describe(segment);
  try {
    await ensureScript(lesson, segments, segment);
    const { data } = await db.from("segments").update({ status: "planned" }).eq("id", segment.id).select().single();
    return { ...(await describe(data)), review: data.review };
  } catch (err) {
    await fail(segment, err);
    throw err;
  }
}

/**
 * Sends a chapter's audio to the listener while it is still being generated, and saves a
 * copy as it goes by. If the listener leaves partway, the copy is still finished and saved.
 */
async function streamSegment(lessonId: string, position: number): Promise<Response> {
  const { lesson, segments, segment: first } = await load(lessonId, position);
  let segment = first;
  const saved = async (s: any) => Response.redirect((await link(s.audio_path)) ?? "", 302);
  if (segment.status === "ready") return await saved(segment);

  let mine = await claim(segment);
  if (!mine) {
    // Someone else is already making it. Wait for them instead of paying twice.
    for (let waited = 0; waited < 110_000 && !mine; waited += 2000) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const { data } = await db.from("segments").select().eq("id", segment.id).single();
      if (data?.status === "ready") return await saved(data);
      // Its maker failed or went silent. Take it over, while there is still time to make it in this request.
      const dropped = data?.status === "failed" || (data?.claimed_at && Date.now() - Date.parse(data.claimed_at) > CLAIM_MS);
      if (data && dropped) {
        if (waited <= 45_000 && (await claim(data))) {
          segment = data;
          mine = true;
        } else if (data.status === "failed") break;
      }
    }
    if (!mine) throw new Problem(503, "That chapter is still being made. Try again in a moment.");
  }

  try {
    const script = await ensureScript(lesson, segments, segment);
    const { voice, direction } = await narrator(lesson.user_id, segments);
    if (script.length > CHUNK_CHARS) {
      const audio = await speakAll(script, voice, direction);
      await saveAudio(segment, audio, voice);
      return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
    }
    const res = await speech(script, voice, direction);
    const [toListener, toArchive] = res.body!.tee();
    EdgeRuntime.waitUntil(
      new Response(toArchive)
        .arrayBuffer()
        .then((buffer) => saveAudio(segment, new Uint8Array(buffer), voice))
        .catch((err) => fail(segment, err)),
    );
    return new Response(toListener, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    await fail(segment, err);
    throw err;
  }
}

// ---------- A free self-test ----------

async function check(titles: unknown) {
  const reach = async (table: string) => {
    const { error } = await db.from(table).select("*").limit(1);
    return error ? `problem: ${error.message}` : "reachable";
  };
  const { data: bucket, error: bucketError } = await db.storage.getBucket(BUCKET);
  const result: Record<string, unknown> = {
    ok: true,
    openaiKeySet: OPENAI_KEY.length > 0,
    tables: { topics: await reach("topics"), lessons: await reach("lessons"), segments: await reach("segments") },
    audioBucket: bucketError || !bucket ? `problem: ${bucketError?.message ?? "missing"}` : "reachable",
    writerModel: WRITER_MODEL,
    scoutModel: SCOUT_MODEL,
    voiceModel: VOICE_MODEL,
    narrator: await narrator(),
    // How an example story of 17 minutes is fitted to the length asked for, keeping its chain of cause and effect.
    exampleCuts: Object.fromEntries(
      [6, 9, 15, 30].map((m) => {
        // Chapter 2 sets up a problem, 3 solves it, 4 is an aside, 5 is the consequence, and the payoff needs 5.
        const example: Chapter[] = [[3, 1, []], [3, 2, [1]], [3, 2, [2]], [2, 1, [1]], [3, 2, [3]], [3, 1, [5]]].map(([minutes, priority, needs], i) => ({ title: `chapter ${i + 1}`, brief: "", fact_ids: [], minutes: minutes as number, priority: priority as number, needs: needs as number[] }));
        const cut = pickChapters(example, m);
        return [m, { chapters: cut.picked.map((i) => i + 1), minutes: cut.lengths.reduce((a, b) => a + b, 0), foldedIn: cut.bridges.map((b) => b.map((i) => i + 1)) }];
      }),
    ),
    olderPlanLengths: { 10: chapterLengths(10), 30: chapterLengths(30) },
  };
  if (Array.isArray(titles)) {
    const sources = await readArticles(titles.filter((t): t is string => typeof t === "string"));
    result.wikipedia = sources.map((s) => ({ title: s.title, url: s.url, chars: s.text.length }));
  }
  return result;
}

const isId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);

function answer(err: unknown): Response {
  if (err instanceof Problem) {
    if (err.status >= 500) console.error(`lesson: ${err.message} ${err.detail ?? ""}`);
    return json({ error: err.message, detail: err.detail }, err.status);
  }
  console.error("lesson failed:", err);
  return json({ error: "Something went wrong in the function. Check its logs." }, 500);
}

Deno.serve((req: Request) => who.run({}, () => handle(req)));

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const key = req.headers.get("apikey") ?? url.searchParams.get("apikey") ?? "";
  if (!key || !allowedKeys().includes(key)) return json({ error: "Missing or wrong apikey." }, 401);

  // Who is asking. The app sends the signed-in person's pass with every request. With it,
  // their own things are read and written as them for the rest of this request.
  const pass = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (pass.split(".").length === 3) {
    const { data } = await service.auth.getUser(pass).catch(() => ({ data: null as any }));
    if (data?.user) {
      const client = createClient(Deno.env.get("SUPABASE_URL") ?? "", key, {
        global: { headers: { Authorization: `Bearer ${pass}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      mark({ user_id: data.user.id, client });
    }
  }

  // Audio players ask with GET, so the streaming route is the only one that answers it.
  if (req.method === "GET") {
    try {
      const lessonId = url.searchParams.get("lesson_id");
      const position = Number(url.searchParams.get("position"));
      if (!isId(lessonId) || !Number.isInteger(position) || position < 1) throw new Problem(400, "Give a lesson_id and a position.");
      if (!OPENAI_KEY) throw new Problem(500, "OPENAI_API_KEY is not set as an edge function secret.");
      return await streamSegment(lessonId, position);
    } catch (err) {
      return answer(err);
    }
  }
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Send a JSON body." }, 400);
  }

  try {
    if (body.action === "check") return json(await check(body.titles));
    if (body.action === "tick") {
      // Only the scheduler may ask for this, and it proves itself with a secret kept in the settings table.
      const secret = await setting("cron_secret", "");
      if (!secret || req.headers.get("x-pliny-cron") !== secret) throw new Problem(401, "Not allowed.");
      // Answer at once and do the work afterwards: the scheduler does not wait around for it.
      EdgeRuntime.waitUntil(who.run({}, () => tick()).catch((err) => console.log("tick failed:", String(err))));
      return json({ ok: true });
    }
    if (!me()) throw new Problem(401, "Sign in to use Pliny.");
    if (body.action === "topics") return json(await listTopics());
    if (body.action === "lessons") return json(await listLessons());
    if (body.action === "interests") return json(await listInterests());
    if (body.action === "remove_interest") {
      if (!isId(body.id)) throw new Problem(400, "Give the tag's id.");
      return json(await removeInterest(body.id));
    }
    if (body.action === "get") {
      if (!isId(body.lesson_id)) throw new Problem(400, "Give a lesson_id.");
      return json(await get(body.lesson_id));
    }
    if (body.action === "start") {
      const minutes = Math.round(Number(body.minutes));
      if (!isId(body.topic_id)) throw new Problem(400, "Give a topic_id.");
      if (!Number.isFinite(minutes) || minutes < 2 || minutes > MAX_MINUTES) {
        throw new Problem(400, `Minutes must be between 2 and ${MAX_MINUTES}.`);
      }
      return json(await start(body.topic_id, minutes));
    }

    if (!OPENAI_KEY) throw new Problem(500, "OPENAI_API_KEY is not set as an edge function secret.");
    if (body.action === "refill") return json(await refill());
    if (body.action === "add_interests") {
      const labels = (Array.isArray(body.labels) ? body.labels : [])
        .filter((l: unknown): l is string => typeof l === "string")
        .map((l: string) => l.trim().replace(/\s+/g, " ").slice(0, 40))
        .filter(Boolean);
      if (labels.length === 0) throw new Problem(400, "Give at least one tag.");
      return json(await addInterests(labels));
    }
    if (body.action === "add_interest") {
      const label = typeof body.label === "string" ? body.label.trim().replace(/\s+/g, " ").slice(0, 40) : "";
      if (!label) throw new Problem(400, "Give a tag.");
      return json(await addInterest(label));
    }
    if (body.action === "prepare") {
      const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
      if (!topic) throw new Problem(400, "Give a topic.");
      const planned = await planTopic(topic, undefined, body.force === true, body.engine === 1 || body.engine === 2 ? body.engine : undefined);
      return json(planned ? { id: planned.id, title: planned.title, stage: "planned" } : { duplicate: true });
    }
    if (body.action === "finish") {
      if (!isId(body.topic_id)) throw new Problem(400, "Give a topic_id.");
      const { data: mine } = await db
        .from("topics")
        .update({ stage: "finishing", proposed_at: new Date().toISOString() })
        .eq("id", body.topic_id)
        .eq("status", "preparing")
        .eq("stage", "planned")
        .select()
        .maybeSingle();
      if (!mine) throw new Problem(409, "That topic is not planned and waiting to be finished.");
      return json(await finishTopic(mine));
    }
    if (body.action === "second") {
      if (!isId(body.topic_id)) throw new Problem(400, "Give a topic_id.");
      return json(await writeSecond(body.topic_id));
    }
    if (body.action === "script") {
      const position = Number(body.position);
      if (!isId(body.lesson_id)) throw new Problem(400, "Give a lesson_id.");
      if (!Number.isInteger(position) || position < 1) throw new Problem(400, "Give a chapter position.");
      return json(await scriptOnly(body.lesson_id, position));
    }
    if (body.action === "segment") {
      const position = Number(body.position);
      if (!isId(body.lesson_id)) throw new Problem(400, "Give a lesson_id.");
      if (!Number.isInteger(position) || position < 1) throw new Problem(400, "Give a chapter position.");
      return json(await makeSegment(body.lesson_id, position));
    }
    throw new Problem(400, "Unknown action.");
  } catch (err) {
    return answer(err);
  }
}
