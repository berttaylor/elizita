# Elizita

ELIZA and its descendants as **one engine plus swappable rule files**. The engine is Weizenbaum's own 1966 algorithm, recreated faithfully. Later ideas, from the AIML behind A.L.I.C.E. to a small in-browser neural model that helps pick rules, are opt-in fields in the rules, so each historical rule set still behaves as it originally did.

Live at https://berttaylor.github.io/elizita/. Pick a rule set from the dropdown, or link straight to one with `?rules=alice`. Under every reply, **the workings** show step by step why it said that (toggle with "show workings"). **About this system** explains how the selected system works and lists its rules.

| Tier | Rule set | Year | How it answers |
|------|----------|------|----------------|
| 1 | `doctor-1966` | 1966 | Spot the highest-ranked keyword and reshape the sentence around it. |
| 2 | `doctor-extended` | ours | The same idea with more keywords, matching your own words and mirroring them on the way out. |
| 3 | `alice` | 1995–2011 | Match the whole sentence against about 50,000 patterns, rewrite synonyms to canonical forms, follow up on its own last line, and remember your name. |
| 4 | `alice-plus` | ours | ALICE, plus: when only a catch-all or loose pattern fits, a small sentence model picks the ALICE pattern closest in *meaning*; DOCTOR as the last resort; remembers facts ("my sister is called Ann"). |
| 5 | `parry` | ours, after 1972 | A persona after Colby's PARRY with fear, anger and mistrust levels. The model judges what each message sounds like; the levels choose friendly, guarded or hostile replies, and too much makes him walk out. |

Tiers 4 and 5 download a small sentence model (Xenova/all-MiniLM-L6-v2, about 23MB, cached after the first visit) that runs in your browser. It never writes a reply: it only scores how close two sentences are in meaning, and the rules decide what to say. No server, no API keys.

| File | Role |
|------|------|
| `eliza.js` | The engine. Pure JS with no DOM, used by the page and the tests. |
| `rules/index.json` | The list of rule sets shown in the dropdown. |
| `rules/doctor-1966.json` | Weizenbaum's DOCTOR script from the 1966 paper, unchanged. |
| `rules/doctor-extended.json` | Our expanded DOCTOR: more keywords and modern pronoun reflection. |
| `rules/alice.json` | The Free A.L.I.C.E. AIML set, converted (GPL). |
| `rules/alice-plus.json`, `.vectors.bin` | Tier 4 rules and the precomputed meaning vectors for 22,000 ALICE patterns. |
| `rules/parry.json`, `.vectors.bin` | Tier 5: our PARRY-style persona, moods and its pattern vectors. |
| `tools/aiml2json.mjs` | Converts any folder of AIML 1.0 files into a rules file. |
| `tools/embed.mjs`, `tools/test-meaning.mjs`, `tools/explore.mjs` | Build vectors, test and explore tiers 4–5 with the real model (run in Docker). |
| `cases/<id>.json` | Conversations each rule set must reproduce word for word. |
| `index.html` | The UI only. |

```sh
python3 -m http.server   # then open http://localhost:8000 (fetch won't work from file://)
node test.mjs            # tiers 1–3 against their cases, plus unit checks for the newer features

# tiers 4–5 need the sentence model; run the tools in Docker (nothing installed locally):
docker run --rm -v "$PWD":/app -w /app/tools node:22-slim sh -c "npm ci && node test-meaning.mjs"
docker run --rm -v "$PWD":/app -w /app/tools node:22-slim sh -c "npm ci && node embed.mjs alice-plus"   # rebuild vectors after changing patterns
docker run --rm -v "$PWD":/app -w /app/tools node:22-slim sh -c "npm ci && node explore.mjs parry 'You are crazy'"
```

## How a reply is made (the 1966 algorithm)

1. The input is uppercased. `?` and `!` count as `.`.
2. **Scan** the words left to right:
   - At a **delimiter** (`,` `.` `BUT`), if no keyword has been found yet, everything up to that point is thrown away; otherwise the rest of the input is thrown away. Only one clause is ever answered.
   - Each **keyword** goes onto a stack. One that outranks everything so far goes on top; others go to the bottom.
   - Each word listed in `substitute` is swapped as it is scanned (`I`→`YOU`, `MY`→`YOUR`). So patterns are written in the already-swapped form: `* YOU ARE *` matches what the user typed as "I am".
