"""ELIZA engine, Python twin of eliza.js. Stdlib only, Python 3.9+.

    python3 eliza.py [rules.json]   chat in the terminal
    python3 eliza.py --test         run cases.json (same cases as node test.mjs)
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent


class Eliza:
    def __init__(self, rules):
        self.rules = rules
        self.initial = rules["initial"]
        self.final = rules["final"]
        self.counters = {}  # "keyword/ruleIndex" -> how many times that rule has fired
        self.memory = []    # replies saved by "memory" rules, said later when stuck

    # A word plus its synonyms: group("sad") -> ["sad", "unhappy", "depressed", "sick"]
    def group(self, name):
        return [name] + self.rules["synonyms"].get(name, [])

    # "* i @desire *" -> ^\s*(.*?)\s*\bi\b\s*\b(desire|want|need)\b\s*(.*?)\s*$
    def compile(self, decomp):
        parts = []
        for token in decomp.split():
            if token == "*":
                parts.append(r"(.*?)")
            elif token.startswith("@"):
                parts.append(r"\b(" + "|".join(self.group(token[1:])) + r")\b")
            else:
                parts.append(r"\b" + token + r"\b")
        return re.compile(r"^\s*" + r"\s*".join(parts) + r"\s*$")

    # Cycle through a list so the same input gets a different reply next time.
    def next(self, key, items):
        i = self.counters.get(key, 0)
        self.counters[key] = i + 1
        return items[i % len(items)]

    # "i hate my job" -> "you hate your job"
    def reflect(self, text):
        return " ".join(self.rules["post"].get(w, w) for w in text.split()).strip()

    # Lowercase, apply "pre" substitutions, split into sentences on . , ? !
    def sentences(self, text):
        text = re.sub(r"[^a-z0-9'.,?! ]", " ", text.lower())
        text = re.sub(r"([.,?!])", r" \1 ", text)
        words = [self.rules["pre"].get(w, w) for w in text.split()]
        return [s.strip() for s in re.split(r"[.,?!]", " ".join(words)) if s.strip()]

    # Keywords found in the sentence, highest rank first (ties: first seen first).
    def keywords_in(self, sentence):
        found = []
        for word in sentence.split(" "):
            for key in self.rules["keywords"]:
                if key not in found and word in self.group(key["word"]):
                    found.append(key)
        return sorted(found, key=lambda k: -k["rank"])

    def try_keyword(self, key, sentence):
        for i, rule in enumerate(key["rules"]):
            match = self.compile(rule["decomp"]).match(sentence)
            if not match:
                continue
            template = self.next(f"{key['word']}/{i}", rule["reasmb"])
            if template.startswith("goto "):
                target = next((k for k in self.rules["keywords"] if k["word"] == template[5:]), None)
                if target is None:
                    raise ValueError(f'rules: "{template}" names no keyword')
                reply = self.try_keyword(target, sentence)
                if reply:
                    return reply
                continue
            reply = re.sub(r"\((\d+)\)", lambda m: self.capture(match, int(m.group(1))), template)
            if not rule.get("memory"):
                return reply
            self.memory.append(reply)
        return None

    def capture(self, match, n):
        return self.reflect(match.group(n) or "") if n <= len(match.groups()) else ""

    def reply(self, text):
        for sentence in self.sentences(text):
            for key in self.keywords_in(sentence):
                answer = self.try_keyword(key, sentence)
                if answer:
                    return answer
        return self.memory.pop(0) if self.memory else self.next("none", self.rules["none"])

    def is_quit(self, text):
        return re.sub(r"[^a-z']", "", text.lower()) in self.rules["quit"]


def load(path):
    return json.loads(Path(path).read_text())


def run_tests():
    rules = load(HERE / "rules.json")
    failed = 0
    for case in load(HERE / "cases.json"):
        eliza = Eliza(rules)
        for given, expected in case["turns"]:
            got = eliza.reply(given)
            if got != expected:
                failed += 1
                print(f"FAIL {case['name']}\n  > {given}\n  expected: {expected}\n  got:      {got}")
    print(f"{failed} failed" if failed else "all passed")
    return 1 if failed else 0


def chat(path):
    eliza = Eliza(load(path))
    print(eliza.initial)
    while True:
        try:
            text = input("> ")
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if eliza.is_quit(text):
            break
        print(eliza.reply(text))
    print(eliza.final)


if __name__ == "__main__":
    if sys.argv[1:] == ["--test"]:
        sys.exit(run_tests())
    chat(sys.argv[1] if len(sys.argv) > 1 else HERE / "rules.json")
