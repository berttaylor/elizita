// node test.mjs: run cases.json against eliza.js (fresh engine per conversation).
import { readFileSync } from "node:fs";
import { createEliza } from "./eliza.js";

const rules = JSON.parse(readFileSync(new URL("rules.json", import.meta.url)));
const cases = JSON.parse(readFileSync(new URL("cases.json", import.meta.url)));

let failed = 0;
for (const { name, turns } of cases) {
  const eliza = createEliza(rules);
  for (const [input, expected] of turns) {
    const got = eliza.reply(input);
    if (got !== expected) {
      failed++;
      console.log(`FAIL ${name}\n  > ${input}\n  expected: ${expected}\n  got:      ${got}`);
    }
  }
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
