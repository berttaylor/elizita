// Convert a folder of AIML 1.0 files into an elizita rules file (the "categories" format).
// usage: node tools/aiml2json.mjs <aiml-folder> <header.json> > rules/<id>.json
// The header supplies everything AIML files don't: name, about, bot properties, word maps.
// Later files win when two categories share the same pattern/that/topic, as AIML loaders do.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [folder, headerPath] = process.argv.slice(2);
const header = JSON.parse(readFileSync(headerPath, "utf8"));
const skip = new RegExp(header._skipFiles || "^$");

// Tiny XML reader: AIML only needs elements, attributes, text and comments.
function parseXML(text) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  for (const [token] of text.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/?[^>]+>|[^<]+/g)) {
    if (token.startsWith("<!--") || token.startsWith("<?")) continue;
    const top = stack[stack.length - 1];
    if (token.startsWith("</")) { if (stack.length > 1) stack.pop(); continue; }
    if (token.startsWith("<")) {
      const [, tag, rest] = token.match(/^<\s*([^\s/>]+)([\s\S]*?)\/?>$/);
      const attrs = Object.fromEntries([...rest.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)].map(m => [m[1], m[2]]));
      const el = { tag: tag.toLowerCase(), attrs, children: [] };
      top.children.push(el);
      if (!token.endsWith("/>")) stack.push(el);
      continue;
    }
    top.children.push(token.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
  }
  return root;
}

const text = el => el.children.map(c => (typeof c === "string" ? c : text(c))).join("");
const index = el => parseInt(el.attrs.index || "1", 10) || 1;

// AIML template element -> JSON template node (see README for the node list).
function convert(nodes) {
  const out = [];
  for (const n of nodes) {
    if (typeof n === "string") { if (n) out.push(n.replace(/\s+/g, " ")); continue; }
    const kids = () => convert(n.children);
    const starOr = () => (n.children.length ? kids() : [{ star: index(n) }]);
    switch (n.tag) {
      case "star": case "thatstar": case "topicstar": case "input": out.push({ [n.tag]: index(n) }); break;
      case "that": out.push({ that: index(n) }); break;
      case "request": out.push({ input: index(n) }); break;
      case "response": out.push({ that: index(n) }); break;
      case "sr": out.push({ srai: [{ star: 1 }] }); break;
      case "srai": out.push({ srai: kids() }); break;
      case "get": out.push({ get: n.attrs.name }); break;
      case "bot": out.push({ bot: n.attrs.name }); break;
      case "set": out.push({ set: n.attrs.name, to: kids() }); break;
      case "think": out.push({ think: kids() }); break;
      case "random": out.push({ random: n.children.filter(c => c.tag === "li").map(li => convert(li.children)) }); break;
      case "person": case "person2": case "gender": out.push({ [n.tag]: starOr() }); break;
      case "uppercase": case "lowercase": case "formal": case "sentence": out.push({ [n.tag]: kids() }); break;
      case "date": out.push({ date: n.attrs.format || "" }); break;
      case "br": case "p": out.push(" "); break;
      case "condition": {
        const cases = n.attrs.value !== undefined
          ? [{ name: n.attrs.name, value: n.attrs.value, then: kids() }]
          : n.children.filter(c => c.tag === "li").map(li => ({
              ...(li.attrs.name || n.attrs.name ? { name: li.attrs.name || n.attrs.name } : {}),
              ...(li.attrs.value !== undefined ? { value: li.attrs.value } : {}),
              then: convert(li.children),
            }));
        out.push({ condition: cases });
        break;
      }
      case "learn": case "eval": case "img": case "id": case "size": case "version": break;
      default: out.push(...kids()); // <em>, <a>, <ul> and typos: keep the text inside
    }
  }
  return out;
}

const normalise = s => s.replace(/\s+/g, " ").trim().toUpperCase();
const categories = new Map();
for (const file of readdirSync(folder).filter(f => f.endsWith(".aiml") && !skip.test(f)).sort()) {
  const aiml = parseXML(readFileSync(join(folder, file), "latin1")).children.find(c => c.tag === "aiml");
  const add = (cat, topic) => {
    const part = tag => cat.children.find(c => c.tag === tag);
    const pat = part("pattern");
    if (!pat || !part("template")) return;
    if (pat.children.some(c => typeof c !== "string" && c.tag !== "bot")) return; // e.g. <eval> in learn files
    const pattern = normalise(pat.children.map(c => (typeof c === "string" ? c : header.bot[c.attrs.name] || "")).join(""));
    const that = part("that") ? normalise(text(part("that"))) : "*";
    const cat2 = { pattern };
    if (that !== "*") cat2.that = that;
    if (topic && topic !== "*") cat2.topic = topic;
    cat2.template = convert(part("template").children);
    categories.set(`${pattern}|${that}|${topic || "*"}`, cat2);
  };
  for (const el of aiml.children) {
    if (el.tag === "category") add(el);
    if (el.tag === "topic") for (const c of el.children) if (c.tag === "category") add(c, normalise(el.attrs.name));
  }
}

// One category per line keeps a 50,000-rule file readable and diffable.
const { _skipFiles, ...rest } = header;
const json = JSON.stringify({ ...rest, categories: [] }, null, 2);
const list = [...categories.values()].map(c => "    " + JSON.stringify(c)).join(",\n");
console.log(json.replace('"categories": []', `"categories": [\n${list}\n  ]`));
