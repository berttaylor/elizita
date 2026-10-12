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

export function createEliza(rules) {
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
    if (pieces) memories.push(assemble(rule.reasmb, pieces));
  }

  const nomatch = () => (rules.nomatch ? rules.nomatch[limit - 1] : next(" none", rules.none));

  function reply(text) {
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

    if (!stack.length && limit === 4 && memories.length) return memories.shift();

    while (stack.length) {
      const key = stack.shift();
      if (!has(rules.keywords, key)) return nomatch(); // a goto to a missing keyword
      const entry = rules.keywords[key];
      if (rules.memory && key === rules.memory.keyword) remember(words);

      const list = entry.rules || [];
      let index = -1, pieces = null;
      while (!pieces && ++index < list.length) pieces = match(patternTokens(list[index].decomp), words);
      if (!pieces) {
        if (!entry.goto) return nomatch();
        stack.unshift(entry.goto);
        continue;
      }

      const action = next(`${key}/${index}`, list[index].reasmb);
      if (action === "newkey") continue; // try the next keyword, or fall through to "none"
      if (typeof action === "object") { // { pre, goto }: rewrite the input, then hand it on
        words = assemble(action.pre, pieces, null).split(" ");
        stack.unshift(action.goto);
      } else if (action.startsWith("goto ")) {
        stack.unshift(action.slice(5));
      } else {
        return assemble(action, pieces);
      }
    }
    return next(" none", rules.none);
  }

  const isQuit = text => (rules.quit || []).includes(text.toUpperCase().replace(/[^A-Z']/g, ""));

  return { initial: rules.initial, final: rules.final, reply, isQuit };
}
