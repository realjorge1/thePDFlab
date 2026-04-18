// ============================================================
// components/spreadsheet/FormulaBar.tsx
// The formula/address bar at the top of the spreadsheet
// ============================================================

import React, { useRef, useEffect, useCallback } from 'react';
import {
  View,
  TextInput,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSpreadsheetStore } from '../../store/spreadsheetStore';
import { addressToA1 } from '../../utils/addressUtils';

// ── Component ─────────────────────────────────────────────

const FormulaBar: React.FC = () => {
  const inputRef = useRef<TextInput>(null);
  const {
    selection,
    editing,
    getCell,
    startEditing,
    updateEditingValue,
    commitEdit,
    cancelEdit,
  } = useSpreadsheetStore();

  // Address label (e.g. "A1")
  const addressLabel = selection
    ? addressToA1(selection.cell).toUpperCase()
    : '';

  // The value shown in the formula bar
  const displayValue = editing
    ? editing.value
    : (() => {
        if (!selection) return '';
        const cell = getCell(selection.cell);
        if (!cell) return '';
        return cell.formula ?? String(cell.value ?? '');
      })();

  // When selection changes, focus if editing
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  const handleBarFocus = useCallback(() => {
    if (!selection || editing) return;
    const cell = getCell(selection.cell);
    const value = cell?.formula ?? String(cell?.value ?? '');
    startEditing(selection.cell, value);
  }, [selection, editing, getCell, startEditing]);

  const handleChangeText = useCallback((text: string) => {
    updateEditingValue(text);
  }, [updateEditingValue]);

  const handleSubmitEditing = useCallback(() => {
    commitEdit();
  }, [commitEdit]);

  const handleCancelPress = useCallback(() => {
    cancelEdit();
  }, [cancelEdit]);

  const handleConfirmPress = useCallback(() => {
    commitEdit();
  }, [commitEdit]);

  return (
    <View style={styles.container}>
      {/* Address Box */}
      <View style={styles.addressBox}>
        <Text style={styles.addressText} numberOfLines={1}>
          {addressLabel}
        </Text>
      </View>

      <View style={styles.divider} />

      {/* fx Icon */}
      <View style={styles.fxContainer}>
        <Text style={[styles.fxText, editing?.isFormulaMode && styles.fxActive]}>
          fx
        </Text>
      </View>

      {/* Input Field */}
      <TextInput
        ref={inputRef}
        style={styles.input}
        value={displayValue}
        onFocus={handleBarFocus}
        onChangeText={handleChangeText}
        onSubmitEditing={handleSubmitEditing}
        returnKeyType="done"
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        selectTextOnFocus={false}
        placeholder="Enter value or formula..."
        placeholderTextColor="#BDBDBD"
      />

      {/* Cancel / Confirm buttons (only when editing) */}
      {editing && (
        <View style={styles.editButtons}>
          <TouchableOpacity style={styles.editBtn} onPress={handleCancelPress}>
            <Text style={styles.cancelText}>✕</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.editBtn, styles.confirmBtn]} onPress={handleConfirmPress}>
            <Text style={styles.confirmText}>✓</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

export default React.memo(FormulaBar);

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
    paddingHorizontal: 4,
  },
  addressBox: {
    width: 60,
    height: 28,
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 3,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F9FA',
  },
  addressText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#202124',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  divider: {
    width: 1,
    height: 24,
    backgroundColor: '#E0E0E0',
    marginHorizontal: 6,
  },
  fxContainer: {
    paddingHorizontal: 6,
    justifyContent: 'center',
  },
  fxText: {
    fontSize: 13,
    color: '#5F6368',
    fontStyle: 'italic',
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
  },
  fxActive: {
    color: '#1A73E8',
    fontWeight: '700',
  },
  input: {
    flex: 1,
    height: 36,
    fontSize: 13,
    color: '#202124',
    paddingHorizontal: 6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  editButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  editBtn: {
    width: 28,
    height: 28,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#DADCE0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  confirmBtn: {
    backgroundColor: '#1A73E8',
    borderColor: '#1A73E8',
  },
  cancelText: {
    fontSize: 12,
    color: '#5F6368',
  },
  confirmText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '700',
  },
});
