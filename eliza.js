// ELIZA engine: Weizenbaum's 1966 algorithm, generalised. It knows nothing about any
// particular script: everything it says comes from a rules file (rules/*.json, see README).
// Anything beyond 1966 is an opt-in field in the rules, so a 1966 script runs as it did in 1966.
// Algorithm details follow Anthony Hay's CC0 recreation (github.com/anthay/ELIZA), which was
// checked against the original MAD-SLIP listing.

const has = (obj, key) => obj != null && Object.prototype.hasOwnProperty.call(obj, key);

// IBM 7094 six-bit BCD ("Hollerith") character codes: a character's code is its index here.
const BCD = "0123456789\0='\0\0\0+ABCDEFGHI\0.)\0\0\0-JKLMNOPQR\0$*\0\0\0 /STUVWXYZ\0,(\0\0\0";

// The last chunk of up to 6 characters of a word, packed as 36-bit BCD the way SLIP stored it.
export function lastChunkBCD(word) {
  const start = word.length ? Math.floor((word.length - 1) / 6) * 6 : 0;
  let d = 0n;
  for (const c of word.slice(start).padEnd(6, " ")) {
    const code = BCD.indexOf(c);
    d = (d << 6n) | BigInt(code >= 0 ? code : c.charCodeAt(0) & 0x3f);
  }
  return d;
}

// SLIP's HASH(D, N): the middle N bits of D squared (D taken as a 35-bit magnitude).
export function hash(d, n) {
  d &= 0x7ffffffffn;
  d = (d * d) >> BigInt(35 - Math.floor(n / 2));
  return Number(d & ((1n << BigInt(n)) - 1n));
}

