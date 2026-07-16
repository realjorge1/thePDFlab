/**
 * Tiny safe arithmetic evaluator for the QC number pad.
 *
 * Supports + − × ÷ ^ √ π, parentheses, unary minus, e-notation and implicit
 * multiplication (2π, 3(4), 2√5). Deterministic and dependency-free — no
 * `eval`, no globals. Throws on anything it cannot parse so callers can fall
 * back to treating the input as plain text.
 *
 * Adapted from the GozlinScientia keypad evaluator (services/scientiaCompute.ts).
 */

type Tok =
  | { t: "num"; v: number }
  | { t: "op"; v: string }
  | { t: "(" }
  | { t: ")" };

function tokenize(src: string): Tok[] {
  const s = src
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/,/g, ".")
    .replace(/%/g, "*0.01");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if ((c >= "0" && c <= "9") || c === ".") {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      if (
        j < s.length &&
        (s[j] === "e" || s[j] === "E") &&
        /[0-9+-]/.test(s[j + 1] ?? "")
      ) {
        j++;
        if (s[j] === "+" || s[j] === "-") j++;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
      }
      const num = parseFloat(s.slice(i, j));
      if (!isFinite(num)) throw new Error("bad number");
      out.push({ t: "num", v: num });
      i = j;
      continue;
    }
    if (c === "π") {
      out.push({ t: "num", v: Math.PI });
      i++;
      continue;
    }
    if (c === "√") {
      out.push({ t: "op", v: "√" });
      i++;
      continue;
    }
    if ("+-*/^".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(") {
      out.push({ t: "(" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: ")" });
      i++;
      continue;
    }
    throw new Error("unexpected char: " + c);
  }
  return out;
}

/** Evaluate an arithmetic expression. Throws when the input is not valid. */
export function evalExpr(src: string): number {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const eat = () => toks[pos++];

  // expr = term (('+'|'-') term)*
  function expr(): number {
    let v = term();
    while (
      peek() &&
      peek().t === "op" &&
      ((peek() as any).v === "+" || (peek() as any).v === "-")
    ) {
      const op = (eat() as any).v;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  // term = factor (('*'|'/' | implicit) factor)*
  function term(): number {
    let v = factor();
    for (;;) {
      const p = peek();
      if (p && p.t === "op" && ((p as any).v === "*" || (p as any).v === "/")) {
        const op = (eat() as any).v;
        const r = factor();
        v = op === "*" ? v * r : v / r;
      } else if (
        p &&
        (p.t === "num" ||
          p.t === "(" ||
          (p.t === "op" && (p as any).v === "√"))
      ) {
        // implicit multiplication: 2π, 3(4), 2√5
        v = v * factor();
      } else break;
    }
    return v;
  }
  // factor = unary ('^' factor)?  (right associative)
  function factor(): number {
    const base = unary();
    const p = peek();
    if (p && p.t === "op" && (p as any).v === "^") {
      eat();
      return Math.pow(base, factor());
    }
    return base;
  }
  // unary = ('-' | '+' | '√') unary | primary
  function unary(): number {
    const p = peek();
    if (p && p.t === "op" && (p as any).v === "-") {
      eat();
      return -unary();
    }
    if (p && p.t === "op" && (p as any).v === "+") {
      eat();
      return unary();
    }
    if (p && p.t === "op" && (p as any).v === "√") {
      eat();
      return Math.sqrt(unary());
    }
    return primary();
  }
  function primary(): number {
    const p = eat();
    if (!p) throw new Error("unexpected end");
    if (p.t === "num") return p.v;
    if (p.t === "(") {
      const v = expr();
      const close = eat();
      if (!close || close.t !== ")") throw new Error("missing )");
      return v;
    }
    throw new Error("unexpected token");
  }

  const result = expr();
  if (pos !== toks.length) throw new Error("trailing tokens");
  if (!isFinite(result)) throw new Error("non-finite");
  return result;
}

/** Evaluate, returning null instead of throwing. */
export function tryEval(src: string): number | null {
  try {
    return evalExpr(src);
  } catch {
    return null;
  }
}
