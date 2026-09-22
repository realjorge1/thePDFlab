/**
 * Parses the JS that lives inside WebEditor's EDITOR_HTML template literal.
 * A syntax error in there is invisible to tsc (it is just a string) but
 * breaks the whole editor at runtime, so it is worth checking directly.
 */
const fs = require("fs");
const path = process.argv[2];
const src = fs.readFileSync(path, "utf8");

const OPEN = "const EDITOR_HTML = `";
const start = src.indexOf(OPEN);
if (start === -1) {
  console.error("EDITOR_HTML not found");
  process.exit(1);
}
const from = start + OPEN.length;
const end = src.indexOf("\n`;", from);
if (end === -1) {
  console.error("unterminated EDITOR_HTML");
  process.exit(1);
}
const raw = src.slice(from, end);

if (/\$\{/.test(raw)) {
  console.log("NOTE: template interpolation present in EDITOR_HTML");
}

// Evaluate the template literal exactly as the JS engine would.
const html = new Function("return `" + raw + "`;")();

const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.error("no <script> block in EDITOR_HTML");
  process.exit(1);
}
const js = m[1];

try {
  new Function(js);
} catch (e) {
  console.error("SYNTAX ERROR in editor script:", e.message);
  process.exit(1);
}

const needed = [
  "__pf_stripHtml",
  "__pf_clearMarks",
  "__pf_applyMarks",
  "__pf_accept",
  "__pf_collectBlocks",
  "__pf_setEnabled",
  "__pf_preserving",
  "saveSelection",
  "restoreSelection",
  "_savedRange",
  "doUndo",
  "doRedo",
];
const missing = needed.filter((n) => !js.includes(n));
if (missing.length) {
  console.error("missing entry points:", missing.join(", "));
  process.exit(1);
}

// spellcheck must stay on — the OS squiggles must not be silently lost.
if (!/spellcheck="true"/.test(html)) {
  console.error("spellcheck=\"true\" was lost from #editor");
  process.exit(1);
}

console.log("editor script parses OK (" + js.length + " chars)");
console.log("all entry points present; spellcheck=\"true\" intact");
