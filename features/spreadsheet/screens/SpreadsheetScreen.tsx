// Top-level spreadsheet screen.
// - On mount: restore last saved state from device (no network).
// - On background: flush pending auto-save.
// - "New" button: prompts and resets the store.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  StatusBar,
  Platform,
  Alert,
  AppState,
  AppStateStatus,
  ActivityIndicator,
  BackHandler,
  Pressable,
  useColorScheme,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useSpreadsheetStore } from '../store/spreadsheetStore';
import FormulaBar from '../components/FormulaBar';
import Toolbar from '../components/Toolbar';
import SpreadsheetGrid from '../components/SpreadsheetGrid';
import SheetTabs from '../components/SheetTabs';
import { importXlsx, exportXlsx } from '../services/fileHandler';
import { flushAutoSave } from '../services/persistence';
import {
  DarkTheme,
  LightTheme,
  Palette,
  Spacing,
  Typography,
} from '@/services/document-manager';

const SpreadsheetScreen: React.FC = () => {
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = colorScheme === 'dark' ? DarkTheme : LightTheme;

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

  // Boot: restore from device on first mount
  useEffect(() => {
    (async () => {
      await loadSavedState();
      setBootDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // AppState: flush save when app goes to background
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if (
        (prev === 'active' || prev === 'inactive') &&
        nextState === 'background'
      ) {
        await flushAutoSave({ sheets, activeSheetIndex, fileName });
      }
    });
    return () => sub.remove();
  }, [sheets, activeSheetIndex, fileName]);

  // ── Export ────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    const result = await exportXlsx(sheets, fileName);
    if (result.success) {
      markClean();
      Alert.alert('Saved ✓', `File saved to:\n${result.filePath}`, [{ text: 'OK' }]);
    } else {
      Alert.alert('Export Failed', result.error ?? 'Unknown error');
    }
  }, [sheets, fileName, markClean]);

  // Android back button — prompt if dirty
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isDirty) return false;
      Alert.alert(
        'Unsaved Changes',
        'Your work is auto-saved on this device. Export to .xlsx before leaving?',
        [
          { text: 'Leave', style: 'destructive', onPress: () => router.back() },
          { text: 'Export', onPress: handleExport },
          { text: 'Stay', style: 'cancel' },
        ],
      );
      return true;
    });
    return () => sub.remove();
  }, [isDirty, router, handleExport]);

  // ── Import ────────────────────────────────────────────────
  const handleImport = useCallback(async () => {
    if (isDirty) {
      const confirmed = await new Promise<boolean>(resolve =>
        Alert.alert(
          'Unsaved Changes',
          'Opening a new file will replace your current work. Continue?',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Open Anyway', style: 'destructive', onPress: () => resolve(true) },
          ],
        ),
      );
      if (!confirmed) return;
    }

    const result = await importXlsx();
    if (result.success && result.sheets) {
      setSheets(result.sheets, result.fileName);
      setFileName(result.fileName ?? 'imported.xlsx');
    } else if (result.error && result.error !== 'User cancelled') {
      Alert.alert('Import Failed', result.error);
    }
  }, [isDirty, setSheets, setFileName]);

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
          { text: 'New', onPress: () => newSpreadsheet() },
        ],
      );
    }
  }, [isDirty, handleExport, newSpreadsheet]);

  const handleRename = useCallback(
    (newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) return;
      const finalName = /\.xlsx$/i.test(trimmed) ? trimmed : `${trimmed}.xlsx`;
      setFileName(finalName);
    },
    [setFileName],
  );

  if (!bootDone || isLoading) {
    return (
      <SafeAreaView
        style={[styles.loadingContainer, { backgroundColor: theme.background.primary }]}
        edges={['top']}
      >
        <ActivityIndicator size="large" color={Palette.primary[500]} />
        <Text style={[styles.loadingText, { color: theme.text.secondary }]}>
          Restoring your spreadsheet…
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: theme.background.primary }]}
      edges={['top']}
    >
      <StatusBar
        barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={theme.surface.primary}
        translucent={false}
      />

      <View style={styles.container}>
        <Header
          theme={theme}
          fileName={fileName}
          isDirty={isDirty}
          onClose={() => router.back()}
          onRename={handleRename}
          onNew={handleNew}
          onExport={handleExport}
        />

        <Toolbar
          onImport={handleImport}
          onExport={handleExport}
          onUndo={undo}
          onRedo={redo}
        />

        <FormulaBar />

        <View style={styles.gridContainer}>
          <SpreadsheetGrid />
        </View>

        <SheetTabs />
      </View>
    </SafeAreaView>
  );
};

