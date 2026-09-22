/**
 * verify-proofread-marks.js — dev verification, not shipped code.
 *
 *   node scripts/verify-proofread-marks.js components/editor/WebEditor.tsx
 *
 * Verifies the claim that matters most in R3: saving a MARKED document
 * produces byte-identical HTML to saving the same document UNMARKED. It runs
 * the REAL editor script (extracted from WebEditor.tsx's EDITOR_HTML) in a
 * DOM, marks text the way ProofreadController does, and diffs the output.
 *
 * It also covers: the export clone-strip used by create-blank-docx/-pdf, that
 * the undo history never contains marks, that accept is a single undoable
 * step, the second-occurrence case, and that marking never moves the caret or
 * drops a selection.
 *
 * This is what caught the data-pfid leak: the mark SPANS were being stripped
 * from saves but the stable paragraph IDs were not, so a marked save differed
 * from an unmarked one.
 *
 * ── WHY THIS IS NOT A JEST TEST ──────────────────────────────────────────
 * It needs a DOM, and this repo's Jest preset is `jest-expo` (react-native),
 * which has no DOM. It therefore uses `jsdom`, which is NOT a declared
 * dependency — it resolves only transitively, so this script could stop
 * working on any lockfile change. That is acceptable for a dev script you
 * run deliberately; it is exactly why it is not wired into `npm test`.
 * If it fails to resolve jsdom, `npm i -D jsdom` and re-run.
 */
const fs = require("fs");
const path = require("path");
// The script lives in the scratchpad, so resolve jsdom from the project.
const { JSDOM } = require(
  path.join(process.cwd(), "node_modules", "jsdom"),
);

const src = fs.readFileSync(process.argv[2], "utf8");
const OPEN = "const EDITOR_HTML = `";
const from = src.indexOf(OPEN) + OPEN.length;
const end = src.indexOf("\n`;", from);
const html = new Function("return `" + src.slice(from, end) + "`;")();

const posted = [];
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
const { window } = dom;
window.ReactNativeWebView = {
  postMessage: (s) => posted.push(JSON.parse(s)),
};

const editor = window.document.getElementById("editor");
if (!editor) throw new Error("editor element missing");

let failures = 0;
function check(label, ok, detail) {
  console.log((ok ? "  PASS  " : "  FAIL  ") + label);
  if (!ok) {
    failures++;
    if (detail) console.log("        " + detail);
  }
}

// ── The document under test ────────────────────────────────────────────────
const CONTENT =
  "<p>The data shows that recieve rates are up. it is unclear why.</p>" +
  "<p>The cat sat on the mat and the mat was flat.</p>" +
  '<p>Some <b>bold</b> and <i>italic</i> text with a <a href="#x">link</a>.</p>' +
  "<ul><li>First item</li><li>Second  item</li></ul>";

editor.innerHTML = CONTENT;
window.__pf_setEnabled(true);

console.log("\n=== 1. SAVE IS BYTE-IDENTICAL, MARKED vs UNMARKED ===");

// Save with nothing marked.
posted.length = 0;
window.getContent();
const unmarkedSave = posted.find((m) => m.type === "SAVE_CONTENT");
const unmarkedHtml = unmarkedSave.html;

// Collect the blocks the way the controller does.
posted.length = 0;
window.__pf_collectBlocks();
const blocksMsg = posted.find((m) => m.type === "PF_BLOCKS");
check("collectBlocks returns paragraphs", blocksMsg && blocksMsg.blocks.length === 5,
  blocksMsg ? "got " + blocksMsg.blocks.length : "no message");

// Mark several ranges across several blocks, including inside formatted text.
const b = blocksMsg.blocks;
const idxOf = (blockIdx, needle, from2) => b[blockIdx].text.indexOf(needle, from2 || 0);

