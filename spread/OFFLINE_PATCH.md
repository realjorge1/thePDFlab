# 🔒 Offline Patch — What Changed & How to Apply

This patch makes the spreadsheet feature **100% offline-first**.
No network calls. No CDN. No internet required — ever.

---

## 🐛 Bugs Fixed

### 1. Critical: Formula Engine Regex (formulaEngine.ts)
The original regex was malformed and would crash on ANY formula call:
```ts
// ❌ BROKEN — unbalanced parenthesis, would throw SyntaxError
expr.match(/^([A-Z]+)\((.*))\s*$/)

// ✅ FIXED
expr.match(/^([A-Z]+)\((.*)\)\s*$/s)
```
**Impact:** Every formula (`=SUM`, `=IF`, `=AVG`, etc.) would return `#ERROR`.

### 2. Critical: `new Function()` Removed (formulaEngine.ts)
The original `safeEval()` used JavaScript's `Function()` constructor:
```ts
// ❌ REMOVED — blocked by Hermes engine flags & React Native policies
const result = Function(`"use strict"; return (${expr})`)();
```
Replaced with a **custom recursive expression parser** (tokenizer → Pratt parser)
that handles `+ - * / % ( )` and unary minus — zero eval, zero network, zero risk.

### 3. Critical: No Data Persistence (store)
The original store was in-memory only — **all work was lost on app close**.
Now every mutation auto-saves to device local storage via `RNFS.DocumentDirectory`.

---

## 📁 Files to Replace / Add

| File | Action | Reason |
|---|---|---|
| `utils/formulaEngine.ts` | **Replace** | Critical regex + eval fix |
| `utils/persistence.ts`   | **Add (new)** | Offline auto-save layer |
| `store/spreadsheetStore.ts` | **Replace** | Wires in auto-save |
| `screens/SpreadsheetScreen.tsx` | **Replace** | Boot restore + AppState flush |

The other files from Phase 1 (`Cell.tsx`, `FormulaBar.tsx`, `SpreadsheetGrid.tsx`,
`Toolbar.tsx`, `SheetTabs.tsx`, `ContextMenu.tsx`, `fileHandler.ts`,
`addressUtils.ts`, `types/spreadsheet.ts`) are unchanged — keep them as-is.

---

## ✅ Apply the Patch (step by step)

```
# 1. Replace these files:
cp formulaEngine.ts        → src/utils/formulaEngine.ts
cp persistence.ts          → src/utils/persistence.ts       (NEW)
cp spreadsheetStore.ts     → src/store/spreadsheetStore.ts
cp SpreadsheetScreen.tsx   → src/screens/SpreadsheetScreen.tsx
```

No new npm packages are needed — `react-native-fs` was already in your
dependency list from Phase 1.

---

## 🔒 Offline Guarantee: What Each Layer Does

```
App Launch
   └── SpreadsheetScreen.useEffect
         └── loadSavedState()            ← reads RNFS file (local)
               └── loadFromDevice()      ← parses JSON from DocumentDirectory
                     └── deserializeSheet() ← restores Maps from arrays

User edits a cell
   └── store.setCell()
         └── recalculateSheet()          ← evaluateFormula() [no network]
               └── triggerAutoSave()     ← scheduleAutoSave() [debounced 1.5s]
                     └── saveToDevice()  ← RNFS.writeFile() [local only]

App goes to background (AppState: active → background)
   └── flushAutoSave()                   ← writes immediately (no debounce)
         └── RNFS.writeFile()            ← local filesystem

User exports
   └── exportXlsx()                     ← SheetJS → base64 → RNFS.writeFile()
         └── DownloadDirectory (Android) or DocumentDirectory (iOS) [local]
```

---

## 📱 Save File Location

| Platform | Path |
|---|---|
| Android | `/data/data/<package>/files/spreadsheet_autosave.json` |
| iOS | `<app sandbox>/Documents/spreadsheet_autosave.json` |

A rotating backup (`spreadsheet_backup.json`) is kept automatically.
If the primary file is corrupt on load, it falls back to the backup silently.

---

## ⚡ Formula Engine: Supported Formulas (Offline)

All evaluated locally with zero network:

| Category | Functions |
|---|---|
| Math | `SUM`, `AVERAGE`/`AVG`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `ROUND`, `ABS`, `SQRT`, `POWER`, `MOD` |
| Logic | `IF`, `AND`, `OR`, `NOT` |
| Text | `CONCATENATE`/`CONCAT`, `LEN`, `UPPER`, `LOWER`, `TRIM`, `LEFT`, `RIGHT`, `MID` |
| Date | `NOW`, `TODAY` |
| Arithmetic | `=A1+B1*2`, `=(A1-B1)/C1` |
| Comparison | `=A1>B1`, `=A1<>B1`, `=A1>=10` |

---

## 🔍 Verify Offline Behaviour

1. Enable **Airplane Mode** on your device
2. Open the app → it should load your last session instantly (from RNFS)
3. Edit some cells → changes auto-save locally
4. Kill and reopen the app → your work should still be there
5. Export → file saves to device Downloads (no upload, no cloud)

All of this works with **zero internet connection**.
