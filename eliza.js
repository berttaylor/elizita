// ELIZA engine. It knows nothing about the DOCTOR script or the web page:
// every word it says comes from the rules object (see rules.json, README.md).
// eliza.py is a line-for-line twin; cases.json keeps the two honest.

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function createEliza(rules) {
  const counters = {}; // "keyword/ruleIndex" -> how many times that rule has fired
  const memory = [];   // replies saved by "memory" rules, said later when stuck

  // A word plus its synonyms: group("sad") -> ["sad", "unhappy", "depressed", "sick"]
  const group = name => [name, ...(has(rules.synonyms, name) ? rules.synonyms[name] : [])];

  // "* i @desire *" -> /^\s*(.*?)\s*\bi\b\s*\b(desire|want|need)\b\s*(.*?)\s*$/
  function compile(decomp) {
    const parts = decomp.split(/\s+/).map(token =>
      token === "*" ? "(.*?)"
      : token.startsWith("@") ? `\\b(${group(token.slice(1)).join("|")})\\b`
      : `\\b${token}\\b`);
    return new RegExp(`^\\s*${parts.join("\\s*")}\\s*$`);
  }

  // Cycle through a list so the same input gets a different reply next time.
  function next(key, list) {
    const i = counters[key] || 0;
    counters[key] = i + 1;
    return list[i % list.length];
  }

  // "i hate my job" -> "you hate your job"
  const reflect = text =>
    text.split(/\s+/).map(w => (has(rules.post, w) ? rules.post[w] : w)).join(" ").trim();

  // Lowercase, apply "pre" substitutions, split into sentences on . , ? !
  function sentences(text) {
    const words = text.toLowerCase()
      .replace(/[^a-z0-9'.,?! ]/g, " ")
      .replace(/([.,?!])/g, " $1 ")
      .split(/\s+/).filter(Boolean)
      .map(w => (has(rules.pre, w) ? rules.pre[w] : w));
    return words.join(" ").split(/[.,?!]/).map(s => s.trim()).filter(Boolean);
  }

  // Keywords found in the sentence, highest rank first (ties: first seen first).
  function keywordsIn(sentence) {
    const found = [];
    for (const word of sentence.split(" "))
      for (const key of rules.keywords)
        if (!found.includes(key) && group(key.word).includes(word)) found.push(key);
    return found.sort((a, b) => b.rank - a.rank);
  }

  function tryKeyword(key, sentence) {
    for (const [i, rule] of key.rules.entries()) {
      const match = sentence.match(compile(rule.decomp));
      if (!match) continue;
      const template = next(`${key.word}/${i}`, rule.reasmb);
      if (template.startsWith("goto ")) {
        const target = rules.keywords.find(k => k.word === template.slice(5));
        if (!target) throw new Error(`rules: "${template}" names no keyword`);
        const reply = tryKeyword(target, sentence);
        if (reply) return reply;
        continue;
      }
      const reply = template.replace(/\((\d+)\)/g, (_, n) => reflect(match[n] || ""));
      if (!rule.memory) return reply;
      memory.push(reply);
    }
    return null;
  }

  function reply(text) {
    for (const sentence of sentences(text))
      for (const key of keywordsIn(sentence)) {
        const answer = tryKeyword(key, sentence);
        if (answer) return answer;
      }
    return memory.length ? memory.shift() : next("none", rules.none);
  }

  const isQuit = text => rules.quit.includes(text.toLowerCase().replace(/[^a-z']/g, ""));

  return { initial: rules.initial, final: rules.final, reply, isQuit };
}