export default SpreadsheetScreen;

// ============================================================================
// HEADER
// ============================================================================
interface HeaderProps {
  theme: typeof LightTheme;
  fileName: string;
  isDirty: boolean;
  onClose: () => void;
  onRename: (name: string) => void;
  onNew: () => void;
  onExport: () => void;
}

function stripExt(name: string): string {
  return name.replace(/\.xlsx$/i, '');
}

const Header: React.FC<HeaderProps> = ({
  theme,
  fileName,
  isDirty,
  onClose,
  onRename,
  onNew,
  onExport,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(stripExt(fileName));
  const submittedRef = useRef(false);

  const startEdit = useCallback(() => {
    setDraft(stripExt(fileName));
    submittedRef.current = false;
    setEditing(true);
  }, [fileName]);

  const submit = useCallback(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onRename(draft);
    setEditing(false);
  }, [draft, onRename]);

  const cancel = useCallback(() => {
    submittedRef.current = true;
    setDraft(stripExt(fileName));
    setEditing(false);
  }, [fileName]);

  return (
    <View
      style={[
        styles.header,
        {
          backgroundColor: theme.surface.primary,
          borderBottomColor: theme.border.light,
        },
      ]}
    >
      {/* Left: close */}
      <Pressable onPress={onClose} style={styles.headerButton} hitSlop={6}>
        <MaterialIcons name="close" size={26} color={theme.text.primary} />
      </Pressable>

      {/* Center: filename (tap to edit) */}
      <View style={styles.headerCenter}>
        {editing ? (
          <View style={styles.titleEditRow}>
            <TextInput
              autoFocus
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={submit}
              onBlur={submit}
              selectTextOnFocus
              returnKeyType="done"
              autoCapitalize="none"
              autoCorrect={false}
              style={[
                styles.headerTitle,
                styles.headerTitleInput,
                {
                  color: theme.text.primary,
                  borderColor: theme.border.focus,
                },
              ]}
            />
            <Pressable onPress={cancel} style={styles.titleAction} hitSlop={8}>
              <MaterialIcons name="close" size={18} color={theme.text.secondary} />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={startEdit} style={styles.titleTouchable}>
            <Text
              style={[styles.headerTitle, { color: theme.text.primary }]}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {fileName}
            </Text>
            <MaterialIcons
              name="edit"
              size={14}
              color={theme.text.tertiary}
              style={styles.titleEditIcon}
            />
          </Pressable>
        )}
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isDirty ? Palette.warning.main : Palette.success.main },
            ]}
          />
          <Text style={[styles.statusText, { color: theme.text.secondary }]}>
            {isDirty ? 'Unsaved' : 'Saved'}
          </Text>
        </View>
      </View>

      {/* Right: actions */}
      <View style={styles.headerActions}>
        <Pressable
          onPress={onExport}
          style={styles.headerButton}
          hitSlop={6}
          disabled={!isDirty}
        >
          <MaterialIcons
            name="save"
            size={22}
            color={isDirty ? Palette.primary[500] : theme.text.tertiary}
          />
        </Pressable>
        <Pressable onPress={onNew} style={styles.headerButton} hitSlop={6}>
          <MaterialIcons name="note-add" size={22} color={theme.text.primary} />
        </Pressable>
      </View>
    </View>
  );
};

// ============================================================================
// STYLES
// ============================================================================
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  gridContainer: {
    flex: 1,
    overflow: 'hidden',
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
  },
  headerButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
  },
  titleTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
  },
  titleEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  titleAction: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  titleEditIcon: {
    marginLeft: 6,
  },
  headerTitle: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    textAlign: 'center',
  },
  headerTitleInput: {
    flex: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderRadius: 6,
    textAlign: 'left',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: Typography.size.xs,
    fontWeight: Typography.weight.medium,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // ── Loading ──
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: Typography.size.base,
  },
});
