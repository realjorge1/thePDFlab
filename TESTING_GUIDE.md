# Quick Testing Guide

## How to Test the PDF Tools Fixes

### 1. Test File Upload Fix (Most Critical)

**Pick any 5+ tools and verify they all work:**

#### Test Compress PDF

1. Open app → Tools → Compress PDF
2. Select a PDF file
3. **VERIFY**: Process button is at TOP (not bottom)
4. **VERIFY**: No "configure options" text shown
5. Choose compression level
6. Tap "Process PDF"
7. **EXPECTED**: No "No files uploaded" error
8. **EXPECTED**: Success message with output file
9. Tap "View File"
10. **EXPECTED**: Opens in PDF viewer
11. Go to Library
12. **EXPECTED**: Compressed file appears

---

#### Test Remove Pages (Text Input)

1. Open app → Tools → Remove Pages
2. Select a PDF file
3. **NEW UI**: See text input instead of page buttons
4. Enter: `1, 3, 5-7`
5. Tap "Process PDF" (at top)
6. **EXPECTED**: Pages 1, 3, 5, 6, 7 are removed
7. View result
8. **EXPECTED**: Output opens successfully

---

#### Test Merge PDF

1. Open app → Tools → Merge PDF
2. Select 2 or more PDF files
3. Tap "Process PDF"
4. **EXPECTED**: All files merged into one
5. View result
6. **EXPECTED**: Opens with all pages from both files

---

#### Test Protect PDF (Password Confirmation)

1. Open app → Tools → Protect PDF
2. Select a PDF file
3. **NEW UI**: See two password fields
4. Enter password: `test123`
5. Enter confirm: `test123`
6. Tap "Process PDF"
7. **EXPECTED**: Success
8. Try with mismatched passwords
9. **EXPECTED**: "Passwords do not match" error

---

#### Test Watermark (Logo Position)

1. Open app → Tools → Add Watermark
2. Select a PDF file
3. Enter text: `CONFIDENTIAL`
4. **NEW UI**: Select position (e.g., "Center")
5. Tap "Process PDF"
6. **EXPECTED**: Watermark applied at center
7. View result

---

### 2. Test Duplicate Pages (ALL Option)

1. Open app → Tools → Duplicate Pages
2. Select a PDF
3. **NEW UI**: See "Duplicate ALL pages" option
4. Tap the ALL option
5. **VERIFY**: Page input is disabled
6. Process
7. **EXPECTED**: All pages duplicated

Then test with specific pages:

1. Uncheck ALL
2. Enter: `2, 5-7`
3. Process
4. **EXPECTED**: Only pages 2, 5, 6, 7 duplicated

---

### 3. Test Remove Password (Confirmation)

1. Open app → Tools → Remove Password
2. Select a password-protected PDF
3. Enter the password
4. Tap "Process PDF"
5. **NEW UI**: See confirmation dialog
6. **VERIFY**: "Are you sure?" message appears
7. Confirm
8. **EXPECTED**: Password removed

---

## Quick Validation Checklist

### Visual Checks (No File Upload Needed)

- [ ] Process button is at TOP of screen
- [ ] No "configure options and process your file" text
- [ ] Remove Pages shows text input, not buttons
- [ ] Extract Pages shows text input, not buttons
- [ ] Duplicate Pages has "ALL" checkbox
- [ ] Protect PDF has 2 password fields
- [ ] Watermark shows position picker
- [ ] "Highlight" and "Draw" tools are removed from tools list

### Functional Checks (Requires Files)

- [ ] Compress: Processes without "No files uploaded" error
- [ ] Merge: Combines 2+ PDFs successfully
- [ ] Remove Pages: Accepts ranges like "1-5, 8"
- [ ] Watermark: Shows position options
- [ ] Protect PDF: Validates password match

### Output Verification

- [ ] Output file opens in PDF viewer
- [ ] Output file can be viewed without errors
- [ ] Output file appears in Library
- [ ] Output file can be shared

---

## Expected Error Messages (Good Errors)

These errors should appear when appropriate:

1. **Remove/Extract Pages**: "Please enter page numbers or ranges (e.g., 1, 3, 5-9)"
2. **Protect PDF**: "Passwords do not match. Please try again."
3. **Remove Password**: "Are you sure you want to remove the password from this PDF?"
4. **Redact/Sign PDF**: "This tool requires a preview interface which is currently under development."
5. **Unsupported Tool**: "The [Tool Name] tool is currently under development. Check back soon!"

---

## Known Issues to Document (If Found)

### Backend-Dependent

If backend doesn't support an endpoint, the tool will show:

- "Coming Soon" dialog
- Error message from backend

**This is expected behavior** for newly-mapped tools until backend implements them.

### Not Issues

- Redact PDF showing "Coming Soon" - Correct (needs preview UI)
- Sign PDF showing "Coming Soon" - Correct (needs preview UI)
- Forms tools showing "Coming Soon" - Correct (backend dependent)

---

## Success Criteria

✅ **Must Work**:

- Merge (2+ files)
- Compress (any quality)
- Remove Pages (text input)
- Extract Pages (text input)
- Watermark (text + position)

✅ **Must Show in UI**:

- Process button at top
- No "configure options" text
- Text input for page selection
- Password confirmation
- Watermark position picker

✅ **Must Be Removed**:

- Highlight tool (not in list)
- Draw tool (not in list)

---

## If You Find Bugs

### File Upload Still Failing

- Check: Is internet connected?
- Check: Is backend URL correct in app.json?
- Check: Does backend server respond to /health?
- Verify: Headers in Network tab should NOT have "Content-Type: multipart/form-data"

### Page Input Not Working

- Verify: Input accepts text like "1, 3, 5-9"
- Verify: parsePageInput function handles ranges
- Check: Validation shows error if empty

### Process Button Missing

- Check: Are you in Success or Error state?
- Button only shows when NOT processing and NO success result

---

**Last Updated**: February 6, 2026  
**Tools Tested**: Ready for testing  
**Expected Test Time**: 15-20 minutes for all 5 critical tools
