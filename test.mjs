// node test.mjs: run every rule set in rules/index.json against cases/<id>.json, plus unit checks.
// Each conversation gets a fresh engine, so cycling and memory are tested too.
// Rule sets that need the sentence model (meaning/moods) are tested by tools/test-meaning.mjs.
import { readFileSync } from "node:fs";
import { createEliza, loadRules, mergeRules, hash, lastChunkBCD } from "./eliza.js";

// Small seeded random number generator (mulberry32), so <random> picks are repeatable.
const seeded = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const read = path => readFileSync(new URL(path, import.meta.url));
const getJSON = async path => JSON.parse(read(path));
const getBytes = async path => read(path).buffer;

let failed = 0, passed = 0;
const check = (label, got, expected) => {
  if (got === expected) return passed++;
  failed++;
  console.log(`FAIL ${label}\n  expected: ${expected}\n  got:      ${got}`);
};

// SLIP HASH sanity values (Weizenbaum 1966 p.38: "ALWAYS" hashes to 14; Hay: "HERE" -> 3)
check("hash ALWAYS", hash(lastChunkBCD("ALWAYS"), 7), 14);
check("hash HERE", hash(lastChunkBCD("HERE"), 2), 3);

// include merging: word maps merge, category lists join, the including file's text wins.
const merged = mergeRules({ name: "A", bot: { name: "ALICE", age: "30" }, categories: [1] },
                          { name: "B", bot: { age: "31" }, categories: [2], include: ["a"] });
check("merge name", merged.name, "B");
check("merge maps", JSON.stringify(merged.bot), '{"name":"ALICE","age":"31"}');
check("merge lists", JSON.stringify(merged.categories), "[1,2]");
check("merge drops include", merged.include, undefined);

// Meaning, facts, moods and conditions, with a fake 3-number "sentence model".
const fake = { "my mum drives me mad": [1, 0, 0], "i hate my mother": [0.9, 0.1, 0], "hello": [0, 1, 0],
               "blah": [0, 0, 1], "you are crazy": [0, 0.2, 1], "shut up": [0, 0, 1], "sorry": [0, 1, 0] };
const embed = async text => fake[text.toLowerCase()] || [0.3, 0.3, 0.3];
const tiny = {
  categories: [
    { pattern: "I HATE MY MOTHER", template: ["Tell me about your mother."] },
    { pattern: "HELLO", template: ["Hi."] },
    { pattern: "MY * IS CALLED *", template: [{ think: [{ set: [{ star: 1 }], to: [{ star: 2 }] }] }, "Noted."] },
    { pattern: "WHAT DO YOU KNOW", template: ["You told me: ", { facts: 1 }, "."] },
    { pattern: "HOW ARE YOU", template: [{ condition: [{ name: "anger", above: 5, then: ["Leave me alone."] }, { then: ["Fine."] }] }] },
    { pattern: "*", template: ["Go on."] },
  ],
  meaning: { threshold: 0.8, patterns: ["I HATE MY MOTHER", "HELLO"] },
  moods: { anger: { max: 20, step: 4, decay: 1, up: ["you are crazy", "shut up"], down: ["sorry"] } },
  moodThreshold: 0.9,
};
{
  const bot = createEliza(tiny, { embed });
  check("meaning match", await bot.reply("my mum drives me mad"), "Tell me about your mother.");
  check("meaning trace", bot.trace.some(t => t.includes('closest meaning "I HATE MY MOTHER" (0.99)')), true);
  check("meaning below threshold", await bot.reply("blah"), "Go on.");
  check("fact set", await bot.reply("My sister is called Ann"), "Noted.");
  check("fact list", await bot.reply("What do you know"), "You told me: your sister is Ann.");
  check("calm", await bot.reply("How are you"), "Fine.");
  await bot.reply("you are crazy");
  await bot.reply("shut up");
  check("anger level", bot.moods()[0].level, 7); // 0 → +4 → 4 −1 decay +4
  check("angry", await bot.reply("How are you"), "Leave me alone.");
  await bot.reply("sorry");
  check("mood falls", bot.moods()[0].level, 1); // 7 → 6 (decay) → 6 −1 −4
}

for (const { id } of await getJSON("rules/index.json")) {
  const rules = await loadRules(id, getJSON, getBytes);
  if (rules.meaning || rules.moods) continue; // needs the real model: tools/test-meaning.mjs
  for (const { name, turns } of await getJSON(`cases/${id}.json`)) {
    const eliza = createEliza(rules, { random: seeded(1966) });
    for (const [input, expected] of turns) check(`${id} / ${name}\n  > ${input}`, await eliza.reply(input), expected);
  }
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
