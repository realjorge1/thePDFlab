// ============================================
// GozlinScientia — local deterministic compute engine
// --------------------------------------------------
// Real calculators don't phone home. This module computes the built-in
// formulas and unit conversions instantly, on-device, with full step-by-step
// working — no network, no LLM latency, exact answers. The workspace falls
// back to the AI backend only for open-ended / symbolic inputs (Ask, Custom,
// derivatives, arbitrary compound molar masses, genetic crosses, …).
//
// Output is shaped exactly like the backend's `ScientiaResult` so the existing
// result panel renders local and remote answers identically.
// ============================================

export interface ComputeResult {
  category: string;
  title: string;
  result: { value: string; unit?: string; formatted?: string };
  formula?: {
    expression?: string;
    variables?: Array<{ symbol: string; name?: string; value: string; unit?: string }>;
  };
  steps?: string[];
  explanation?: string;
  warnings?: string[];
  confidence?: "high" | "medium" | "low";
  related?: string[];
}

type Vars = Record<string, string>;

// ─── Physical constants ───────────────────────────────────────────────────────
const G_GRAV = 6.6743e-11;     // N·m²/kg²
const G_ACC = 9.80665;         // m/s²
const N_AVOGADRO = 6.02214076e23;
const R_GAS = 0.0820573;       // L·atm/(mol·K)
const C_LIGHT = 2.99792458e8;  // m/s
const M_SUN = 1.98892e30;      // kg
const R_SUN = 6.957e8;         // m
const SIGMA_SB = 5.670374e-8;  // W/(m²·K⁴)
const T_SUN = 5778;            // K
const H0_HUBBLE = 70;          // km/s/Mpc

// ─── Safe math expression evaluator ─────────────────────────────────────────
// Keypad entries can contain π, √, ^, parentheses and ×10ⁿ ("e") notation, so a
// plain `parseFloat` won't do and `eval` is unsafe. This recursive-descent
// parser supports: + - * / ^ (right-assoc), unary - and √, π, %, e-notation and
// implicit multiplication (2π, 3(4), √2·√2). Throws on anything it can't parse.

type Tok = { t: "num"; v: number } | { t: "op"; v: string } | { t: "(" } | { t: ")" };

function tokenize(src: string): Tok[] {
  const s = src
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/%/g, "*0.01");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") { i++; continue; }
    if ((c >= "0" && c <= "9") || c === ".") {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      // exponent: e / E followed by optional sign + digits
      if (j < s.length && (s[j] === "e" || s[j] === "E") && /[0-9+-]/.test(s[j + 1] ?? "")) {
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
    if (c === "π") { out.push({ t: "num", v: Math.PI }); i++; continue; }
    if (c === "√") { out.push({ t: "op", v: "√" }); i++; continue; }
    if ("+-*/^".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    if (c === "(") { out.push({ t: "(" }); i++; continue; }
    if (c === ")") { out.push({ t: ")" }); i++; continue; }
    throw new Error("unexpected char: " + c);
  }
  return out;
}

function evalExpr(src: string): number {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const eat = () => toks[pos++];

  // expr = term (('+'|'-') term)*
  function expr(): number {
    let v = term();
    while (peek() && peek().t === "op" && ((peek() as any).v === "+" || (peek() as any).v === "-")) {
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
      } else if (p && (p.t === "num" || p.t === "(" || (p.t === "op" && (p as any).v === "√"))) {
        // implicit multiplication: 2π, 3(4), 2√5
        v = v * factor();
      } else break;
    }
    return v;
  }
  // factor = unary ('^' factor)?   (right associative)
  function factor(): number {
    const base = unary();
    const p = peek();
    if (p && p.t === "op" && (p as any).v === "^") {
      eat();
      return Math.pow(base, factor());
    }
    return base;
  }
  // unary = ('-' | '√') unary | primary
  function unary(): number {
    const p = peek();
    if (p && p.t === "op" && (p as any).v === "-") { eat(); return -unary(); }
    if (p && p.t === "op" && (p as any).v === "√") { eat(); return Math.sqrt(unary()); }
    return primary();
  }
  function primary(): number {
    const p = eat();
    if (!p) throw new Error("unexpected end");
    if (p.t === "num") return p.v;
    if (p.t === "(") { const v = expr(); const close = eat(); if (!close || close.t !== ")") throw new Error("missing )"); return v; }
    throw new Error("unexpected token");
  }

  const result = expr();
  if (pos !== toks.length) throw new Error("trailing tokens");
  if (!isFinite(result)) throw new Error("non-finite");
  return result;
}

// Parse a single field into a number; NaN if unparseable (caller falls back to AI).
function num(v: string | undefined): number {
  if (v == null || v.trim() === "") return NaN;
  try { return evalExpr(v); } catch { return NaN; }
}

// ─── Number formatting ─────────────────────────────────────────────────────
function fmt(n: number, sig = 6): string {
  if (!isFinite(n)) return n > 0 ? "∞" : n < 0 ? "−∞" : "—";
  if (n === 0) return "0";
  const a = Math.abs(n);
  if (a < 1e-4 || a >= 1e9) {
    return n
      .toExponential(4)
      .replace(/(\.\d*?)0+e/, "$1e")
      .replace(/\.e/, "e")
      .replace("e+", "e")
      .replace("e", " × 10^")
      .replace("× 10^-", "× 10^−");
  }
  let s = n.toPrecision(sig);
  if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

// Build a ComputeResult with less boilerplate.
function R(p: {
  category: string;
  title: string;
  value: number | string;
  unit?: string;
  formatted?: string;
  expression?: string;
  variables?: Array<{ symbol: string; value: string; unit?: string }>;
  steps?: string[];
  explanation?: string;
  warnings?: string[];
}): ComputeResult {
  const valueStr = typeof p.value === "number" ? fmt(p.value) : p.value;
  return {
    category: p.category,
    title: p.title,
    result: {
      value: valueStr,
      unit: p.unit,
      formatted: p.formatted ?? `${valueStr}${p.unit ? " " + p.unit : ""}`,
    },
    formula: p.expression || p.variables ? { expression: p.expression, variables: p.variables } : undefined,
    steps: p.steps,
    explanation: p.explanation,
    warnings: p.warnings,
    confidence: "high",
  };
}

// Guard: returns parsed numbers for the listed keys, or null if any is unparseable.
function need(v: Vars, keys: string[]): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const k of keys) {
    const n = num(v[k]);
    if (!isFinite(n)) return null;
    out[k] = n;
  }
  return out;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) return NaN;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
function nCr(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  r = Math.min(r, n - r);
  let num = 1, den = 1;
  for (let i = 0; i < r; i++) { num *= n - i; den *= i + 1; }
  return num / den;
}
function nPr(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  let res = 1;
  for (let i = 0; i < r; i++) res *= n - i;
  return res;
}
// Error function (Abramowitz & Stegun 7.1.26) → for normal-distribution work.
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return sign * y;
}
const normalCDF = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

// ─── Formula computers, by category ──────────────────────────────────────────

