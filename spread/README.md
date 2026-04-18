# 📊 Spreadsheet Feature — Integration Guide

A full-featured XLSX spreadsheet engine for React Native (Android & iOS).
Supports viewing, editing, importing, and exporting `.xlsx` files.

---

## 🗂 Files Overview

```
your-app/
├── types/
│   └── spreadsheet.ts          ← Core data model & types
├── utils/
│   ├── addressUtils.ts         ← A1 notation helpers
│   ├── formulaEngine.ts        ← Formula evaluator (SUM, AVG, IF, etc.)
│   └── fileHandler.ts          ← xlsx import/export via SheetJS
├── store/
│   └── spreadsheetStore.ts     ← Zustand state management
├── components/spreadsheet/
│   ├── Cell.tsx                ← Memoized grid cell
│   ├── FormulaBar.tsx          ← Top formula/address bar
│   ├── SpreadsheetGrid.tsx     ← Virtualized grid (FlashList)
│   ├── Toolbar.tsx             ← Formatting toolbar
│   ├── SheetTabs.tsx           ← Sheet tab bar
│   └── ContextMenu.tsx         ← Long-press cell menu
└── screens/
    └── SpreadsheetScreen.tsx   ← Main screen (assembles everything)
```

---

## ✅ Step 1 — Install Dependencies

Run these in your React Native project root:

```bash
# Core spreadsheet parser / writer
npm install xlsx

# State management
npm install zustand

# Virtualized list (high-performance)
npm install @shopify/flash-list

# File system access
npm install react-native-fs

# File picker (for importing .xlsx)
npm install react-native-document-picker

# Gesture handling (for selection drag)
npm install react-native-gesture-handler

# Optional: sharing / opening in Excel
npx expo install expo-sharing   # if using Expo
# OR
npm install react-native-share  # for bare React Native
```

### iOS — pod install

```bash
cd ios && pod install && cd ..
```

---

## ✅ Step 2 — Android Permissions

Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"/>
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE"
    android:maxSdkVersion="28"/>