// "HELLO, how are you?" -> ["HELLO", ",", "HOW", "ARE", "YOU", "."]
function tokenize(text) {
  return text.toUpperCase()
    .replace(/’/g, "'")
    .replace(/[?!]/g, ".")
    .replace(/[;:–—]/g, ",")
    .replace(/[‘`"«»‚‛“”„‟‹›¡¿]/g, " ")
    .replace(/([.,])/g, " $1 ")
    .split(/\s+/).filter(Boolean);
}

// "* YOU (* WANT NEED) *" -> ["*", "YOU", "(* WANT NEED)", "*"]
const patternTokens = decomp => decomp.match(/\([^)]*\)|\S+/g);

// Load rules/<id>.json, resolving "include" (merge other rule sets' categories and word maps in)
// and "fallback" (a whole other rule set to hand over to). getJSON/getBytes do the fetching, so
// this works the same in the browser and in node.
export async function loadRules(id, getJSON, getBytes) {
  const own = await getJSON(`rules/${id}.json`);
  let rules = {};
  for (const other of own.include || []) rules = mergeRules(rules, await loadRules(other, getJSON, getBytes));
  rules = mergeRules(rules, own);
  rules.includes = own.include || [];
  if (own.fallback) rules.fallback = await loadRules(own.fallback, getJSON, getBytes);
  if (own.meaning?.vectorsFile) {
    rules.meaning = { ...own.meaning, vectors: new Int8Array(await getBytes(`rules/${own.meaning.vectorsFile}`)) };
  }
  return rules;
}

const MAPS = ["substitute", "reflect", "person2", "gender", "bot", "tags", "keywords", "moods"];
export function mergeRules(base, extra) {
  const out = { ...base, ...extra };
  for (const key of MAPS) if (base[key] || extra[key]) out[key] = { ...base[key], ...extra[key] };
  if (base.categories || extra.categories) out.categories = [...(base.categories || []), ...(extra.categories || [])];
  delete out.include;
  return out;
}

// Cosine similarity of two vectors (the model's vectors are unit length, int8 ones nearly so).
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / Math.sqrt(na * nb || 1);
}

export function createEliza(rules, { random = Math.random, embed = null } = {}) {
  const delimiters = rules.delimiters || [",", "."];
  const counters = {}; // "KEYWORD/ruleIndex" -> how many times that rule has fired
  const memories = []; // replies saved by the memory rules, said later
  let limit = 1;       // Weizenbaum's "certain counting mechanism": cycles 1, 2, 3, 4

  // Cycle through a list so the same input gets a different reply next time.
  function next(key, list) {
    const i = counters[key] || 0;
    counters[key] = i + 1;
    return list[i % list.length];
  }

  // Does one pattern token match one word? "(* A B)" = any of A, B; "(/TAG ...)" = any tagged word.
  function wordMatches(token, word) {
    if (!token.startsWith("(")) return token === word;
    const inner = token.slice(1, -1).trim();
    const names = inner.slice(1).trim().split(/\s+/);
    if (inner.startsWith("*")) return names.includes(word);
    return names.some(tag => has(rules.tags, tag) && rules.tags[tag].includes(word));
  }

  // Match pattern tokens against words. Returns one text piece per token, or null.
  // "*" takes any number of words (fewest first), a number N takes exactly N words.
  function match(pattern, words) {
    if (!pattern.length) return words.length ? null : [];
    const [token, ...rest] = pattern;
    const take = n => {
      const tail = match(rest, words.slice(n));
      return tail && [words.slice(0, n).join(" "), ...tail];
    };
    if (token === "*") {
      for (let n = 0; n <= words.length; n++) {
        const found = take(n);
        if (found) return found;
      }
      return null;
    }
    if (/^\d+$/.test(token)) return words.length >= +token ? take(+token) : null;
    return words.length && wordMatches(token, words[0]) ? take(1) : null;
  }

  // "WHY DO YOU SAY YOUR (3)" + pieces -> reply text. "reflect" (opt-in) swaps words in pieces.
  function assemble(template, pieces, reflect = rules.reflect) {
    return template.replace(/\((\d+)\)/g, (_, n) => {
      const piece = n > 0 && n <= pieces.length ? pieces[n - 1] : "HMMM";
      return reflect ? piece.split(" ").map(w => (has(reflect, w) ? reflect[w] : w)).join(" ") : piece;
    }).split(/\s+/).filter(Boolean).join(" ");
  }

  // The memory keyword's rule is picked by hashing the input's last word, as in 1966.
  function remember(words) {
    const { rules: list } = rules.memory;
    const rule = list[hash(lastChunkBCD(words[words.length - 1] || ""), 2) % list.length];
    const pieces = match(patternTokens(rule.decomp), words);
    if (!pieces) return;
    memories.push(assemble(rule.reasmb, pieces));
    trace.push(`memory saved: ${memories[memories.length - 1]}`);
  }

  function none() {
    trace.push("no keyword: say the next \"none\" line");
    return next(" none", rules.none);
  }
  function nomatch() {
    trace.push(`no pattern matched: built-in message ${limit}`);
    return rules.nomatch ? rules.nomatch[limit - 1] : next(" none", rules.none);
  }

  // The 1966 keyword algorithm.
  // quiet: return null instead of a "none" line when no keyword is found (used as a fallback).
  function keywordReply(text, { quiet = false } = {}) {
    let words = tokenize(text);
    limit = (limit % 4) + 1;

    // Scan for keywords, keeping only the first clause that has one, and substitute words.
    // A keyword that outranks everything so far goes on top of the stack, others at the bottom.
    const stack = [];
    let top = 0;
    for (let i = 0; i < words.length; ) {
      const word = words[i];
      if (delimiters.includes(word)) {
        if (!stack.length) { words = words.slice(i + 1); i = 0; continue; }
        words = words.slice(0, i);
        break;
      }
      if (has(rules.keywords, word)) {
        const rank = rules.keywords[word].rank || 0;
        if (rank > top) { stack.unshift(word); top = rank; } else stack.push(word);
      }
      // A substitute may be several words ("I'M" -> "I AM"); they are not scanned again.
      const swap = has(rules.substitute, word) ? rules.substitute[word].split(" ") : [word];
      words.splice(i, 1, ...swap);
      i += swap.length;
    }
    trace.push(`clause: ${words.join(" ")}`);
    if (stack.length) trace.push(`keywords: ${stack.join(", ")}`);

    if (!stack.length && limit === 4 && memories.length) {
      trace.push("no keyword, and the counter is at 4: recall a memory");
      return memories.shift();
    }
    if (!stack.length && quiet) return null;

    while (stack.length) {
      const key = stack.shift();
      if (!has(rules.keywords, key)) return nomatch(); // a goto to a missing keyword
      const entry = rules.keywords[key];
      trace.push(`keyword ${key}${entry.rank ? ` (priority ${entry.rank})` : ""}`);
      if (rules.memory && key === rules.memory.keyword) remember(words);

      const list = entry.rules || [];
      let index = -1, pieces = null;
      while (!pieces && ++index < list.length) pieces = match(patternTokens(list[index].decomp), words);
      if (!pieces) {
        if (!entry.goto) return nomatch();
        trace.push(`no pattern matched: goto ${entry.goto}`);
        stack.unshift(entry.goto);
        continue;
      }

      const replies = list[index].reasmb;
      const action = next(`${key}/${index}`, replies);
      trace.push(`pattern ${list[index].decomp}: reply ${replies.indexOf(action) + 1} of ${replies.length}`);
      if (action === "newkey") { trace.push("newkey: try the next keyword"); continue; }
      if (typeof action === "object") { // { pre, goto }: rewrite the input, then hand it on
        words = assemble(action.pre, pieces, null).split(" ");
        trace.push(`rewrite to "${words.join(" ")}", goto ${action.goto}`);
        stack.unshift(action.goto);
      } else if (action.startsWith("goto ")) {
        trace.push(action);
        stack.unshift(action.slice(5));
      } else {
        return assemble(action, pieces);
      }
    }
    return quiet ? null : none();
  }

  // ---- AIML-style categories (opt-in: only when the rules file has "categories") ----
  // Whole-sentence patterns, matched with Wallace's "Graphmaster": a word tree over
  // PATTERN <THAT> previous-reply <TOPIC> topic. "_" beats an exact word, which beats "*".
  const vars = {};                 // things the user told us (<set>/<get>)
  const facts = {};                // the subset set under a computed name ("sister" -> "Ann")
  const heard = [], said = [];     // history for <input> and <that>
  let graph = null;
  if (rules.categories) {
    graph = Object.create(null);
    for (const cat of rules.categories) {
      let node = graph;
      const path = `${cat.pattern} <THAT> ${cat.that || "*"} <TOPIC> ${cat.topic || "*"}`.split(" ");
      for (const word of path) node = node[word] ??= Object.create(null);
      node[" category"] = cat;
    }
  }

  // Text -> sentences of words, keeping the user's case (matching uses uppercase copies).
  function sentencesOf(text) {
    return text.replace(/’/g, "'").split(/[.?!]+/).map(sentence => sentence
      .replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean)
      .flatMap(word => {
        const key = word.toUpperCase();
        if (!has(rules.substitute, key)) return [word];
        const swap = rules.substitute[key].split(" ");
        return word === word.toLowerCase() ? swap.map(w => w.toLowerCase()) : swap;
      }))
      .filter(words => words.length);
  }

  // Depth-first search; wildcards take one or more words but never cross <THAT>/<TOPIC>.
  function graphmaster(node, path, i, section, stars) {
    if (i === path.length) return node[" category"] ? { category: node[" category"], stars } : null;
    const word = path[i];
    for (const key of ["_", word, "*"]) {
      const child = node[key];
      if (!child) continue;
      if (key === word) {
        const step = word === "<THAT>" || word === "<TOPIC>" ? 1 : 0;
        const found = graphmaster(child, path, i + 1, section + step, stars);
        if (found) return found;
        continue;
      }
      for (let j = i + 1; j <= path.length && path[j - 1] !== "<THAT>" && path[j - 1] !== "<TOPIC>"; j++) {
        const found = graphmaster(child, path, j, section, [...stars, { section, from: i, to: j }]);
        if (found) return found;
      }
    }
    return null;
  }

  const swapWords = (text, map) =>
    text.split(/\s+/).map(w => (has(map, w.toUpperCase()) ? map[w.toUpperCase()] : w)).join(" ");
  const lastSentence = text => sentencesOf(text || "").pop() || ["UNKNOWN"];
  const indent = depth => "  ".repeat(depth);

  // ---- Meaning (opt-in "meaning"): when only a catch-all pattern fits, find the pattern
  // closest in meaning using a small sentence-embedding model, and answer that instead.
  const embedded = new Map(); // text -> vector, so each sentence is embedded once
  const embedText = async text => {
    if (!embedded.has(text)) embedded.set(text, await embed(text));
    return embedded.get(text);
  };
  let meaningVectors = null; // one vector per rules.meaning.patterns entry
  async function closestMeaning(text) {
    const { patterns, vectors } = rules.meaning;
    if (!meaningVectors) {
      if (vectors) { // precomputed int8 vectors, packed one after another
        const dim = vectors.length / patterns.length;
        meaningVectors = patterns.map((_, i) => vectors.subarray(i * dim, (i + 1) * dim));
      } else {
        meaningVectors = [];
        for (const pattern of patterns) meaningVectors.push(await embedText(pattern.toLowerCase()));
      }
    }
    const query = await embedText(text);
    let best = { score: -1, pattern: null };
    meaningVectors.forEach((v, i) => {
      const score = cosine(query, v);
      if (score > best.score) best = { score, pattern: patterns[i] };
    });
    return best;
  }

  // ---- Moods (opt-in "moods"), after Colby's PARRY: levels that example phrases push up or down.
  const levels = {};
  for (const name of Object.keys(rules.moods || {})) vars[name] = String((levels[name] = rules.moods[name].start || 0));
  const meter = (name) => {
    const { max = 20 } = rules.moods[name];
    const filled = Math.round((levels[name] / max) * 10);
    return `${name} ${"▮".repeat(filled)}${"▯".repeat(10 - filled)} ${levels[name]}`;
  };
  async function updateMoods(text) {
    const threshold = rules.moodThreshold ?? 0.5;
    // Judge each clause on its own: "I'm sorry, I believe you" is two signals, not one blur.
    const clauses = text.split(/[,.;:!?]+/).map(c => c.trim().toLowerCase()).filter(Boolean);
    for (const [name, mood] of Object.entries(rules.moods)) {
      let best = { score: threshold, phrase: null, sign: 0 };
      for (const clause of clauses)
        for (const [list, sign] of [[mood.up || [], 1], [mood.down || [], -1]])
          for (const phrase of list) {
            const score = cosine(await embedText(clause), await embedText(phrase));
            if (score > best.score) best = { score, phrase, sign };
          }
      const before = levels[name];
      const decayed = Math.max(0, before - (mood.decay ?? 1));
      const moved = best.sign ? decayed + best.sign * (mood.step ?? 4) : decayed;
      levels[name] = Math.min(mood.max ?? 20, Math.max(0, moved));
      vars[name] = String(levels[name]);
      const change = levels[name] - before;
      const why = best.sign ? `: sounded like "${best.phrase}" (${best.score.toFixed(2)})` : "";
      trace.push(`${meter(name)}${change ? ` (${change > 0 ? "+" : ""}${change}${why})` : ""}`);
    }
  }
  let ended = false;
  function leaving() {
    const leave = rules.leave;
    if (!leave) return null;
    const why = Object.entries(leave.when).find(([name, level]) => levels[name] >= level);
    if (!why) return null;
    ended = true;
    trace.push(`${why[0]} reached ${why[1]}: leave the conversation`);
    return leave.say;
  }

  // Answer one sentence (also used by <srai>). Returns null when no category matches.
  async function answer(words, depth) {
    if (depth > 16) return "";
    const topic = vars.topic ? vars.topic.split(" ") : ["UNKNOWN"];
    const path = [...words, "<THAT>", ...lastSentence(said[said.length - 1]), "<TOPIC>", ...topic];
    const upper = path.map(w => w.toUpperCase());
    const found = graphmaster(graph, upper, 0, 0, []);
    if (!found) return null;
    const { category, stars } = found;

    // Only a catch-all (*) or a loose pattern (one word plus wildcards, like MY *) fitted:
    // try the closest pattern by meaning; for a pure catch-all, then the fallback system.
    const literals = category.pattern.split(" ").filter(w => w !== "*" && w !== "_").length;
    const catchAll = literals === 0, loose = literals === 1 && /[*_]/.test(category.pattern);
    if (depth === 0 && !category.that && (catchAll || loose)) {
      const sentence = words.join(" ");
      if (rules.meaning && embed) {
        const best = await closestMeaning(sentence.toLowerCase());
        const threshold = rules.meaning.threshold ?? 0.6;
        const fits = best.score >= threshold;
        trace.push(`${catchAll ? "no exact match" : `only a loose match (${category.pattern})`}; ` +
          `closest meaning "${best.pattern}" (${best.score.toFixed(2)})${fits ? "" : `, below ${threshold}`}`);
        if (fits) return answer(best.pattern.split(" "), depth + 1);
      }
      if (catchAll && fallback) {
        trace.push(`hand over to ${rules.fallback.name}`);
        fallback.trace.length = 0;
        const reply = await fallback.reply(sentence, { quiet: true });
        trace.push(...fallback.trace);
        if (reply) return reply;
        trace.push(`${rules.fallback.name} had no keyword`);
      }
    }

    trace.push(`${indent(depth)}matched ${category.pattern}${category.that ? ` (after "${category.that}")` : ""}`);
    const star = (section, n) => {
      const s = stars.filter(s => s.section === section)[n - 1];
      return s ? path.slice(s.from, s.to).join(" ") : "";
    };
    // A computed variable name ("my sister's name is Ann" -> "sister").
    const nameOf = async value =>
      typeof value === "string" ? value : (await render(value)).trim().toLowerCase().replace(/'s$/, "");

    async function render(node) {
      if (typeof node === "string") return node;
      if (Array.isArray(node)) {
        let out = "";
        for (const n of node) out += await render(n); // in order: <set> must happen before <get>
        return out;
      }
      const [tag] = Object.keys(node);
      const value = node[tag];
      switch (tag) {
        case "star": return star(0, value);
        case "thatstar": return star(1, value);
        case "topicstar": return star(2, value);
        case "input": return heard[heard.length - value] || "";
        case "that": return said[said.length - value] || "";
        case "get": return vars[await nameOf(value)] || "";
        case "bot": return has(rules.bot, value) ? rules.bot[value] : "";
        case "set": {
          const name = await nameOf(value);
          const to = (await render(node.to)).replace(/\s+/g, " ").trim();
          if (typeof value !== "string") { facts[name] = to; trace.push(`${indent(depth)}remember: ${name} = ${to}`); }
          return (vars[name] = to);
        }
        case "key": return nameOf(value); // a computed name as text: "sister's" -> "sister"
        case "facts": // everything remembered, or the given text when there is nothing yet
          return Object.entries(facts).map(([k, v]) => `your ${k} is ${v}`).join(", ") || (typeof value === "string" ? value : "");
        case "think": await render(value); return "";
        case "random": return render(value[Math.floor(random() * value.length)]);
        case "condition": {
          const names = [];
          for (const c of value) names.push(c.name === undefined ? undefined : await nameOf(c.name));
          const fits = (c, i) => {
            const v = vars[names[i]] || "";
            if (c.above !== undefined) return Number(v) > c.above;
            if (c.below !== undefined) return Number(v) < c.below;
            if (c.value === undefined) return true;
            return c.value === "*" ? !!v : v.toUpperCase() === c.value.toUpperCase();
          };
          const pick = value.find(fits);
          return pick ? render(pick.then) : "";
        }
        case "srai": {
          const query = await render(value);
          trace.push(`${indent(depth)}srai: ask again as "${query.trim()}"`);
          const parts = [];
          for (const s of sentencesOf(query)) parts.push((await answer(s, depth + 1)) ?? "");
          return parts.join(" ");
        }
        case "person": return swapWords(await render(value), rules.reflect || {});
        case "person2": return swapWords(await render(value), rules.person2 || {});
        case "gender": return swapWords(await render(value), rules.gender || {});
        case "uppercase": return (await render(value)).toUpperCase();
        case "lowercase": return (await render(value)).toLowerCase();
        case "formal": return (await render(value)).replace(/\b\w/g, c => c.toUpperCase());
        case "sentence": return (await render(value)).replace(/^\s*\w/, c => c.toUpperCase());
        case "date": return new Date().toLocaleString();
        default: return "";
      }
    }
    // Tidy what empty <get>s leave behind: "Do you think, , that" -> "Do you think, that".
    return (await render(category.template)).replace(/\s+/g, " ").replace(/\s+([,.?!])/g, "$1")
      .replace(/,(\s*,)+/g, ",").replace(/,([.?!])/g, "$1").trim();
  }

  async function categoryReply(text) {
    if (rules.moods && embed) {
      await updateMoods(text);
      const bye = leaving();
      if (bye) return bye;
    }
    const replies = [];
    for (const words of sentencesOf(text)) {
      heard.push(words.join(" "));
      const reply = (await answer(words, 0)) ?? (rules.keywords ? keywordReply(words.join(" ")) : none());
      said.push(reply);
      replies.push(reply);
    }
    return replies.join(" ") || none();
  }

  const fallback = rules.fallback ? createEliza(rules.fallback, { random, embed }) : null;
  const trace = []; // why the last reply was given, step by step (shown under each reply)
  async function reply(text, { quiet = false } = {}) {
    trace.length = 0;
    return graph ? categoryReply(text) : keywordReply(text, { quiet });
  }

  const isQuit = text => (rules.quit || []).includes(text.toUpperCase().replace(/[^A-Z']/g, ""));
  const moods = () => Object.keys(levels).map(name => ({ name, level: levels[name], max: rules.moods[name].max ?? 20, meter: meter(name) }));

  return { initial: rules.initial, final: rules.final, reply, isQuit, trace, moods, get ended() { return ended; } };
}