const PHYSICS: Record<string, (v: Vars) => ComputeResult | null> = {
  f_ma: (v) => { const n = need(v, ["m", "a"]); if (!n) return null; const F = n.m * n.a;
    return R({ category: "Physics", title: "Newton's Second Law", value: F, unit: "N",
      expression: "F = m × a", variables: [{ symbol: "m", value: fmt(n.m), unit: "kg" }, { symbol: "a", value: fmt(n.a), unit: "m/s²" }],
      steps: [`F = ${fmt(n.m)} kg × ${fmt(n.a)} m/s²`, `F = ${fmt(F)} N`] }); },
  ke: (v) => { const n = need(v, ["m", "v"]); if (!n) return null; const ke = 0.5 * n.m * n.v ** 2;
    return R({ category: "Physics", title: "Kinetic Energy", value: ke, unit: "J",
      expression: "KE = ½ m v²", steps: [`KE = ½ × ${fmt(n.m)} × ${fmt(n.v)}²`, `KE = ${fmt(ke)} J`] }); },
  ohm: (v) => { const n = need(v, ["I", "R"]); if (!n) return null; const V = n.I * n.R;
    return R({ category: "Physics", title: "Ohm's Law", value: V, unit: "V",
      expression: "V = I × R", steps: [`V = ${fmt(n.I)} A × ${fmt(n.R)} Ω`, `V = ${fmt(V)} V`] }); },
  pe: (v) => { const n = need(v, ["m", "h"]); if (!n) return null; const pe = n.m * G_ACC * n.h;
    return R({ category: "Physics", title: "Gravitational Potential Energy", value: pe, unit: "J",
      expression: "PE = m g h", steps: [`PE = ${fmt(n.m)} × ${G_ACC} × ${fmt(n.h)}`, `PE = ${fmt(pe)} J`],
      explanation: `Using g = ${G_ACC} m/s².` }); },
  vel: (v) => { const n = need(v, ["u", "a", "t"]); if (!n) return null; const vf = n.u + n.a * n.t;
    return R({ category: "Physics", title: "Final Velocity", value: vf, unit: "m/s",
      expression: "v = u + a t", steps: [`v = ${fmt(n.u)} + ${fmt(n.a)} × ${fmt(n.t)}`, `v = ${fmt(vf)} m/s`] }); },
  power: (v) => { const n = need(v, ["I", "V"]); if (!n) return null; const P = n.I * n.V;
    return R({ category: "Physics", title: "Electrical Power", value: P, unit: "W",
      expression: "P = I × V", steps: [`P = ${fmt(n.I)} A × ${fmt(n.V)} V`, `P = ${fmt(P)} W`] }); },
  momentum: (v) => { const n = need(v, ["m", "v"]); if (!n) return null; const p = n.m * n.v;
    return R({ category: "Physics", title: "Momentum", value: p, unit: "kg·m/s",
      expression: "p = m × v", steps: [`p = ${fmt(n.m)} × ${fmt(n.v)}`, `p = ${fmt(p)} kg·m/s`] }); },
  work: (v) => { const n = need(v, ["F", "d"]); if (!n) return null; const w = n.F * n.d;
    return R({ category: "Physics", title: "Work Done", value: w, unit: "J",
      expression: "W = F × d", steps: [`W = ${fmt(n.F)} N × ${fmt(n.d)} m`, `W = ${fmt(w)} J`] }); },
  density: (v) => { const n = need(v, ["m", "V"]); if (!n || n.V === 0) return null; const d = n.m / n.V;
    return R({ category: "Physics", title: "Density", value: d, unit: "kg/m³",
      expression: "ρ = m / V", steps: [`ρ = ${fmt(n.m)} / ${fmt(n.V)}`, `ρ = ${fmt(d)} kg/m³`] }); },
  pressure: (v) => { const n = need(v, ["F", "A"]); if (!n || n.A === 0) return null; const p = n.F / n.A;
    return R({ category: "Physics", title: "Pressure", value: p, unit: "Pa",
      expression: "P = F / A", steps: [`P = ${fmt(n.F)} / ${fmt(n.A)}`, `P = ${fmt(p)} Pa`] }); },
  wave: (v) => { const n = need(v, ["f", "lam"]); if (!n) return null; const s = n.f * n.lam;
    return R({ category: "Physics", title: "Wave Speed", value: s, unit: "m/s",
      expression: "v = f × λ", steps: [`v = ${fmt(n.f)} Hz × ${fmt(n.lam)} m`, `v = ${fmt(s)} m/s`] }); },
  grav: (v) => { const n = need(v, ["m1", "m2", "r"]); if (!n || n.r === 0) return null; const F = (G_GRAV * n.m1 * n.m2) / (n.r * n.r);
    return R({ category: "Physics", title: "Gravitational Force", value: F, unit: "N",
      expression: "F = G m₁ m₂ / r²", steps: [`F = (${G_GRAV} × ${fmt(n.m1)} × ${fmt(n.m2)}) / ${fmt(n.r)}²`, `F = ${fmt(F)} N`],
      explanation: `G = ${G_GRAV} N·m²/kg².` }); },
};

const CHEMISTRY: Record<string, (v: Vars) => ComputeResult | null> = {
  molarity: (v) => { const n = need(v, ["n", "V"]); if (!n || n.V === 0) return null; const M = n.n / n.V;
    return R({ category: "Chemistry", title: "Molarity", value: M, unit: "mol/L",
      expression: "M = n / V", steps: [`M = ${fmt(n.n)} mol / ${fmt(n.V)} L`, `M = ${fmt(M)} mol/L`] }); },
  ph: (v) => { const n = need(v, ["H"]); if (!n || n.H <= 0) return null; const ph = -Math.log10(n.H);
    return R({ category: "Chemistry", title: "pH", value: ph, unit: "",
      expression: "pH = −log₁₀[H⁺]", steps: [`pH = −log₁₀(${fmt(n.H)})`, `pH = ${fmt(ph)}`],
      explanation: ph < 7 ? "Acidic solution." : ph > 7 ? "Basic solution." : "Neutral solution." }); },
  poh: (v) => { const n = need(v, ["OH"]); if (!n || n.OH <= 0) return null; const poh = -Math.log10(n.OH); const ph = 14 - poh;
    return R({ category: "Chemistry", title: "pOH & pH", value: poh, unit: "(pOH)",
      formatted: `pOH = ${fmt(poh)},  pH = ${fmt(ph)}`,
      expression: "pOH = −log₁₀[OH⁻],  pH = 14 − pOH", steps: [`pOH = −log₁₀(${fmt(n.OH)}) = ${fmt(poh)}`, `pH = 14 − ${fmt(poh)} = ${fmt(ph)}`] }); },
  ideal_gas: (v) => {
    // Solve for whichever single variable is left blank (PV = nRT).
    const keys = ["P", "V", "n", "T"];
    const blanks = keys.filter((k) => (v[k] ?? "").trim() === "");
    const parsed: Record<string, number> = {};
    for (const k of keys) if (!blanks.includes(k)) { const x = num(v[k]); if (!isFinite(x)) return null; parsed[k] = x; }
    if (blanks.length !== 1) return null; // need exactly one unknown
    const u = blanks[0];
    let val: number, unit: string;
    if (u === "P") { val = (parsed.n * R_GAS * parsed.T) / parsed.V; unit = "atm"; }
    else if (u === "V") { val = (parsed.n * R_GAS * parsed.T) / parsed.P; unit = "L"; }
    else if (u === "n") { val = (parsed.P * parsed.V) / (R_GAS * parsed.T); unit = "mol"; }
    else { val = (parsed.P * parsed.V) / (R_GAS * parsed.n); unit = "K"; }
    return R({ category: "Chemistry", title: `Ideal Gas Law — solved for ${u}`, value: val, unit,
      expression: "PV = nRT", steps: [`R = ${R_GAS} L·atm/(mol·K)`, `${u} = ${fmt(val)} ${unit}`],
      explanation: "Leave exactly one field blank to solve for it." });
  },
  dilution: (v) => { const n = need(v, ["C1", "V1", "V2"]); if (!n || n.V2 === 0) return null; const C2 = (n.C1 * n.V1) / n.V2;
    return R({ category: "Chemistry", title: "Dilution — final concentration", value: C2, unit: "M",
      expression: "C₁V₁ = C₂V₂", steps: [`C₂ = (${fmt(n.C1)} × ${fmt(n.V1)}) / ${fmt(n.V2)}`, `C₂ = ${fmt(C2)} M`] }); },
  moles: (v) => { const n = need(v, ["m", "M"]); if (!n || n.M === 0) return null; const mol = n.m / n.M;
    return R({ category: "Chemistry", title: "Moles", value: mol, unit: "mol",
      expression: "n = m / M", steps: [`n = ${fmt(n.m)} g / ${fmt(n.M)} g/mol`, `n = ${fmt(mol)} mol`] }); },
  mass_pct: (v) => { const n = need(v, ["solute", "soln"]); if (!n || n.soln === 0) return null; const pct = (n.solute / n.soln) * 100;
    return R({ category: "Chemistry", title: "Mass Percent", value: pct, unit: "%",
      expression: "% = (solute / solution) × 100", steps: [`% = (${fmt(n.solute)} / ${fmt(n.soln)}) × 100`, `% = ${fmt(pct)} %`] }); },
  pct_yield: (v) => { const n = need(v, ["act", "theo"]); if (!n || n.theo === 0) return null; const y = (n.act / n.theo) * 100;
    return R({ category: "Chemistry", title: "Percent Yield", value: y, unit: "%",
      expression: "% yield = (actual / theoretical) × 100", steps: [`% = (${fmt(n.act)} / ${fmt(n.theo)}) × 100`, `% = ${fmt(y)} %`] }); },
  half_life: (v) => { const n = need(v, ["N0", "hl", "t"]); if (!n || n.hl === 0) return null; const rem = n.N0 * Math.pow(0.5, n.t / n.hl);
    return R({ category: "Chemistry", title: "Radioactive Decay — remaining", value: rem, unit: "",
      expression: "N = N₀ × (½)^(t / t½)", steps: [`half-lives elapsed = ${fmt(n.t / n.hl)}`, `N = ${fmt(n.N0)} × (½)^${fmt(n.t / n.hl)}`, `N = ${fmt(rem)}`] }); },
  particles: (v) => { const n = need(v, ["n"]); if (!n) return null; const N = n.n * N_AVOGADRO;
    return R({ category: "Chemistry", title: "Number of Particles", value: N, unit: "particles",
      expression: "N = n × Nₐ", steps: [`N = ${fmt(n.n)} mol × ${fmt(N_AVOGADRO)} /mol`, `N = ${fmt(N)}`] }); },
};