<!-- Android 10+ uses scoped storage — no extra permissions needed -->
```

For Android 13+ (API 33+), also add:
```xml
<uses-permission android:name="android.permission.READ_MEDIA_DOCUMENTS"/>
```

---

## ✅ Step 3 — iOS Permissions

Add to `ios/YourApp/Info.plist`:

```xml
<key>NSDocumentPickerUsageDescription</key>
<string>Used to import spreadsheet files</string>
<key>UIFileSharingEnabled</key>
<true/>
<key>LSSupportsOpeningDocumentsInPlace</key>
<true/>
```

---

## ✅ Step 4 — Copy Files

Copy all files from this package into your project, matching the folder structure shown above.

```
types/spreadsheet.ts          → src/types/spreadsheet.ts
utils/addressUtils.ts         → src/utils/addressUtils.ts
utils/formulaEngine.ts        → src/utils/formulaEngine.ts
utils/fileHandler.ts          → src/utils/fileHandler.ts
store/spreadsheetStore.ts     → src/store/spreadsheetStore.ts
components/spreadsheet/*.tsx  → src/components/spreadsheet/
screens/SpreadsheetScreen.tsx → src/screens/SpreadsheetScreen.tsx
```

> Adjust import paths inside each file to match your `src/` structure if different.

---

## ✅ Step 5 — Add to Navigation

### React Navigation (Stack)

```tsx
// In your navigator file:
import SpreadsheetScreen from './src/screens/SpreadsheetScreen';

<Stack.Screen
  name="Spreadsheet"
  component={SpreadsheetScreen}
  options={{ headerShown: false }}
/>
```

### Navigate to it

```tsx
navigation.navigate('Spreadsheet');
```

---

## ✅ Step 6 — Fix Import Paths

Each file uses relative imports. If your folder depth differs, update them.

Example — if your file is at `src/screens/SpreadsheetScreen.tsx`:

```ts
// Current (correct for depth src/screens/):
import { useSpreadsheetStore } from '../store/spreadsheetStore';
import FormulaBar from '../components/spreadsheet/FormulaBar';
```

---

## ✅ Step 7 — Optional: Pre-load an xlsx on Launch

In `SpreadsheetScreen.tsx`, call `importXlsx()` automatically or pass a URI:

```tsx
// Load from assets on mount
useEffect(() => {
  async function load() {
    // Example: load bundled file
    const base64 = await RNFS.readFileAssets('sample.xlsx', 'base64');
    const workbook = XLSX.read(base64, { type: 'base64' });
    // convert to sheets...
  }
  load();
}, []);
```

---

## ✅ Step 8 — Verify it Works

Run your app:

```bash
npx react-native run-android
# or
npx react-native run-ios
```

You should see:
- ✅ Toolbar with import/export/undo/redo buttons
- ✅ Formula bar showing selected cell address
- ✅ A scrollable grid with A1–Z100 cells
- ✅ Sheet tabs at the bottom
- ✅ Tap a cell → select it
- ✅ Double-tap → edit inline
- ✅ Long-press → context menu
- ✅ Import 📂 → opens document picker for `.xlsx`
- ✅ Export 💾 → saves file to Downloads

---

## 🔧 Configuration

### Default grid size

In `types/spreadsheet.ts`:

```ts
export const DEFAULT_ROW_COUNT = 100;  // change to 1000 for large sheets
export const DEFAULT_COL_COUNT = 26;   // A–Z
export const DEFAULT_ROW_HEIGHT = 24;  // pixels
export const DEFAULT_COL_WIDTH = 80;   // pixels
```

### Supported Formulas

| Formula | Example |
|---|---|
| SUM | `=SUM(A1:A10)` |
| AVERAGE / AVG | `=AVERAGE(B1:B5)` |
| MIN / MAX | `=MAX(C1:C20)` |
| COUNT / COUNTA | `=COUNT(A:A)` |
| IF | `=IF(A1>10,"Yes","No")` |
| ROUND | `=ROUND(A1,2)` |
| ABS | `=ABS(B3)` |
| LEN | `=LEN(A1)` |
| UPPER / LOWER | `=UPPER(A1)` |
| CONCATENATE | `=CONCATENATE(A1," ",B1)` |
| NOW / TODAY | `=NOW()` |
| Arithmetic | `=A1+B1*2` |

### Adding custom formulas

In `utils/formulaEngine.ts`, add to the `FUNCTIONS` object:

```ts
MYFORMULA: (args, sheet) => {
  // your logic here
  return result;
},
```

---

## ⚡ Performance Tips

1. **Large files (1000+ rows)**: FlashList handles this well. Avoid rendering more than `rowCount: 500` at once unless needed.

2. **Debounce formula recalculation**: In `store/spreadsheetStore.ts`, wrap `recalculateSheet()` with a debounce (100ms) for fast typing scenarios.

3. **Avoid style objects in renders**: All styles use `StyleSheet.create()` — don't add inline style objects to Cell/Row.

4. **Memoization**: All Cell, RowHeader, and ColHeader components use `React.memo` with custom comparators. Don't break this by passing new object references as props.

---

## 🐛 Common Issues

| Problem | Fix |
|---|---|
| `FlashList` import error | Run `npm install @shopify/flash-list` and `pod install` |
| `react-native-fs` not found | Run `npm install react-native-fs && pod install` |
| Picker crashes on Android | Add storage permissions in `AndroidManifest.xml` |
| File not saved on iOS | Add `UIFileSharingEnabled` to `Info.plist` |
| Formulas show `#ERROR` | Check formula syntax — cell refs must be uppercase |
| Grid doesn't scroll horizontally | Ensure `SpreadsheetGrid` is inside a `flex: 1` parent |

---

## 🚀 Next Steps (Phase 4 Features)

- [ ] Drag-to-select range (using `react-native-gesture-handler` PanGestureHandler)
- [ ] Autofill handle (drag bottom-right corner)
- [ ] Frozen rows/columns
- [ ] Find & Replace dialog
- [ ] Charts (`react-native-gifted-charts`)
- [ ] Cross-sheet references (`=Sheet2!A1`)
- [ ] Conditional formatting

---

*Built following the architecture from the WPS-style spreadsheet engine spec.*
