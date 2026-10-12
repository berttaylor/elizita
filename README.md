# Elizita

A small rebuild of Joseph Weizenbaum's ELIZA (MIT, 1966) running the DOCTOR script.

The three parts are kept apart:

| File | Role |
|------|------|
| `rules.json` | **What** ELIZA says. All behaviour lives here. |
| `eliza.js` | **How** matching works. A pure engine with no DOM. Used by the web page. |
| `eliza.py` | The same engine in Python, for the terminal. |
| `index.html` | **How it looks.** Only the UI. It never reads the rules itself. |
| `cases.json` | Conversations that both engines must reproduce word for word. |

## Run

```sh
python3 -m http.server        # then open http://localhost:8000 (fetch won't work from file://)
python3 eliza.py              # chat in the terminal
python3 eliza.py my-rules.json
node test.mjs                 # test the JS engine
python3 eliza.py --test       # test the Python engine
```

## How a reply is made

1. The input is lowercased and stripped of odd characters. Each word is swapped through `pre`, so `i'm` becomes `i am` and `but` becomes `.`.
2. The text is split into sentences on `. , ? !`.
3. In each sentence, the engine finds every **keyword**: a word equal to a keyword's `word` or one of its `synonyms`. Keywords are sorted by `rank`, highest first.
4. For each keyword, it tries its `rules` in order. The first `decomp` pattern that matches wins.
5. That rule's next `reasmb` template is filled in. Each rule cycles through its list, so repeats get varied answers.
6. If nothing matches, ELIZA says something it saved in **memory**, or failing that, the next line from `none`.

## Rules format

```json
{ "word": "my", "rank": 2, "rules": [
  { "decomp": "* my *", "memory": true, "reasmb": ["Earlier you said your (2)."] },
  { "decomp": "* my @family *", "reasmb": ["Tell me more about your family."] },
  { "decomp": "* my *", "reasmb": ["Your (2)?"] }
]}
```

- `*` matches any run of words. Every `*` and `@group` is captured and numbered from 1, left to right.
- `@family` matches `family` or any word in `synonyms.family`.
- `(n)` in a reply inserts capture *n*, after it is mirrored through `post` (`my` becomes `your`, `me` becomes `you`, and so on).
- `goto alike` hands the sentence to the `alike` keyword's rules instead.
- `"memory": true` saves the reply instead of saying it. Matching carries on, and the saved reply comes out later when nothing else matches.
- Top-level fields: `initial` and `final` are the greeting and goodbye; `quit` lists the words that end the chat; `none` holds the fallback lines.

To make a different character, copy `rules.json`, change it, and pass the new file in. The engine doesn't need to change.

## Deploy (GitHub Pages)

Push to GitHub, then go to Settings → Pages → Deploy from a branch → `main` / root. There's no build step. `.nojekyll` makes Pages serve the files exactly as they are.