const MEDICAL: Record<string, (v: Vars) => ComputeResult | null> = {
  bmi: (v) => { const n = need(v, ["w", "h"]); if (!n || n.h === 0) return null; const bmi = n.w / (n.h * n.h);
    const cat = bmi < 18.5 ? "Underweight" : bmi < 25 ? "Normal weight" : bmi < 30 ? "Overweight" : "Obese";
    return R({ category: "Medical", title: "Body Mass Index", value: bmi, unit: "kg/m²",
      expression: "BMI = weight / height²", steps: [`BMI = ${fmt(n.w)} / ${fmt(n.h)}²`, `BMI = ${fmt(bmi)} kg/m²`],
      explanation: `Category: ${cat} (WHO).`,
      warnings: ["BMI is a screening tool, not a diagnosis — it ignores muscle mass, frame and fat distribution."] }); },
  map: (v) => { const n = need(v, ["s", "d"]); if (!n) return null; const map = (n.s + 2 * n.d) / 3;
    return R({ category: "Medical", title: "Mean Arterial Pressure", value: map, unit: "mmHg",
      expression: "MAP = (SBP + 2·DBP) / 3", steps: [`MAP = (${fmt(n.s)} + 2 × ${fmt(n.d)}) / 3`, `MAP = ${fmt(map)} mmHg`],
      explanation: map < 65 ? "Below 65 mmHg — organ perfusion may be inadequate." : "MAP ≥ 65 mmHg is the usual perfusion target." }); },
  gfr: (v) => { const n = need(v, ["cr", "age"]); if (!n || n.cr <= 0) return null; const female = (v.sex ?? "M").toUpperCase().startsWith("F");
    const k = female ? 0.7 : 0.9; const a = female ? -0.241 : -0.302;
    const egfr = 142 * Math.pow(Math.min(n.cr / k, 1), a) * Math.pow(Math.max(n.cr / k, 1), -1.2) * Math.pow(0.9938, n.age) * (female ? 1.012 : 1);
    return R({ category: "Medical", title: "eGFR (CKD-EPI 2021)", value: egfr, unit: "mL/min/1.73m²",
      expression: "CKD-EPI 2021 (race-free)", steps: [`κ = ${k}, α = ${a}, ${female ? "female ×1.012" : "male"}`, `eGFR = ${fmt(egfr)} mL/min/1.73m²`],
      explanation: egfr >= 90 ? "Normal kidney function (G1)." : egfr >= 60 ? "Mildly reduced (G2)." : egfr >= 30 ? "Moderately reduced (G3)." : egfr >= 15 ? "Severely reduced (G4)." : "Kidney failure (G5).",
      warnings: ["Uses the 2021 race-free CKD-EPI creatinine equation. Confirm steady-state creatinine."] }); },
  crcl: (v) => { const n = need(v, ["age", "w", "cr"]); if (!n || n.cr === 0) return null; const female = (v.sex ?? "M").toUpperCase().startsWith("F");
    const crcl = (((140 - n.age) * n.w) / (72 * n.cr)) * (female ? 0.85 : 1);
    return R({ category: "Medical", title: "Creatinine Clearance (Cockcroft-Gault)", value: crcl, unit: "mL/min",
      expression: "CrCl = ((140 − age) × wt) / (72 × Scr) × (0.85 if female)",
      steps: [`((140 − ${fmt(n.age)}) × ${fmt(n.w)}) / (72 × ${fmt(n.cr)})${female ? " × 0.85" : ""}`, `CrCl = ${fmt(crcl)} mL/min`],
      warnings: ["Uses actual body weight; consider ideal/adjusted weight in obesity."] }); },
  dose: (v) => { const n = need(v, ["dose", "w"]); if (!n) return null; const total = n.dose * n.w;
    return R({ category: "Medical", title: "Weight-Based Dose", value: total, unit: "mg",
      expression: "dose = mg/kg × weight", steps: [`${fmt(n.dose)} mg/kg × ${fmt(n.w)} kg`, `= ${fmt(total)} mg`],
      warnings: ["Always verify against the drug's maximum dose and prescribing reference before administration."] }); },
  bsa: (v) => { const n = need(v, ["w", "h"]); if (!n) return null; const bsa = Math.sqrt((n.h * n.w) / 3600);
    return R({ category: "Medical", title: "Body Surface Area (Mosteller)", value: bsa, unit: "m²",
      expression: "BSA = √(height_cm × weight_kg / 3600)", steps: [`BSA = √(${fmt(n.h)} × ${fmt(n.w)} / 3600)`, `BSA = ${fmt(bsa)} m²`] }); },
  ibw: (v) => { const n = need(v, ["h"]); if (!n) return null; const female = (v.sex ?? "M").toUpperCase().startsWith("F");
    const inches = n.h / 2.54; const over60 = Math.max(0, inches - 60);
    const ibw = (female ? 45.5 : 50) + 2.3 * over60;
    return R({ category: "Medical", title: "Ideal Body Weight (Devine)", value: ibw, unit: "kg",
      expression: female ? "IBW = 45.5 + 2.3 × (in − 60)" : "IBW = 50 + 2.3 × (in − 60)",
      steps: [`height = ${fmt(inches)} in`, `IBW = ${fmt(ibw)} kg`] }); },
  anion_gap: (v) => { const n = need(v, ["na", "cl", "hco3"]); if (!n) return null; const ag = n.na - (n.cl + n.hco3);
    return R({ category: "Medical", title: "Anion Gap", value: ag, unit: "mEq/L",
      expression: "AG = Na⁺ − (Cl⁻ + HCO₃⁻)", steps: [`AG = ${fmt(n.na)} − (${fmt(n.cl)} + ${fmt(n.hco3)})`, `AG = ${fmt(ag)} mEq/L`],
      explanation: ag > 12 ? "Elevated — consider high anion gap metabolic acidosis (MUDPILES)." : "Within the usual 8–12 mEq/L reference range." }); },
  corr_ca: (v) => { const n = need(v, ["ca", "alb"]); if (!n) return null; const cca = n.ca + 0.8 * (4 - n.alb);
    return R({ category: "Medical", title: "Corrected Calcium", value: cca, unit: "mg/dL",
      expression: "Ca_corr = Ca + 0.8 × (4 − albumin)", steps: [`= ${fmt(n.ca)} + 0.8 × (4 − ${fmt(n.alb)})`, `= ${fmt(cca)} mg/dL`] }); },
  qtc: (v) => { const n = need(v, ["qt", "hr"]); if (!n || n.hr === 0) return null; const rr = 60 / n.hr; const qtc = n.qt / Math.sqrt(rr);
    return R({ category: "Medical", title: "Corrected QT (Bazett)", value: qtc, unit: "ms",
      expression: "QTc = QT / √RR,  RR = 60 / HR", steps: [`RR = 60 / ${fmt(n.hr)} = ${fmt(rr)} s`, `QTc = ${fmt(n.qt)} / √${fmt(rr)}`, `QTc = ${fmt(qtc)} ms`],
      explanation: qtc > 470 ? "Prolonged QTc — increased arrhythmia risk." : "Within usual limits.",
      warnings: ["Bazett over-corrects at high heart rates; consider Fridericia for HR > 100."] }); },
  ldl: (v) => { const n = need(v, ["tc", "hdl", "tg"]); if (!n) return null; const ldl = n.tc - n.hdl - n.tg / 5;
    return R({ category: "Medical", title: "LDL Cholesterol (Friedewald)", value: ldl, unit: "mg/dL",
      expression: "LDL = TC − HDL − TG/5", steps: [`LDL = ${fmt(n.tc)} − ${fmt(n.hdl)} − ${fmt(n.tg)}/5`, `LDL = ${fmt(ldl)} mg/dL`],
      warnings: n.tg > 400 ? ["Friedewald is invalid when triglycerides > 400 mg/dL — use a direct LDL measurement."] : undefined }); },
  hba1c: (v) => { const n = need(v, ["a1c"]); if (!n) return null; const eag = 28.7 * n.a1c - 46.7;
    return R({ category: "Medical", title: "Estimated Average Glucose", value: eag, unit: "mg/dL",
      expression: "eAG = 28.7 × A1c − 46.7", steps: [`eAG = 28.7 × ${fmt(n.a1c)} − 46.7`, `eAG = ${fmt(eag)} mg/dL`] }); },
};

