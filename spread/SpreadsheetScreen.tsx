// ============================================================
// screens/SpreadsheetScreen.tsx  [UPDATED — OFFLINE-FIRST]
//
// Changes from v1:
//  • On mount: loads last saved state from device (no network)
//  • AppState listener: flushes auto-save when app backgrounds
//  • "New" button: prompts user, wipes local save, resets store
//  • Save indicator: shows "Saved ✓" / "Unsaved changes" status
//  • All file I/O goes through local filesystem only
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  Alert,
  AppState,
  AppStateStatus,
  ActivityIndicator,
  BackHandler,
  TouchableOpacity,
} from 'react-native';
import { useSpreadsheetStore } from '../store/spreadsheetStore';
import FormulaBar  from '../components/spreadsheet/FormulaBar';
import Toolbar     from '../components/spreadsheet/Toolbar';
import SpreadsheetGrid from '../components/spreadsheet/SpreadsheetGrid';
import SheetTabs   from '../components/spreadsheet/SheetTabs';
import { importXlsx, exportXlsx } from '../utils/fileHandler';
import { flushAutoSave } from '../utils/persistence';

// ─────────────────────────────────────────────────────────────
// Save status badge
// ─────────────────────────────────────────────────────────────

const SaveBadge: React.FC<{ isDirty: boolean }> = ({ isDirty }) => (
  <View style={[styles.badge, isDirty ? styles.badgeDirty : styles.badgeClean]}>
    <Text style={[styles.badgeText, isDirty ? styles.badgeTextDirty : styles.badgeTextClean]}>
      {isDirty ? '● Unsaved' : '✓ Saved'}
    </Text>
  </View>
);

// ─────────────────────────────────────────────────────────────
// Main screen
// ─────────────────────────────────────────────────────────────

