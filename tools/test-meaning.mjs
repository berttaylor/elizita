// Run cases for the rule sets that need the sentence model (meaning, moods), with the real model.
// usage (from the repo root):
//   docker run --rm -v "$PWD":/app -w /app/tools node:22-slim sh -c "npm ci && node test-meaning.mjs"
// With --record it writes what each case currently says into cases/<id>.json (review the diff!).
import { readFileSync, writeFileSync } from "node:fs";
import { createEliza, loadRules } from "../eliza.js";
import { embed } from "./model.mjs";

// Same seeded random numbers as test.mjs (mulberry32), so <random> picks are repeatable.
const seeded = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root));
const getJSON = async p => JSON.parse(read(p)), getBytes = async p => read(p).buffer;
const record = process.argv.includes("--record");

let failed = 0, passed = 0;
for (const { id } of await getJSON("rules/index.json")) {
  const rules = await loadRules(id, getJSON, getBytes);
  if (!rules.meaning && !rules.moods) continue;
  const cases = await getJSON(`cases/${id}.json`);
  for (const { name, turns } of cases) {
    const bot = createEliza(rules, { embed, random: seeded(1966) });
    for (const turn of turns) {
      const got = await bot.reply(turn[0]);
      if (record) { turn[1] = got; console.log(`> ${turn[0]}\n${got}\n   ↳ ${bot.trace.map(s => s.trim()).join("  →  ")}\n`); continue; }
      if (got === turn[1]) passed++;
      else { failed++; console.log(`FAIL ${id} / ${name}\n  > ${turn[0]}\n  expected: ${turn[1]}\n  got:      ${got}`); }
    }
  }
  if (record) writeFileSync(new URL(`cases/${id}.json`, root), JSON.stringify(cases, null, 1) + "\n");
}
if (!record) console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
