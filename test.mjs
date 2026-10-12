// node test.mjs: run every rule set in rules/index.json against cases/<id>.json.
// Each conversation gets a fresh engine, so cycling and memory are tested too.
import { readFileSync } from "node:fs";
import { createEliza, hash, lastChunkBCD } from "./eliza.js";

// Small seeded random number generator (mulberry32), so <random> picks are repeatable.
const seeded = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const load = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
let failed = 0, passed = 0;
const check = (label, got, expected) => {
  if (got === expected) return passed++;
  failed++;
  console.log(`FAIL ${label}\n  expected: ${expected}\n  got:      ${got}`);
};

// SLIP HASH sanity values (Weizenbaum 1966 p.38: "ALWAYS" hashes to 14; Hay: "HERE" -> 3)
check("hash ALWAYS", hash(lastChunkBCD("ALWAYS"), 7), 14);
check("hash HERE", hash(lastChunkBCD("HERE"), 2), 3);

for (const { id } of load("rules/index.json")) {
  const rules = load(`rules/${id}.json`);
  for (const { name, turns } of load(`cases/${id}.json`)) {
    const eliza = createEliza(rules, { random: seeded(1966) });
    for (const [input, expected] of turns) check(`${id} / ${name}\n  > ${input}`, eliza.reply(input), expected);
  }
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