const MATHEMATICS: Record<string, (v: Vars) => ComputeResult | null> = {
  quad: (v) => { const n = need(v, ["a", "b", "c"]); if (!n || n.a === 0) return null; const disc = n.b * n.b - 4 * n.a * n.c;
    if (disc < 0) { const re = -n.b / (2 * n.a); const im = Math.sqrt(-disc) / (2 * n.a);
      return R({ category: "Mathematics", title: "Quadratic Roots (complex)", value: `${fmt(re)} ± ${fmt(im)}i`, unit: "",
        expression: "x = (−b ± √(b²−4ac)) / 2a", steps: [`discriminant = ${fmt(disc)} < 0`, `x = ${fmt(re)} ± ${fmt(im)}i`] }); }
    const sq = Math.sqrt(disc); const x1 = (-n.b + sq) / (2 * n.a); const x2 = (-n.b - sq) / (2 * n.a);
    return R({ category: "Mathematics", title: "Quadratic Roots", value: `x₁ = ${fmt(x1)},  x₂ = ${fmt(x2)}`, unit: "",
      formatted: `x₁ = ${fmt(x1)},  x₂ = ${fmt(x2)}`,
      expression: "x = (−b ± √(b²−4ac)) / 2a", steps: [`discriminant = ${fmt(disc)}`, `x₁ = ${fmt(x1)}`, `x₂ = ${fmt(x2)}`] }); },
  pyth: (v) => { const n = need(v, ["a", "b"]); if (!n) return null; const c = Math.hypot(n.a, n.b);
    return R({ category: "Mathematics", title: "Hypotenuse", value: c, unit: "",
      expression: "c = √(a² + b²)", steps: [`c = √(${fmt(n.a)}² + ${fmt(n.b)}²)`, `c = ${fmt(c)}`] }); },
  circle: (v) => { const n = need(v, ["r"]); if (!n) return null; const area = Math.PI * n.r * n.r; const circ = 2 * Math.PI * n.r;
    return R({ category: "Mathematics", title: "Circle", value: area, unit: "(area)",
      formatted: `Area = ${fmt(area)},  Circumference = ${fmt(circ)}`,
      expression: "A = πr²,  C = 2πr", steps: [`A = π × ${fmt(n.r)}² = ${fmt(area)}`, `C = 2π × ${fmt(n.r)} = ${fmt(circ)}`] }); },
  log: (v) => { const n = need(v, ["x"]); if (!n || n.x <= 0) return null;
    const baseRaw = (v.base ?? "e").trim(); const base = baseRaw === "e" || baseRaw === "" ? Math.E : num(baseRaw);
    if (!isFinite(base) || base <= 0 || base === 1) return null; const res = Math.log(n.x) / Math.log(base);
    return R({ category: "Mathematics", title: "Logarithm", value: res, unit: "",
      expression: `log_${baseRaw || "e"}(x)`, steps: [`log base ${baseRaw || "e"} of ${fmt(n.x)}`, `= ${fmt(res)}`] }); },
  ncr: (v) => { const n = need(v, ["n", "r"]); if (!n) return null; const res = nCr(Math.round(n.n), Math.round(n.r));
    return R({ category: "Mathematics", title: "Combinations", value: res, unit: "",
      expression: "ⁿCᵣ = n! / (r!(n−r)!)", steps: [`C(${Math.round(n.n)}, ${Math.round(n.r)}) = ${fmt(res)}`] }); },
  npr: (v) => { const n = need(v, ["n", "r"]); if (!n) return null; const res = nPr(Math.round(n.n), Math.round(n.r));
    return R({ category: "Mathematics", title: "Permutations", value: res, unit: "",
      expression: "ⁿPᵣ = n! / (n−r)!", steps: [`P(${Math.round(n.n)}, ${Math.round(n.r)}) = ${fmt(res)}`] }); },
  fact: (v) => { const n = need(v, ["n"]); if (!n) return null; const res = factorial(Math.round(n.n));
    if (!isFinite(res)) return null;
    return R({ category: "Mathematics", title: "Factorial", value: res, unit: "",
      expression: "n!", steps: [`${Math.round(n.n)}! = ${fmt(res)}`] }); },
  slope: (v) => { const n = need(v, ["x1", "y1", "x2", "y2"]); if (!n || n.x2 === n.x1) return null; const m = (n.y2 - n.y1) / (n.x2 - n.x1); const b = n.y1 - m * n.x1;
    return R({ category: "Mathematics", title: "Slope of Line", value: m, unit: "(slope)",
      formatted: `m = ${fmt(m)},  y = ${fmt(m)}x ${b >= 0 ? "+" : "−"} ${fmt(Math.abs(b))}`,
      expression: "m = (y₂ − y₁) / (x₂ − x₁)", steps: [`m = (${fmt(n.y2)} − ${fmt(n.y1)}) / (${fmt(n.x2)} − ${fmt(n.x1)})`, `m = ${fmt(m)}`, `y = ${fmt(m)}x ${b >= 0 ? "+" : "−"} ${fmt(Math.abs(b))}`] }); },
  trig: (v) => { const n = need(v, ["ang"]); if (!n) return null; const fn = (v.fn ?? "sin").toLowerCase(); const rad = (n.ang * Math.PI) / 180;
    const res = fn === "cos" ? Math.cos(rad) : fn === "tan" ? Math.tan(rad) : Math.sin(rad);
    return R({ category: "Mathematics", title: `${fn}(${fmt(n.ang)}°)`, value: res, unit: "",
      expression: `${fn}(θ)`, steps: [`${fn}(${fmt(n.ang)}°) = ${fmt(res)}`] }); },
};

