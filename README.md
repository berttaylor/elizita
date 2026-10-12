# Elizita

ELIZA, Joseph Weizenbaum's 1966 chatbot, as **one engine plus swappable rule files**. The engine is Weizenbaum's own algorithm, recreated faithfully. Everything ELIZA says comes from a rules file. Features beyond 1966 are opt-in fields in the rules, so the original script still behaves exactly as it did in 1966.

Live at https://berttaylor.github.io/elizita/. Pick a rule set from the dropdown, or link straight to one with `?rules=doctor-extended`.

| File | Role |
|------|------|
| `eliza.js` | The engine. Pure JS with no DOM, used by the page and the tests. |
| `rules/index.json` | The list of rule sets shown in the dropdown. |
| `rules/doctor-1966.json` | Weizenbaum's DOCTOR script from the 1966 paper, unchanged. |
| `rules/doctor-extended.json` | Our expanded DOCTOR: more keywords and modern pronoun reflection. |
| `cases/<id>.json` | Conversations each rule set must reproduce word for word. |
| `index.html` | The UI only. |

```sh
python3 -m http.server   # then open http://localhost:8000 (fetch won't work from file://)
node test.mjs            # every rule set against its cases
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
| `reflect` | A word map applied to pieces as they're inserted into a reply, the modern alternative to `substitute`: match the user's own words, then mirror `MY`→`YOUR` on the way out. |

New capabilities get added here the same way: random reply choice, follow-ups that depend on ELIZA's previous reply (as in AIML), variables like the user's name, topics, and word stemming. Each is a new optional field, and `cases/doctor-1966.json` proves the original still behaves exactly the same.

## Adding a rule set

1. Add `rules/<id>.json`.
2. Add `cases/<id>.json` with at least one conversation: `[{ "name": "...", "turns": [["input", "EXPECTED REPLY"], ...] }]`.
3. Add `{ "id": "<id>", "name": "..." }` to `rules/index.json`.
4. Run `node test.mjs`.

## Credits

- **Joseph Weizenbaum:** ELIZA and the DOCTOR script, *Communications of the ACM* 9(1), January 1966.
- **Anthony Hay:** the faithful C++ recreation at [github.com/anthay/ELIZA](https://github.com/anthay/ELIZA) (CC0). That project supplied:
  - the transcription of the 1966 script;
  - the algorithm details recovered from the original MAD-SLIP source (BUT as a delimiter, the LIMIT counter, the HASH function);
  - the historical test conversations in `cases/doctor-1966.json`.
- **Jeff Shrager and the [ELIZAGEN](https://sites.google.com/view/elizagen-org/) team:** found the original source in the MIT archives.

## Deploy

GitHub Pages serves `main` from the repository root. Push and the site updates; there's no build step.