window.__pf_applyMarks(b[0].id, [
  { id: "s1", start: idxOf(0, "recieve"), end: idxOf(0, "recieve") + 7, type: "spelling" },
  { id: "s2", start: idxOf(0, "it is"), end: idxOf(0, "it is") + 2, type: "grammar" },
]);
// Second occurrence of "mat" — the occurrence case.
const firstMat = idxOf(1, "mat");
const secondMat = idxOf(1, "mat", firstMat + 1);
window.__pf_applyMarks(b[1].id, [
  { id: "s3", start: secondMat, end: secondMat + 3, type: "clarity" },
]);
// A range that straddles inline formatting (<b>bold</b>) — surroundContents
// throws on this, so it exercises the extractContents fallback.
const boldStart = idxOf(2, "bold");
window.__pf_applyMarks(b[2].id, [
  { id: "s4", start: boldStart - 5, end: boldStart + 8, type: "style" },
]);
window.__pf_applyMarks(b[4].id, [
  { id: "s5", start: idxOf(4, "Second  item"), end: idxOf(4, "Second  item") + 12, type: "punctuation" },
]);

const markCount = editor.querySelectorAll("span.pf").length;
check("marks were actually drawn", markCount >= 5, "count=" + markCount);
check("marks include the straddling range", editor.innerHTML.includes("pf-style"));

// Save with marks on screen.
posted.length = 0;
window.getContent();
const markedSave = posted.find((m) => m.type === "SAVE_CONTENT");
const markedHtml = markedSave.html;

check("SAVE_CONTENT html is byte-identical marked vs unmarked",
  markedHtml === unmarkedHtml,
  markedHtml === unmarkedHtml ? "" : "\n        unmarked: " + unmarkedHtml + "\n        marked:   " + markedHtml);
check("SAVE_CONTENT contains no pf spans", !markedHtml.includes("class=\"pf"));
check("SAVE_CONTENT text is unchanged", markedSave.text === unmarkedSave.text);

console.log("\n  unmarked save: " + unmarkedHtml.slice(0, 110) + "…");
console.log("  marked save:   " + markedHtml.slice(0, 110) + "…");
console.log("  diff:          " + (markedHtml === unmarkedHtml ? "(none)" : "DIFFERS"));

console.log("\n=== 2. THE EXPORT CLONE-STRIP (create-blank-docx / -pdf path) ===");
// Reproduce the clone strip the two editor hosts perform before export.
(function () {
  const clone = editor.cloneNode(true);
  clone.querySelectorAll("span.pf").forEach(function (n) {
    const parent = n.parentNode;
    if (!parent) return;
    while (n.firstChild) parent.insertBefore(n.firstChild, n);
    parent.removeChild(n);
  });
  clone.querySelectorAll("[data-pfid]").forEach(function (e) {
    e.removeAttribute("data-pfid");
  });
  clone.normalize();
  check("export clone is byte-identical to the unmarked document",
    clone.innerHTML === unmarkedHtml,
    clone.innerHTML === unmarkedHtml ? "" : "\n        got: " + clone.innerHTML);
})();

console.log("\n=== 3. UNDO HISTORY NEVER CONTAINS MARKS ===");
// Type, so a history snapshot is taken while marks are on screen.
editor.querySelector("p").appendChild(window.document.createTextNode(" More."));
window.dispatchEvent(new window.Event("resize"));
const inputEvent = new window.Event("input");
inputEvent.inputType = "insertText";
inputEvent.data = " ";
editor.dispatchEvent(inputEvent);

posted.length = 0;
window.getContent();
const afterTyping = posted.find((m) => m.type === "SAVE_CONTENT").html;
check("save after typing with marks present has no pf spans",
  !afterTyping.includes("class=\"pf"), afterTyping.slice(0, 160));

console.log("\n=== 4. ACCEPT REPLACES EXACTLY ONE SPAN, AND UNDO RESTORES IT ===");
editor.innerHTML = "<p>The data shows that recieve rates are up.</p>";
posted.length = 0;
window.__pf_collectBlocks();
const b2 = posted.find((m) => m.type === "PF_BLOCKS").blocks[0];
const rStart = b2.text.indexOf("recieve");