const BIOLOGY: Record<string, (v: Vars) => ComputeResult | null> = {
  pop: (v) => { const n = need(v, ["N0", "r", "t"]); if (!n) return null; const N = n.N0 * Math.exp(n.r * n.t);
    return R({ category: "Biology", title: "Exponential Population Growth", value: N, unit: "",
      expression: "N = N₀ e^(r t)", steps: [`N = ${fmt(n.N0)} × e^(${fmt(n.r)} × ${fmt(n.t)})`, `N = ${fmt(N)}`] }); },
  hw: (v) => { const n = need(v, ["p"]); if (!n || n.p < 0 || n.p > 1) return null; const q = 1 - n.p;
    return R({ category: "Biology", title: "Hardy-Weinberg Genotype Frequencies", value: `p² = ${fmt(n.p * n.p)}`, unit: "",
      formatted: `AA = ${fmt(n.p * n.p)},  Aa = ${fmt(2 * n.p * q)},  aa = ${fmt(q * q)}`,
      expression: "p² + 2pq + q² = 1", steps: [`q = 1 − ${fmt(n.p)} = ${fmt(q)}`, `AA = p² = ${fmt(n.p * n.p)}`, `Aa = 2pq = ${fmt(2 * n.p * q)}`, `aa = q² = ${fmt(q * q)}`] }); },
  mm: (v) => { const n = need(v, ["Vm", "Km", "S"]); if (!n || n.Km + n.S === 0) return null; const rate = (n.Vm * n.S) / (n.Km + n.S);
    return R({ category: "Biology", title: "Michaelis-Menten Rate", value: rate, unit: "μmol/min",
      expression: "v = Vmax[S] / (Km + [S])", steps: [`v = (${fmt(n.Vm)} × ${fmt(n.S)}) / (${fmt(n.Km)} + ${fmt(n.S)})`, `v = ${fmt(rate)} μmol/min`] }); },
  double: (v) => { const n = need(v, ["r"]); if (!n || n.r <= 0) return null; const td = Math.log(2) / Math.log(1 + n.r / 100);
    return R({ category: "Biology", title: "Doubling Time", value: td, unit: "periods",
      expression: "t = ln2 / ln(1 + r)", steps: [`t = ln(2) / ln(1 + ${fmt(n.r)}/100)`, `t = ${fmt(td)} periods`] }); },
  mort: (v) => { const n = need(v, ["d", "n"]); if (!n || n.n === 0) return null; const per1000 = (n.d / n.n) * 1000;
    return R({ category: "Biology", title: "Mortality Rate", value: per1000, unit: "per 1,000",
      formatted: `${fmt(per1000)} per 1,000  (${fmt((n.d / n.n) * 100)} %)`,
      expression: "rate = deaths / population × 1000", steps: [`(${fmt(n.d)} / ${fmt(n.n)}) × 1000`, `= ${fmt(per1000)} per 1,000`] }); },
  bmr: (v) => { const n = need(v, ["w", "h", "age"]); if (!n) return null; const female = (v.sex ?? "M").toUpperCase().startsWith("F");
    const bmr = 10 * n.w + 6.25 * n.h - 5 * n.age + (female ? -161 : 5);
    return R({ category: "Biology", title: "Basal Metabolic Rate (Mifflin-St Jeor)", value: bmr, unit: "kcal/day",
      expression: female ? "BMR = 10w + 6.25h − 5age − 161" : "BMR = 10w + 6.25h − 5age + 5",
      steps: [`BMR = ${fmt(bmr)} kcal/day`], explanation: "Resting energy at complete rest; multiply by an activity factor for total daily needs." }); },
  fold: (v) => { const n = need(v, ["treat", "ctrl"]); if (!n || n.ctrl === 0) return null; const fc = n.treat / n.ctrl;
    return R({ category: "Biology", title: "Fold Change", value: fc, unit: "×",
      formatted: `${fmt(fc)}×  (log₂ = ${fmt(Math.log2(fc))})`,
      expression: "FC = treated / control", steps: [`FC = ${fmt(n.treat)} / ${fmt(n.ctrl)} = ${fmt(fc)}×`, `log₂FC = ${fmt(Math.log2(fc))}`] }); },
  dilf: (v) => { const n = need(v, ["stock", "final"]); if (!n || n.stock === 0) return null; const df = n.final / n.stock;
    return R({ category: "Biology", title: "Dilution Factor", value: df, unit: "×",
      formatted: `1 : ${fmt(df)}`, expression: "DF = final volume / stock volume", steps: [`DF = ${fmt(n.final)} / ${fmt(n.stock)} = ${fmt(df)}×`] }); },
  gc: (v) => { const seq = (v.seq ?? "").replace(/[^a-zA-Z]/g, "").toUpperCase(); if (!seq) return null;
    const gc = (seq.match(/[GC]/g) ?? []).length; const pct = (gc / seq.length) * 100;
    return R({ category: "Biology", title: "GC Content", value: pct, unit: "%",
      expression: "GC% = (G + C) / length × 100", steps: [`length = ${seq.length} bases`, `G + C = ${gc}`, `GC% = ${fmt(pct)} %`] }); },
};

