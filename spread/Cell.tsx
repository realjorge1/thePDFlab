// ============================================================
// components/spreadsheet/Cell.tsx
// Lightweight, memoized cell component for the grid
// ============================================================

import React, { memo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { CellAddress, Cell as CellType, CellStyle, DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from '../../types/spreadsheet';

// ── Props ─────────────────────────────────────────────────

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

// ── Colors ────────────────────────────────────────────────

const COLORS = {
  selected: '#1A73E8',
  selectedBg: '#E8F0FE',
  rangeBg: '#D2E3FC',
  border: '#D0D0D0',
  text: '#202124',
  headerBg: '#F8F9FA',
  errorText: '#D93025',
};

// ── Component ─────────────────────────────────────────────

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

  const handlePress = useCallback(() => onTap(address), [address, onTap]);
  const handleLongPress = useCallback(() => onLongPress(address), [address, onLongPress]);

  // Track double tap manually
  const lastTap = React.useRef<number>(0);
  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      onDoubleTap(address);
    } else {
      handlePress();
    }
    lastTap.current = now;
  }, [address, handlePress, onDoubleTap]);

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
  // Custom equality — only re-render if relevant props changed
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

// ── Row Header Cell ───────────────────────────────────────

interface RowHeaderProps {
  label: string;
  height: number;
  isSelected: boolean;
  onPress: () => void;
}

export const RowHeader = memo<RowHeaderProps>(({ label, height, isSelected, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.rowHeader, { height }, isSelected && styles.rowHeaderSelected]}
  >
    <Text style={[styles.headerText, isSelected && styles.headerTextSelected]}>
      {label}
    </Text>
  </TouchableOpacity>
));
RowHeader.displayName = 'RowHeader';

// ── Column Header Cell ────────────────────────────────────

interface ColHeaderProps {
  label: string;
  width: number;
  isSelected: boolean;
  onPress: () => void;
}

export const ColHeader = memo<ColHeaderProps>(({ label, width, isSelected, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.colHeader, { width }, isSelected && styles.colHeaderSelected]}
  >
    <Text style={[styles.headerText, isSelected && styles.headerTextSelected]}>
      {label}
    </Text>
  </TouchableOpacity>
));
ColHeader.displayName = 'ColHeader';

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  cell: {
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
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
    width: 40,
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
    height: 24,
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