3. Take the top keyword and try its patterns (`decomp`) in order. The first match wins.
4. Reply with that pattern's next reassembly (`reasmb`). Each pattern cycles through its list.
5. **Memory:** when the `memory.keyword` (MY) is handled, a second reply is saved for later. Which of the memory patterns is used comes from hashing the last word, with the same SLIP hash function as the 1966 program. When an input has no keywords, a saved memory is used, but only on every 4th turn (Weizenbaum's "certain counting mechanism").
6. With no keywords and no memory, it says the next `none` line.

## Rule file format

```json
{
  "format": 1,
  "name": "DOCTOR (1966 original)",
  "initial": "HOW DO YOU DO. PLEASE TELL ME YOUR PROBLEM",
  "final": "GOODBYE",
  "quit": ["BYE", "GOODBYE"],
  "delimiters": [",", ".", "BUT"],
  "substitute": { "I": "YOU", "MY": "YOUR", "DONT": "DON'T" },
  "tags": { "FAMILY": ["MOTHER", "FATHER", "SISTER"] },
  "keywords": {
    "MY": { "rank": 2, "rules": [
      { "decomp": "* YOUR * (/FAMILY) *", "reasmb": ["TELL ME MORE ABOUT YOUR FAMILY", "YOUR (4)"] }
    ]},
    "HOW": { "goto": "WHAT" }
  },
  "memory": { "keyword": "MY", "rules": [{ "decomp": "* YOUR *", "reasmb": "EARLIER YOU SAID YOUR (3)" }] },
  "none": ["PLEASE GO ON"],
  "nomatch": ["PLEASE CONTINUE", "HMMM", "GO ON , PLEASE", "I SEE"]
}
```

All rule text is UPPERCASE, like the original teletype.

**Patterns** (`decomp`):
- `*` matches any words (possibly none).
- A number `N` matches exactly N words.
- `(* SAD UNHAPPY)` matches one of the listed words.
- `(/FAMILY)` matches any word listed in `tags.FAMILY`.
- Every other word matches itself.

Every token counts as a numbered piece. In `* YOUR * (/FAMILY) *`, piece (4) is the family word.

**Replies** (`reasmb`):
- Text, where `(n)` inserts piece n.
- `"goto WHAT"` hands the input to the keyword WHAT.
- `"newkey"` gives up on this keyword and tries the next one on the stack.
- `{ "pre": "YOU ARE (3)", "goto": "I" }` rewrites the input, then hands it on.

**Keywords:**
- `rank` sets priority (default 0).
- `goto` is where to go when none of the keyword's patterns match.
- A keyword with only `goto` is an alias (`"MACHINE": { "rank": 50, "goto": "COMPUTER" }`).

**Fallbacks:** `none` is used when there's nothing to say. `nomatch` holds the four messages the 1966 program printed when a script had no matching pattern; if it's absent, `none` is used instead.

### Opt-in features (not in 1966)

| Field | Effect |
|-------|--------|
| `about` | Paragraphs shown in the page's "How it works" panel. |
| `reflect` | A word map applied to pieces as they're inserted into a reply, the modern alternative to `substitute`: match the user's own words, then mirror `MY`→`YOUR` on the way out. In AIML it's also used by `person`. |
| `categories` | AIML-style whole-sentence matching (see below). When present, every sentence goes through the categories first; `keywords`, if present too, are the fallback. |
| `include` | Other rule sets merged in (categories joined, word maps merged): `"include": ["alice"]`. |
| `fallback` | A whole other rule set to hand over to when only a catch-all fits: `"fallback": "doctor-extended"`. |
| `meaning` | `{ "threshold": 0.65, "patterns": [...], "vectorsFile": "x.vectors.bin" }`. When the best match is a catch-all (`*`) or loose (one word plus wildcards, like `MY *`), the sentence model finds the closest fixed pattern; if it scores at least the threshold, that pattern is answered instead. Built by `tools/embed.mjs`. |
| `moods`, `moodThreshold`, `leave` | Levels pushed up or down when a clause is close in meaning to an example phrase: `"anger": { "max": 20, "step": 4, "decay": 1, "up": ["you are crazy"], "down": ["I'm sorry"] }`. Templates read them as variables; `leave` ends the chat when a level is reached. |
| `bot`, `person2`, `gender` | AIML bot properties and word maps. |

Each feature is a new optional field, and `cases/doctor-1966.json` proves the original still behaves exactly the same.

### AIML categories

```json
{ "pattern": "MY NAME IS *", "template": [{ "srai": ["CALL ME ", { "star": 1 }] }] }
{ "pattern": "I DO NOT KNOW", "that": "WHAT DO YOU GET WHEN YOU CROSS *", "template": [{ "srai": ["WHAT"] }] }
```

- **Matching:** `pattern` is matched against the whole sentence (uppercase, punctuation removed, `substitute` contractions expanded). `that` is matched against the bot's previous sentence and `topic` against the `topic` variable; both default to `*`. `_` matches 1+ words and beats an exact word, which beats `*` (also 1+ words). This is Wallace's "Graphmaster".
- **Templates:** a list of strings and tag objects:

| Tag | Meaning |
|-----|---------|
| `{"star": n}`, `{"thatstar": n}`, `{"topicstar": n}` | The n-th wildcard match. |
| `{"srai": [...]}` | Ask again with this text (most of ALICE is these "reductions"). |
| `{"set": "name", "to": [...]}`, `{"get": "name"}` | Remember and recall. |
| `{"bot": "name"}` | A bot property. |
| `{"think": [...]}` | Do it silently. |
| `{"random": [[...], [...]]}` | Pick one at random. |
| `{"condition": [{ "name", "value", "then" }]}` | The first case whose variable matches; a case with no value is the default. `"above": n` / `"below": n` compare numbers (moods). `name` may be computed, e.g. `[{"star": 1}]`. |
| `{"set": [{"star": 1}], "to": [...]}`, `{"key": [...]}`, `{"facts": "if none"}` | Facts: set a computed name, show that name, list everything remembered. |
| `{"person": [...]}`, `{"person2": [...]}`, `{"gender": [...]}` | Swap pronouns. |
| `{"input": n}`, `{"that": n}` | An earlier user sentence or bot reply. |
| `{"uppercase"/"lowercase"/"formal"/"sentence": [...]}`, `{"date": ""}` | Formatting. |

To regenerate ALICE, or convert another AIML set:

```sh
node tools/aiml2json.mjs path/to/aiml-folder tools/alice-header.json > rules/alice.json
```

The header file supplies what AIML files don't: name, about text, bot properties, contractions and pronoun maps, and which files to skip (here the MindPixel trivia files).

## Adding a rule set

1. Add `rules/<id>.json`.
2. Add `cases/<id>.json` with at least one conversation: `[{ "name": "...", "turns": [["input", "EXPECTED REPLY"], ...] }]`. Random choices use a fixed seed in the tests, so expected replies are repeatable.
3. Add `{ "id": "<id>", "name": "..." }` to `rules/index.json`.
4. Run `node test.mjs`.

## Credits

- **Joseph Weizenbaum:** ELIZA and the DOCTOR script, *Communications of the ACM* 9(1), January 1966.
- **Anthony Hay:** the faithful C++ recreation at [github.com/anthay/ELIZA](https://github.com/anthay/ELIZA) (CC0). That project supplied:
  - the transcription of the 1966 script;
  - the algorithm details recovered from the original MAD-SLIP source (BUT as a delimiter, the LIMIT counter, the HASH function);
  - the historical test conversations in `cases/doctor-1966.json`.
- **Jeff Shrager and the [ELIZAGEN](https://sites.google.com/view/elizagen-org/) team:** found the original source in the MIT archives.
- **Kenneth Colby:** PARRY (Stanford, 1972). Tier 5 is our own script modelled on his published design; his original MLISP code isn't used.
- **Bruce Wilcox:** ChatScript, whose fact memory inspired tier 4's.
- **Xenova/all-MiniLM-L6-v2** (Apache-2.0, from sentence-transformers) and **transformers.js** (Hugging Face) run the sentence model in the browser.
- **Richard S. Wallace and the ALICE A.I. Foundation:** A.L.I.C.E. and the Free ALICE AIML set ([github.com/drwallace/aiml-en-us-foundation-alice](https://github.com/drwallace/aiml-en-us-foundation-alice)), released under the GNU GPL. The bot profile values in `tools/alice-header.json` are reconstructed, because the original properties file isn't part of the published set.

## License

GPL-3.0-or-later (see `LICENSE`), as required by the ALICE AIML set. The 1966 script and test conversations from Anthony Hay's project are CC0.

## Deploy

GitHub Pages serves `main` from the repository root. Push and the site updates; there's no build step.