const STATISTICS: Record<string, (v: Vars) => ComputeResult | null> = {
  mean_sd: (v) => {
    const data = (v.data ?? "").split(/[,\s]+/).map((x) => parseFloat(x)).filter((x) => isFinite(x));
    if (data.length < 2) return null;
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const sorted = [...data].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const variance = data.reduce((a, b) => a + (b - mean) ** 2, 0) / (data.length - 1);
    const sd = Math.sqrt(variance);
    return R({ category: "Statistics", title: "Descriptive Statistics", value: mean, unit: "(mean)",
      formatted: `mean = ${fmt(mean)},  σ = ${fmt(sd)}`,
      expression: "sample mean, median, variance, std dev",
      steps: [`n = ${data.length}`, `mean = ${fmt(mean)}`, `median = ${fmt(median)}`, `variance (s²) = ${fmt(variance)}`, `std dev (s) = ${fmt(sd)}`] }); },
  zscore: (v) => { const n = need(v, ["x", "mu", "sd"]); if (!n || n.sd === 0) return null; const z = (n.x - n.mu) / n.sd;
    return R({ category: "Statistics", title: "Z-Score", value: z, unit: "",
      expression: "z = (x − μ) / σ", steps: [`z = (${fmt(n.x)} − ${fmt(n.mu)}) / ${fmt(n.sd)}`, `z = ${fmt(z)}`],
      explanation: `Percentile ≈ ${fmt(normalCDF(z) * 100)}% (standard normal).` }); },
  ncr: (v) => { const n = need(v, ["n", "r"]); if (!n) return null; const res = nCr(Math.round(n.n), Math.round(n.r));
    return R({ category: "Statistics", title: "Combinations", value: res, unit: "",
      expression: "ⁿCᵣ", steps: [`C(${Math.round(n.n)}, ${Math.round(n.r)}) = ${fmt(res)}`] }); },
  prob: (v) => { const n = need(v, ["fav", "tot"]); if (!n || n.tot === 0) return null; const p = n.fav / n.tot;
    return R({ category: "Statistics", title: "Probability", value: p, unit: "",
      formatted: `${fmt(p)}  (${fmt(p * 100)} %)`, expression: "P = favorable / total", steps: [`P = ${fmt(n.fav)} / ${fmt(n.tot)} = ${fmt(p)}`] }); },
  ci: (v) => { const n = need(v, ["mu", "sd", "n"]); if (!n || n.n <= 0) return null; const se = n.sd / Math.sqrt(n.n); const margin = 1.96 * se;
    return R({ category: "Statistics", title: "95% Confidence Interval", value: `${fmt(n.mu)} ± ${fmt(margin)}`, unit: "",
      formatted: `[${fmt(n.mu - margin)}, ${fmt(n.mu + margin)}]`,
      expression: "CI = x̄ ± 1.96 × (σ / √n)", steps: [`SE = ${fmt(n.sd)} / √${fmt(n.n)} = ${fmt(se)}`, `margin = 1.96 × ${fmt(se)} = ${fmt(margin)}`, `[${fmt(n.mu - margin)}, ${fmt(n.mu + margin)}]`] }); },
  binom: (v) => { const n = need(v, ["n", "k", "p"]); if (!n) return null; const N = Math.round(n.n); const k = Math.round(n.k);
    const prob = nCr(N, k) * Math.pow(n.p, k) * Math.pow(1 - n.p, N - k);
    return R({ category: "Statistics", title: "Binomial Probability", value: prob, unit: "",
      formatted: `${fmt(prob)}  (${fmt(prob * 100)} %)`,
      expression: "P = C(n,k) pᵏ (1−p)ⁿ⁻ᵏ", steps: [`C(${N},${k}) = ${fmt(nCr(N, k))}`, `P = ${fmt(prob)}`] }); },
  perc: (v) => { const n = need(v, ["x", "mu", "sd"]); if (!n || n.sd === 0) return null; const z = (n.x - n.mu) / n.sd; const pct = normalCDF(z) * 100;
    return R({ category: "Statistics", title: "Normal Percentile", value: pct, unit: "%",
      expression: "percentile = Φ((x − μ)/σ)", steps: [`z = ${fmt(z)}`, `percentile ≈ ${fmt(pct)} %`] }); },
  samp: (v) => { const n = need(v, ["moe", "p"]); if (!n || n.moe === 0) return null;
    const z = (v.conf ?? "95%").startsWith("99") ? 2.576 : (v.conf ?? "95%").startsWith("90") ? 1.645 : 1.96;
    const moe = n.moe / 100; const size = Math.ceil((z * z * n.p * (1 - n.p)) / (moe * moe));
    return R({ category: "Statistics", title: "Required Sample Size", value: size, unit: "respondents",
      expression: "n = z² p(1−p) / E²", steps: [`z = ${z} (${v.conf ?? "95%"})`, `n = ${z}² × ${fmt(n.p)} × ${fmt(1 - n.p)} / ${fmt(moe)}²`, `n = ${size}`] }); },
};

const FINANCE: Record<string, (v: Vars) => ComputeResult | null> = {
  compound: (v) => { const n = need(v, ["P", "r", "n", "t"]); if (!n || n.n === 0) return null; const r = n.r / 100;
    const A = n.P * Math.pow(1 + r / n.n, n.n * n.t); const interest = A - n.P;
    return R({ category: "Finance", title: "Compound Interest", value: A, unit: "",
      formatted: `Total ${fmt(A)}  (interest ${fmt(interest)})`,
      expression: "A = P(1 + r/n)^(nt)", steps: [`A = ${fmt(n.P)} × (1 + ${fmt(r)}/${fmt(n.n)})^(${fmt(n.n)}×${fmt(n.t)})`, `A = ${fmt(A)}`, `interest = ${fmt(interest)}`] }); },
  simple: (v) => { const n = need(v, ["P", "r", "t"]); if (!n) return null; const interest = (n.P * n.r * n.t) / 100; const total = n.P + interest;
    return R({ category: "Finance", title: "Simple Interest", value: interest, unit: "(interest)",
      formatted: `Interest ${fmt(interest)},  Total ${fmt(total)}`,
      expression: "I = P r t / 100", steps: [`I = ${fmt(n.P)} × ${fmt(n.r)} × ${fmt(n.t)} / 100`, `I = ${fmt(interest)}`, `total = ${fmt(total)}`] }); },
  loan: (v) => { const n = need(v, ["P", "r", "n"]); if (!n || n.n === 0) return null; const i = n.r / 100 / 12;
    const pay = i === 0 ? n.P / n.n : (n.P * i) / (1 - Math.pow(1 + i, -n.n)); const total = pay * n.n;
    return R({ category: "Finance", title: "Monthly Loan Payment", value: pay, unit: "/month",
      formatted: `${fmt(pay)} /month  (total ${fmt(total)})`,
      expression: "M = P·i / (1 − (1+i)⁻ⁿ)", steps: [`monthly rate i = ${fmt(i)}`, `M = ${fmt(pay)} per month`, `total repaid = ${fmt(total)} over ${fmt(n.n)} months`] }); },
  fv: (v) => { const n = need(v, ["P", "r", "n"]); if (!n) return null; const fv = n.P * Math.pow(1 + n.r / 100, n.n);
    return R({ category: "Finance", title: "Future Value", value: fv, unit: "",
      expression: "FV = PV(1 + r)ⁿ", steps: [`FV = ${fmt(n.P)} × (1 + ${fmt(n.r)}/100)^${fmt(n.n)}`, `FV = ${fmt(fv)}`] }); },
  pv: (v) => { const n = need(v, ["FV", "r", "n"]); if (!n) return null; const pv = n.FV / Math.pow(1 + n.r / 100, n.n);
    return R({ category: "Finance", title: "Present Value", value: pv, unit: "",
      expression: "PV = FV / (1 + r)ⁿ", steps: [`PV = ${fmt(n.FV)} / (1 + ${fmt(n.r)}/100)^${fmt(n.n)}`, `PV = ${fmt(pv)}`] }); },
  roi: (v) => { const n = need(v, ["gain", "cost"]); if (!n || n.cost === 0) return null; const roi = ((n.gain - n.cost) / n.cost) * 100;
    return R({ category: "Finance", title: "Return on Investment", value: roi, unit: "%",
      expression: "ROI = (final − cost) / cost × 100", steps: [`ROI = (${fmt(n.gain)} − ${fmt(n.cost)}) / ${fmt(n.cost)} × 100`, `ROI = ${fmt(roi)} %`] }); },
  cagr: (v) => { const n = need(v, ["begin", "end", "yrs"]); if (!n || n.begin <= 0 || n.yrs === 0) return null; const cagr = (Math.pow(n.end / n.begin, 1 / n.yrs) - 1) * 100;
    return R({ category: "Finance", title: "Compound Annual Growth Rate", value: cagr, unit: "%",
      expression: "CAGR = (end/begin)^(1/yrs) − 1", steps: [`CAGR = (${fmt(n.end)}/${fmt(n.begin)})^(1/${fmt(n.yrs)}) − 1`, `CAGR = ${fmt(cagr)} %`] }); },
  breakeven: (v) => { const n = need(v, ["fixed", "price", "varc"]); if (!n || n.price === n.varc) return null; const units = n.fixed / (n.price - n.varc);
    return R({ category: "Finance", title: "Break-Even Point", value: Math.ceil(units), unit: "units",
      formatted: `${fmt(Math.ceil(units))} units  (revenue ${fmt(Math.ceil(units) * n.price)})`,
      expression: "units = fixed / (price − variable cost)", steps: [`= ${fmt(n.fixed)} / (${fmt(n.price)} − ${fmt(n.varc)})`, `= ${fmt(units)} → ${Math.ceil(units)} units`] }); },
};

