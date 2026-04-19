// Lightweight, memoized cell component for the grid.

import React, { memo, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { CellAddress, Cell as CellType } from '../types/spreadsheet';
import { useSpreadsheetStore } from '../store/spreadsheetStore';

// ─── Inline editor — only mounts on the one editing cell ─────────────────────
// Uses uncontrolled pattern (defaultValue + ref) to avoid re-renders during
// keystrokes. The store is updated via onChangeText but the input itself
// never re-renders, so focus is rock-solid.
const InlineCellEditor = memo(() => {
  const updateEditingValue = useSpreadsheetStore(s => s.updateEditingValue);
  const commitEdit = useSpreadsheetStore(s => s.commitEdit);
  const initialValue = useSpreadsheetStore.getState().editing?.value ?? '';
  const inputRef = useRef<TextInput>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const handleSubmit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    commitEdit();
  }, [commitEdit]);

  return (
    <TextInput
      ref={inputRef}
      defaultValue={initialValue}
      onChangeText={updateEditingValue}
      onSubmitEditing={handleSubmit}
      onBlur={handleSubmit}
      style={styles.editInput}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      returnKeyType="done"
      blurOnSubmit
      multiline={false}
      underlineColorAndroid="transparent"
    />
  );
});
InlineCellEditor.displayName = 'InlineCellEditor';

// ─── Cell ─────────────────────────────────────────────────────────────────────

interface CellProps {
  address: CellAddress;
  cell?: CellType;
  displayValue: string;
  width: number;
  height: number;
  isSelected: boolean;
  isInRange: boolean;
  isEditing: boolean;
  onTap: (address: CellAddress) => void;
  onDoubleTap: (address: CellAddress) => void;
  onLongPress: (address: CellAddress) => void;
}

const COLORS = {
  selected: '#1A73E8',
  selectedBg: '#E8F0FE',
  rangeBg: '#D2E3FC',
  border: '#D0D0D0',
  text: '#202124',
  headerBg: '#F8F9FA',
  errorText: '#D93025',
};

const Cell = memo<CellProps>(({
  address,
  cell,
  displayValue,
  width,
  height,
  isSelected,
  isInRange,
  isEditing,
  onTap,
  onDoubleTap,
  onLongPress,
}) => {
  const style = cell?.style;
  const isError = String(displayValue).startsWith('#');
  const isNumber = cell?.type === 'number' ||
    (!isError && !isNaN(Number(displayValue)) && displayValue !== '');

  const lastTap = React.useRef<number>(0);
  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      onDoubleTap(address);
    } else {
      onTap(address);
    }
    lastTap.current = now;
  }, [address, onTap, onDoubleTap]);

  const handleLongPress = useCallback(() => onLongPress(address), [address, onLongPress]);

  const containerStyle = [
    styles.cell,
    { width, height },
    isInRange && !isSelected && styles.inRange,
    isSelected && styles.selected,
    isEditing && styles.editing,
  ];

  const textStyle = [
    styles.cellText,
    isNumber && styles.numberText,
    isError && styles.errorText,
    style?.bold && { fontWeight: 'bold' as const },
    style?.italic && { fontStyle: 'italic' as const },
    style?.underline && { textDecorationLine: 'underline' as const },
    style?.fontSize ? { fontSize: style.fontSize } : {},
    style?.fontColor ? { color: style.fontColor } : {},
    style?.align ? { textAlign: style.align } : {},
  ];

  const innerStyle: any[] = [styles.inner];
  if (style?.backgroundColor) {
    innerStyle.push({ backgroundColor: style.backgroundColor });
  }

  // When editing, render the TextInput directly (no TouchableOpacity wrapper)
  // so taps reach the input instead of being intercepted and committing the edit.
  if (isEditing) {
    return (
      <View style={[styles.cell, { width, height }, styles.editing]}>
        <View style={innerStyle}>
          <InlineCellEditor />
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={handleTap}
      onLongPress={handleLongPress}
      style={containerStyle}
      delayLongPress={400}
    >
      <View style={innerStyle}>
        <Text
          style={textStyle}
          numberOfLines={style?.wrap ? undefined : 1}
          ellipsizeMode="tail"
        >
          {displayValue}
        </Text>
      </View>
    </TouchableOpacity>
  );
}, (prev, next) => {
  return (
    prev.displayValue === next.displayValue &&
    prev.isSelected === next.isSelected &&
    prev.isInRange === next.isInRange &&
    prev.isEditing === next.isEditing &&
    prev.width === next.width &&
    prev.height === next.height &&
    prev.cell?.style === next.cell?.style
  );
});

Cell.displayName = 'SpreadsheetCell';
export default Cell;

// ─── Row / Col headers ────────────────────────────────────────────────────────

interface RowHeaderProps {
  label: string;
  height: number;
  width: number;
  isSelected: boolean;
  onPress: () => void;
}

export const RowHeader = memo<RowHeaderProps>(({ label, height, width, isSelected, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.rowHeader, { height, width }, isSelected && styles.rowHeaderSelected]}
  >
    <Text style={[styles.headerText, isSelected && styles.headerTextSelected]}>
      {label}
    </Text>
  </TouchableOpacity>
));
RowHeader.displayName = 'RowHeader';

interface ColHeaderProps {
  label: string;
  width: number;
  height: number;
  isSelected: boolean;
  onPress: () => void;
}

export const ColHeader = memo<ColHeaderProps>(({ label, width, height, isSelected, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.colHeader, { width, height }, isSelected && styles.colHeaderSelected]}
  >
    <Text style={[styles.headerText, isSelected && styles.headerTextSelected]}>
      {label}
    </Text>
  </TouchableOpacity>
));
ColHeader.displayName = 'ColHeader';

const styles = StyleSheet.create({
  cell: {
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  inner: {
    flex: 1,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  selected: {
    borderWidth: 2,
    borderColor: COLORS.selected,
    backgroundColor: COLORS.selectedBg,
    zIndex: 2,
  },
  inRange: {
    backgroundColor: COLORS.rangeBg,
  },
  editing: {
    borderWidth: 2,
    borderColor: COLORS.selected,
    zIndex: 3,
    backgroundColor: '#FFFFFF',
  },
  editInput: {
    flex: 1,
    paddingVertical: 0,
    paddingHorizontal: 4,
    margin: 0,
    fontSize: 13,
    color: COLORS.text,
    backgroundColor: '#FFFFFF',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  cellText: {
    fontSize: 13,
    color: COLORS.text,
    textAlign: 'left',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  numberText: {
    textAlign: 'right',
  },
  errorText: {
    color: COLORS.errorText,
    textAlign: 'center',
  },
  rowHeader: {
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.headerBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rowHeaderSelected: {
    backgroundColor: '#C9D9F5',
  },
  colHeader: {
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.headerBg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  colHeaderSelected: {
    backgroundColor: '#C9D9F5',
  },
  headerText: {
    fontSize: 11,
    color: '#5F6368',
    fontWeight: '600',
  },
  headerTextSelected: {
    color: COLORS.selected,
    fontWeight: '700',
  },
});
