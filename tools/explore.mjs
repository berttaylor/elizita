// Print replies and workings for some inputs, using the real sentence model.
// usage: docker run --rm -v "$PWD":/app -w /app/tools node:22-slim node explore.mjs <id> "input" "input" ...
import { readFileSync } from "node:fs";
import { createEliza, loadRules } from "../eliza.js";
import { embed } from "./model.mjs";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root));
const [id, ...inputs] = process.argv.slice(2);
const rules = await loadRules(id, async p => JSON.parse(read(p)), async p => read(p).buffer);
const bot = createEliza(rules, { embed, random: () => 0 });
for (const input of inputs) {
  console.log(`> ${input}\n${await bot.reply(input)}\n   ↳ ${bot.trace.map(s => s.trim()).join("  →  ")}\n`);
}