const ENGINEERING: Record<string, (v: Vars) => ComputeResult | null> = {
  stress: (v) => { const n = need(v, ["F", "A"]); if (!n || n.A === 0) return null; const s = n.F / n.A;
    return R({ category: "Engineering", title: "Stress", value: s, unit: "Pa",
      formatted: `${fmt(s)} Pa  (${fmt(s / 1e6)} MPa)`, expression: "σ = F / A", steps: [`σ = ${fmt(n.F)} / ${fmt(n.A)}`, `σ = ${fmt(s)} Pa`] }); },
  strain: (v) => { const n = need(v, ["dL", "L"]); if (!n || n.L === 0) return null; const e = n.dL / n.L;
    return R({ category: "Engineering", title: "Strain", value: e, unit: "",
      formatted: `${fmt(e)}  (${fmt(e * 100)} %)`, expression: "ε = ΔL / L₀", steps: [`ε = ${fmt(n.dL)} / ${fmt(n.L)} = ${fmt(e)}`] }); },
  mech_pwr: (v) => { const n = need(v, ["F", "v"]); if (!n) return null; const p = n.F * n.v;
    return R({ category: "Engineering", title: "Mechanical Power", value: p, unit: "W",
      expression: "P = F × v", steps: [`P = ${fmt(n.F)} × ${fmt(n.v)}`, `P = ${fmt(p)} W`] }); },
  torque: (v) => { const n = need(v, ["F", "r"]); if (!n) return null; const tq = n.F * n.r;
    return R({ category: "Engineering", title: "Torque", value: tq, unit: "N·m",
      expression: "τ = F × r", steps: [`τ = ${fmt(n.F)} × ${fmt(n.r)}`, `τ = ${fmt(tq)} N·m`] }); },
  flow: (v) => { const n = need(v, ["A", "v"]); if (!n) return null; const q = n.A * n.v;
    return R({ category: "Engineering", title: "Volumetric Flow Rate", value: q, unit: "m³/s",
      expression: "Q = A × v", steps: [`Q = ${fmt(n.A)} × ${fmt(n.v)}`, `Q = ${fmt(q)} m³/s`] }); },
  reynolds: (v) => { const n = need(v, ["rho", "v", "D", "mu"]); if (!n || n.mu === 0) return null; const re = (n.rho * n.v * n.D) / n.mu;
    return R({ category: "Engineering", title: "Reynolds Number", value: re, unit: "",
      expression: "Re = ρvD / μ", steps: [`Re = (${fmt(n.rho)} × ${fmt(n.v)} × ${fmt(n.D)}) / ${fmt(n.mu)}`, `Re = ${fmt(re)}`],
      explanation: re < 2300 ? "Laminar flow (Re < 2300)." : re > 4000 ? "Turbulent flow (Re > 4000)." : "Transitional flow." }); },
  beam: (v) => { const n = need(v, ["P", "L", "E", "I"]); if (!n || n.E === 0 || n.I === 0) return null; const E = n.E * 1e9; const d = (n.P * Math.pow(n.L, 3)) / (48 * E * n.I);
    return R({ category: "Engineering", title: "Beam Deflection (centre point load)", value: d, unit: "m",
      formatted: `${fmt(d)} m  (${fmt(d * 1000)} mm)`,
      expression: "δ = PL³ / (48 E I)", steps: [`E = ${fmt(n.E)} GPa = ${fmt(E)} Pa`, `δ = ${fmt(n.P)}×${fmt(n.L)}³ / (48×${fmt(E)}×${fmt(n.I)})`, `δ = ${fmt(d)} m`] }); },
  thermal: (v) => { const n = need(v, ["U", "A", "dT"]); if (!n) return null; const q = n.U * n.A * n.dT;
    return R({ category: "Engineering", title: "Heat Transfer Rate", value: q, unit: "W",
      expression: "Q = U A ΔT", steps: [`Q = ${fmt(n.U)} × ${fmt(n.A)} × ${fmt(n.dT)}`, `Q = ${fmt(q)} W`] }); },
  eff: (v) => { const n = need(v, ["out", "in"]); if (!n || n.in === 0) return null; const e = (n.out / n.in) * 100;
    return R({ category: "Engineering", title: "Efficiency", value: e, unit: "%",
      expression: "η = output / input × 100", steps: [`η = ${fmt(n.out)} / ${fmt(n.in)} × 100`, `η = ${fmt(e)} %`] }); },
  fos: (v) => { const n = need(v, ["ult", "work"]); if (!n || n.work === 0) return null; const fos = n.ult / n.work;
    return R({ category: "Engineering", title: "Factor of Safety", value: fos, unit: "",
      expression: "FoS = ultimate stress / working stress", steps: [`FoS = ${fmt(n.ult)} / ${fmt(n.work)} = ${fmt(fos)}`],
      explanation: fos < 1 ? "FoS < 1 — the design is overstressed and unsafe." : "Higher FoS means a larger safety margin." }); },
};