const SpreadsheetScreen: React.FC = () => {
  const {
    sheets,
    fileName,
    isDirty,
    isLoading,
    activeSheetIndex,
    setSheets,
    setFileName,
    markClean,
    undo,
    redo,
    loadSavedState,
    newSpreadsheet,
  } = useSpreadsheetStore();

  const [bootDone, setBootDone] = useState(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // ── Boot: restore from device on first mount ──────────────
  useEffect(() => {
    (async () => {
      await loadSavedState();  // reads from RNFS — no network
      setBootDone(true);
    })();
  }, []);

  // ── AppState: flush save when app goes to background ──────
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      // Flush any pending debounced save before background
      if (
        (prev === 'active' || prev === 'inactive') &&
        nextState === 'background'
      ) {
        await flushAutoSave({ sheets, activeSheetIndex, fileName });
      }
    });
    return () => sub.remove();
  }, [sheets, activeSheetIndex, fileName]);

  // ── Android back button ───────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isDirty) return false;
      Alert.alert(
        'Unsaved Changes',
        'Your work is auto-saved to this device. Export to .xlsx before leaving?',
        [
          { text: 'Leave',  style: 'destructive', onPress: () => BackHandler.exitApp() },
          { text: 'Export', onPress: handleExport },
          { text: 'Stay',   style: 'cancel' },
        ],
      );
      return true;
    });
    return () => sub.remove();
  }, [isDirty]);

  // ── Import ────────────────────────────────────────────────
  const handleImport = useCallback(async () => {
    if (isDirty) {
      const confirmed = await new Promise<boolean>(resolve =>
        Alert.alert(
          'Unsaved Changes',
          'Opening a new file will replace your current work. Continue?',
          [
            { text: 'Cancel',      style: 'cancel',      onPress: () => resolve(false) },
            { text: 'Open Anyway', style: 'destructive', onPress: () => resolve(true)  },
          ],
        ),
      );
      if (!confirmed) return;
    }

    const result = await importXlsx();     // reads from device picker — no network
    if (result.success && result.sheets) {
      setSheets(result.sheets, result.fileName);
      setFileName(result.fileName ?? 'imported.xlsx');
    } else if (result.error && result.error !== 'User cancelled') {
      Alert.alert('Import Failed', result.error);
    }
  }, [isDirty, setSheets, setFileName]);

  // ── Export ────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    const result = await exportXlsx(sheets, fileName);  // writes to device — no network
    if (result.success) {
      markClean();
      Alert.alert('Saved ✓', `File saved to:\n${result.filePath}`, [{ text: 'OK' }]);
    } else {
      Alert.alert('Export Failed', result.error ?? 'Unknown error');
    }
  }, [sheets, fileName, markClean]);

  // ── New file ──────────────────────────────────────────────
  const handleNew = useCallback(() => {
    if (isDirty) {
      Alert.alert(
        'Discard Changes?',
        'Starting a new spreadsheet will clear the current one. Any unsaved changes will be lost.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Export First',
            onPress: async () => {
              await handleExport();
              await newSpreadsheet();
            },
          },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => newSpreadsheet(),
          },
        ],
      );
    } else {
      Alert.alert(
        'New Spreadsheet',
        'Start a new empty spreadsheet?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'New',    onPress: () => newSpreadsheet() },
        ],
      );
    }
  }, [isDirty, handleExport, newSpreadsheet]);

  // ── Loading screen ────────────────────────────────────────
  if (!bootDone || isLoading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1A73E8" />
        <Text style={styles.loadingText}>Restoring your spreadsheet…</Text>
      </SafeAreaView>
    );
  }

  // ── Main UI ───────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" translucent={false} />

      <View style={styles.container}>

        {/* Top header bar */}
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {fileName}
          </Text>
          <View style={styles.headerRight}>
            <SaveBadge isDirty={isDirty} />
            <TouchableOpacity style={styles.newBtn} onPress={handleNew}>
              <Text style={styles.newBtnText}>＋ New</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Formatting toolbar */}
        <Toolbar
          onImport={handleImport}
          onExport={handleExport}
          onUndo={undo}
          onRedo={redo}
        />

        {/* Formula bar */}
        <FormulaBar />

        {/* Grid */}
        <View style={styles.gridContainer}>
          <SpreadsheetGrid />
        </View>

        {/* Sheet tabs */}
        <SheetTabs />
      </View>
    </SafeAreaView>
  );
};

export default SpreadsheetScreen;

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  gridContainer: {
    flex: 1,
    overflow: 'hidden',
  },

  // Header
  header: {
    flexDirection:    'row',
    alignItems:       'center',
    paddingHorizontal: 12,
    paddingVertical:   8,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    backgroundColor:  '#FFFFFF',
    gap: 8,
  },
  headerTitle: {
    flex: 1,
    fontSize:   14,
    fontWeight: '600',
    color:      '#202124',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems:    'center',
    gap: 8,
  },

  // Save badge
  badge: {
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      10,
  },
  badgeClean: {
    backgroundColor: '#E6F4EA',
  },
  badgeDirty: {
    backgroundColor: '#FEF3C7',
  },
  badgeText: {
    fontSize:   11,
    fontWeight: '600',
  },
  badgeTextClean: {
    color: '#137333',
  },
  badgeTextDirty: {
    color: '#92400E',
  },

  // New button
  newBtn: {
    paddingHorizontal: 10,
    paddingVertical:    4,
    borderRadius:       6,
    borderWidth:        1,
    borderColor:       '#DADCE0',
    backgroundColor:   '#F8F9FA',
  },
  newBtnText: {
    fontSize:   12,
    fontWeight: '600',
    color:      '#3C4043',
  },

  // Loading
  loadingContainer: {
    flex:            1,
    justifyContent:  'center',
    alignItems:      'center',
    backgroundColor: '#FFFFFF',
    gap: 16,
  },
  loadingText: {
    fontSize: 15,
    color:    '#5F6368',
  },
});
