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

export function createEliza(rules, { random = Math.random } = {}) {
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
  function keywordReply(text) {
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
    return none();
  }

  // ---- AIML-style categories (opt-in: only when the rules file has "categories") ----
  // Whole-sentence patterns, matched with Wallace's "Graphmaster": a word tree over
  // PATTERN <THAT> previous-reply <TOPIC> topic. "_" beats an exact word, which beats "*".
  const vars = {};                 // things the user told us (<set>/<get>)
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

  // Answer one sentence (also used by <srai>). Returns null when no category matches.
  function answer(words, depth) {
    if (depth > 16) return "";
    const topic = vars.topic ? vars.topic.split(" ") : ["UNKNOWN"];
    const path = [...words, "<THAT>", ...lastSentence(said[said.length - 1]), "<TOPIC>", ...topic];
    const upper = path.map(w => w.toUpperCase());
    const found = graphmaster(graph, upper, 0, 0, []);
    if (!found) return null;
    const { category, stars } = found;
    trace.push(`${"  ".repeat(depth)}matched ${category.pattern}${category.that ? ` (after "${category.that}")` : ""}`);
    const star = (section, n) => {
      const s = stars.filter(s => s.section === section)[n - 1];
      return s ? path.slice(s.from, s.to).join(" ") : "";
    };

    function render(node) {
      if (typeof node === "string") return node;
      if (Array.isArray(node)) return node.map(render).join("");
      const [tag] = Object.keys(node);
      const value = node[tag];
      switch (tag) {
        case "star": return star(0, value);
        case "thatstar": return star(1, value);
        case "topicstar": return star(2, value);
        case "input": return heard[heard.length - value] || "";
        case "that": return said[said.length - value] || "";
        case "get": return vars[value] || "";
        case "bot": return has(rules.bot, value) ? rules.bot[value] : "";
        case "set": return (vars[value] = render(node.to).replace(/\s+/g, " ").trim());
        case "think": render(value); return "";
        case "random": return render(value[Math.floor(random() * value.length)]);
        case "condition": {
          const pick = value.find(c => c.value === undefined ||
            (c.value === "*" ? !!vars[c.name] : (vars[c.name] || "").toUpperCase() === c.value.toUpperCase()));
          return pick ? render(pick.then) : "";
        }
        case "srai": {
          const query = render(value);
          trace.push(`${"  ".repeat(depth)}srai: ask again as "${query.trim()}"`);
          return sentencesOf(query).map(s => answer(s, depth + 1) ?? "").join(" ");
        }
        case "person": return swapWords(render(value), rules.reflect || {});
        case "person2": return swapWords(render(value), rules.person2 || {});
        case "gender": return swapWords(render(value), rules.gender || {});
        case "uppercase": return render(value).toUpperCase();
        case "lowercase": return render(value).toLowerCase();
        case "formal": return render(value).replace(/\b\w/g, c => c.toUpperCase());
        case "sentence": return render(value).replace(/^\s*\w/, c => c.toUpperCase());
        case "date": return new Date().toLocaleString();
        default: return "";
      }
    }
    // Tidy what empty <get>s leave behind: "Do you think, , that" -> "Do you think, that".
    return render(category.template).replace(/\s+/g, " ").replace(/\s+([,.?!])/g, "$1")
      .replace(/,(\s*,)+/g, ",").trim();
  }

  function categoryReply(text) {
    const replies = sentencesOf(text).map(words => {
      heard.push(words.join(" "));
      const reply = answer(words, 0) ?? (rules.keywords ? keywordReply(words.join(" ")) : none());
      said.push(reply);
      return reply;
    });
    return replies.join(" ") || none();
  }

  const trace = []; // why the last reply was given, step by step (shown in the UI)
  function reply(text) {
    trace.length = 0;
    return graph ? categoryReply(text) : keywordReply(text);
  }

  const isQuit = text => (rules.quit || []).includes(text.toUpperCase().replace(/[^A-Z']/g, ""));

  return { initial: rules.initial, final: rules.final, reply, isQuit, trace };
}