const ASTRONOMY: Record<string, (v: Vars) => ComputeResult | null> = {
  kepler3: (v) => { const n = need(v, ["a"]); if (!n || n.a <= 0) return null; const T = Math.pow(n.a, 1.5);
    return R({ category: "Astronomy", title: "Kepler's Third Law — orbital period", value: T, unit: "years",
      expression: "T² = a³  (T in yr, a in AU)", steps: [`T = ${fmt(n.a)}^1.5`, `T = ${fmt(T)} years`] }); },
  hubble: (v) => { const n = need(v, ["v"]); if (!n) return null; const d = n.v / H0_HUBBLE;
    return R({ category: "Astronomy", title: "Hubble's Law — distance", value: d, unit: "Mpc",
      expression: "d = v / H₀", steps: [`H₀ = ${H0_HUBBLE} km/s/Mpc`, `d = ${fmt(n.v)} / ${H0_HUBBLE}`, `d = ${fmt(d)} Mpc`] }); },
  schw: (v) => { const n = need(v, ["M"]); if (!n) return null; const M = n.M * M_SUN; const rs = (2 * G_GRAV * M) / (C_LIGHT * C_LIGHT);
    return R({ category: "Astronomy", title: "Schwarzschild Radius", value: rs, unit: "m",
      formatted: `${fmt(rs)} m  (${fmt(rs / 1000)} km)`,
      expression: "Rₛ = 2GM / c²", steps: [`M = ${fmt(n.M)} M☉ = ${fmt(M)} kg`, `Rₛ = ${fmt(rs)} m`] }); },
  dist: (v) => { const n = need(v, ["p"]); if (!n || n.p === 0) return null; const d = 1 / n.p;
    return R({ category: "Astronomy", title: "Parallax Distance", value: d, unit: "pc",
      formatted: `${fmt(d)} pc  (${fmt(d * 3.26156)} ly)`,
      expression: "d = 1 / p  (p in arcsec)", steps: [`d = 1 / ${fmt(n.p)}`, `d = ${fmt(d)} parsecs`] }); },
  lum: (v) => { const n = need(v, ["R", "T"]); if (!n) return null; const L = n.R * n.R * Math.pow(n.T / T_SUN, 4);
    return R({ category: "Astronomy", title: "Stellar Luminosity", value: L, unit: "L☉",
      expression: "L / L☉ = (R/R☉)² (T/T☉)⁴", steps: [`T☉ = ${T_SUN} K`, `L = ${fmt(n.R)}² × (${fmt(n.T)}/${T_SUN})⁴`, `L = ${fmt(L)} L☉`] }); },
  esc: (v) => { const n = need(v, ["M", "R"]); if (!n || n.R === 0) return null; const ve = Math.sqrt((2 * G_GRAV * n.M) / n.R);
    return R({ category: "Astronomy", title: "Escape Velocity", value: ve, unit: "m/s",
      formatted: `${fmt(ve)} m/s  (${fmt(ve / 1000)} km/s)`,
      expression: "v = √(2GM / R)", steps: [`v = √(2 × ${G_GRAV} × ${fmt(n.M)} / ${fmt(n.R)})`, `v = ${fmt(ve)} m/s`] }); },
  redshift: (v) => { const n = need(v, ["obs", "rest"]); if (!n || n.rest === 0) return null; const z = (n.obs - n.rest) / n.rest;
    return R({ category: "Astronomy", title: "Cosmological Redshift", value: z, unit: "",
      expression: "z = (λ_obs − λ_rest) / λ_rest", steps: [`z = (${fmt(n.obs)} − ${fmt(n.rest)}) / ${fmt(n.rest)}`, `z = ${fmt(z)}`],
      explanation: `Recession velocity ≈ ${fmt(z * C_LIGHT / 1000)} km/s (z·c, non-relativistic).` }); },
  orbv: (v) => { const n = need(v, ["M", "r"]); if (!n || n.r === 0) return null; const vel = Math.sqrt((G_GRAV * n.M) / n.r);
    return R({ category: "Astronomy", title: "Orbital Velocity", value: vel, unit: "m/s",
      formatted: `${fmt(vel)} m/s  (${fmt(vel / 1000)} km/s)`,
      expression: "v = √(GM / r)", steps: [`v = √(${G_GRAV} × ${fmt(n.M)} / ${fmt(n.r)})`, `v = ${fmt(vel)} m/s`] }); },
  surfg: (v) => { const n = need(v, ["M", "R"]); if (!n || n.R === 0) return null; const g = (G_GRAV * n.M) / (n.R * n.R);
    return R({ category: "Astronomy", title: "Surface Gravity", value: g, unit: "m/s²",
      formatted: `${fmt(g)} m/s²  (${fmt(g / G_ACC)} g)`,
      expression: "g = GM / R²", steps: [`g = ${G_GRAV} × ${fmt(n.M)} / ${fmt(n.R)}²`, `g = ${fmt(g)} m/s²`] }); },
  distmod: (v) => { const n = need(v, ["m", "M"]); if (!n) return null; const d = Math.pow(10, (n.m - n.M + 5) / 5);
    return R({ category: "Astronomy", title: "Distance from Distance Modulus", value: d, unit: "pc",
      formatted: `${fmt(d)} pc  (${fmt(d * 3.26156)} ly)`,
      expression: "d = 10^((m − M + 5) / 5)", steps: [`d = 10^((${fmt(n.m)} − ${fmt(n.M)} + 5)/5)`, `d = ${fmt(d)} parsecs`] }); },
};

const COMPUTERS: Record<string, Record<string, (v: Vars) => ComputeResult | null>> = {
  Physics: PHYSICS,
  Chemistry: CHEMISTRY,
  Medical: MEDICAL,
  Mathematics: MATHEMATICS,
  Biology: BIOLOGY,
  Statistics: STATISTICS,
  Finance: FINANCE,
  Engineering: ENGINEERING,
  Astronomy: ASTRONOMY,
};

/**
 * Compute a built-in formula locally. Returns null when the formula isn't
 * implemented on-device or the inputs can't be parsed — the caller then falls
 * back to the AI backend.
 */
export function computeFormula(category: string, id: string, vars: Vars): ComputeResult | null {
  const fn = COMPUTERS[category]?.[id];
  if (!fn) return null;
  try {
    return fn(vars);
  } catch {
    return null;
  }
}

// ─── Unit conversions ────────────────────────────────────────────────────────
// Linear units: stored as a factor to a common base. Temperature is affine and
// handled separately.

const CONV_FACTORS: Record<string, Record<string, number>> = {
  Length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mile: 1609.344, yard: 0.9144, ft: 0.3048, in: 0.0254, nm: 1e-9 },
  Mass: { kg: 1, g: 0.001, mg: 1e-6, lb: 0.45359237, oz: 0.028349523125, tonne: 1000, "μg": 1e-9 },
  Volume: { L: 1, mL: 0.001, "m³": 1000, gallon: 3.785411784, "fl oz": 0.0295735295625, cup: 0.2365882365, tbsp: 0.01478676478 },
  Speed: { "m/s": 1, "km/h": 0.2777777778, mph: 0.44704, knot: 0.5144444444, "ft/s": 0.3048 },
  Area: { "m²": 1, "km²": 1e6, "cm²": 1e-4, acre: 4046.8564224, hectare: 10000, "ft²": 0.09290304, "in²": 0.00064516 },
  Energy: { J: 1, kJ: 1000, cal: 4.184, kcal: 4184, kWh: 3.6e6, eV: 1.602176634e-19, BTU: 1055.05585 },
  Power: { W: 1, kW: 1000, MW: 1e6, hp: 745.6998716, "BTU/h": 0.2930710702 },
  Force: { N: 1, kN: 1000, lbf: 4.4482216153, kgf: 9.80665, dyne: 1e-5 },
  Pressure: { Pa: 1, kPa: 1000, bar: 1e5, atm: 101325, psi: 6894.757293, mmHg: 133.322387415 },
  Angle: { "°": Math.PI / 180, rad: 1, grad: Math.PI / 200, arcmin: Math.PI / 10800, arcsec: Math.PI / 648000 },
  Frequency: { Hz: 1, kHz: 1000, MHz: 1e6, GHz: 1e9, rpm: 1 / 60 },
  Data: { bit: 1, byte: 8, KB: 8 * 1024, MB: 8 * 1024 ** 2, GB: 8 * 1024 ** 3, TB: 8 * 1024 ** 4 },
  Time: { s: 1, min: 60, hr: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 },
};

function tempToC(value: number, unit: string): number {
  if (unit === "°F") return (value - 32) * 5 / 9;
  if (unit === "K") return value - 273.15;
  return value;
}
function tempFromC(c: number, unit: string): number {
  if (unit === "°F") return c * 9 / 5 + 32;
  if (unit === "K") return c + 273.15;
  return c;
}

/** Raw numeric conversion. Returns null if units are unknown. */
export function convertUnits(type: string, value: number, from: string, to: string): number | null {
  if (type === "Temperature") return tempFromC(tempToC(value, from), to);
  const table = CONV_FACTORS[type];
  if (!table || !(from in table) || !(to in table)) return null;
  return (value * table[from]) / table[to];
}

/**
 * Convert a value between units locally, returning a full result panel. The
 * `valueStr` may contain keypad expressions (e.g. "2×10^3"). Returns null only
 * if the value can't be parsed (unknown units never reach here for built-ins).
 */
export function computeConversion(type: string, valueStr: string, from: string, to: string): ComputeResult | null {
  const value = num(valueStr || "1");
  if (!isFinite(value)) return null;
  const out = convertUnits(type, value, from, to);
  if (out == null) return null;
  return R({
    category: "Conversions",
    title: `${type} Conversion`,
    value: out,
    unit: to,
    formatted: `${fmt(value)} ${from} = ${fmt(out)} ${to}`,
    expression: from === to ? `${from} → ${to}` : undefined,
    steps: [`${fmt(value)} ${from} = ${fmt(out)} ${to}`],
  });
}

/** Lightweight live preview string for the converter display (no panel). */
export function quickConvert(type: string, valueStr: string, from: string, to: string): string | null {
  const value = num(valueStr || "");
  if (!isFinite(value)) return null;
  const out = convertUnits(type, value, from, to);
  if (out == null) return null;
  return fmt(out);
}