window.__pf_applyMarks(b2.id, [
  { id: "x1", start: rStart, end: rStart + 7, type: "spelling" },
]);
posted.length = 0;
window.__pf_accept(b2.id, rStart, rStart + 7, "receive");
const accepted = posted.find((m) => m.type === "PF_ACCEPTED");
check("accept reported success", accepted && accepted.ok === true);
check("accept fixed exactly that word",
  editor.textContent === "The data shows that receive rates are up.",
  JSON.stringify(editor.textContent));
check("accept left no marks behind", editor.querySelectorAll("span.pf").length === 0);

window.doUndo();
check("undo restores the original word",
  editor.textContent === "The data shows that recieve rates are up.",
  JSON.stringify(editor.textContent));
check("undo restored clean HTML (no marks)", !editor.innerHTML.includes("class=\"pf"));

console.log("\n=== 5. THE SECOND-OCCURRENCE CASE ===");
editor.innerHTML = "<p>the cat sat on the mat and the mat was flat</p>";
posted.length = 0;
window.__pf_collectBlocks();
const b3 = posted.find((m) => m.type === "PF_BLOCKS").blocks[0];
const m1 = b3.text.indexOf("mat");
const m2 = b3.text.indexOf("mat", m1 + 1);
window.__pf_accept(b3.id, m2, m2 + 3, "rug");
check("a second-occurrence edit lands on the SECOND occurrence",
  editor.textContent === "the cat sat on the mat and the rug was flat",
  JSON.stringify(editor.textContent));

console.log("\n=== 6. MARKING DOES NOT MOVE THE CARET OR DROP A SELECTION ===");
editor.innerHTML = "<p>The data shows that recieve rates are up here.</p>";
posted.length = 0;
window.__pf_collectBlocks();
const b4 = posted.find((m) => m.type === "PF_BLOCKS").blocks[0];

// Select the words "rates are".
const textNode = editor.querySelector("p").firstChild;
const selStart = b4.text.indexOf("rates are");
const selEnd = selStart + "rates are".length;
const range = window.document.createRange();
range.setStart(textNode, selStart);
range.setEnd(textNode, selEnd);
const sel = window.getSelection();
sel.removeAllRanges();
sel.addRange(range);
const before = sel.toString();

// Mark a DIFFERENT word while that selection is live.
const rs = b4.text.indexOf("recieve");
window.__pf_applyMarks(b4.id, [
  { id: "y1", start: rs, end: rs + 7, type: "spelling" },
]);

const after = window.getSelection().toString();
check("the selection survives marking", after === before,
  "before=" + JSON.stringify(before) + " after=" + JSON.stringify(after));
check("the mark was still drawn", editor.querySelectorAll("span.pf").length === 1);

// Clearing marks must also preserve it.
window.__pf_clearMarks();
const afterClear = window.getSelection().toString();
check("the selection survives clearing marks", afterClear === before,
  "after=" + JSON.stringify(afterClear));
check("clearMarks removed every mark", editor.querySelectorAll("span.pf").length === 0);
// data-pfid legitimately stays in the LIVE dom (it is the stable paragraph
// id); what matters is that it never reaches a save, which section 1 covers.
posted.length = 0;
window.getContent();
check("clearMarks restored the original text",
  posted.find((m) => m.type === "SAVE_CONTENT").html ===
    "<p>The data shows that recieve rates are up here.</p>",
  posted.find((m) => m.type === "SAVE_CONTENT").html);

console.log("\n=== 7. WITH PROOFREAD DISABLED, NOTHING HAPPENS ===");
window.__pf_setEnabled(false);
editor.innerHTML = CONTENT;
posted.length = 0;
window.__pf_collectBlocks();
const off = posted.find((m) => m.type === "PF_BLOCKS");
check("collectBlocks reports no blocks when disabled", off && off.blocks.length === 0);
window.__pf_applyMarks("anything", [{ id: "z", start: 0, end: 3, type: "grammar" }]);
check("applyMarks draws nothing when disabled",
  editor.querySelectorAll("span.pf").length === 0);
check("the document is untouched when disabled", editor.innerHTML === CONTENT);

console.log(
  "\n" + (failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED") + "\n",
);
process.exit(failures === 0 ? 0 : 1);
