// Precompute "meaning" vectors for a rule set: every fixed pattern (no wildcards, no that/topic)
// is embedded with the sentence model and stored int8-quantised in rules/<id>.vectors.bin, and
// the matching pattern list is written into rules/<id>.json under meaning.patterns.
// usage (from the repo root):
//   docker run --rm -v "$PWD":/app -w /app/tools node:22-slim sh -c "npm ci && node embed.mjs <id>"
import { readFileSync, writeFileSync } from "node:fs";
import { loadRules } from "../eliza.js";
import { embed } from "./model.mjs";

const id = process.argv[2];
const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root));
const rules = await loadRules(id, async p => JSON.parse(read(p)), async p => read(p).buffer);

const patterns = [...new Set(rules.categories
  .filter(c => !c.that && !c.topic && !/[*_]/.test(c.pattern))
  .map(c => c.pattern))];

const bytes = new Int8Array(patterns.length * 384);
for (let i = 0; i < patterns.length; i++) {
  const v = await embed(patterns[i].toLowerCase());
  for (let j = 0; j < v.length; j++) bytes[i * 384 + j] = Math.max(-127, Math.min(127, Math.round(v[j] * 127)));
  if (i % 1000 === 0) console.error(`${i} / ${patterns.length}`);
}

const file = new URL(`rules/${id}.json`, root);
const own = JSON.parse(readFileSync(file));
own.meaning = { ...own.meaning, vectorsFile: `${id}.vectors.bin`, patterns };
writeFileSync(file, JSON.stringify(own, null, 2) + "\n");
writeFileSync(new URL(`rules/${id}.vectors.bin`, root), bytes);
console.error(`${patterns.length} patterns -> rules/${id}.vectors.bin (${bytes.length} bytes)`);
