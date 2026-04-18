// ============================================================
// components/spreadsheet/SpreadsheetGrid.tsx
// Virtualized grid using FlashList (or FlatList as fallback)
// Requires: npm install @shopify/flash-list
// ============================================================

import React, { useCallback, useRef, useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  StyleSheet,
  Keyboard,
  Platform,
  Dimensions,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSpreadsheetStore } from '../../store/spreadsheetStore';
import Cell, { RowHeader, ColHeader } from './Cell';
import ContextMenu from './ContextMenu';
import {
  CellAddress,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_COL_WIDTH,
  HEADER_HEIGHT,
  ROW_HEADER_WIDTH,
} from '../../types/spreadsheet';
import {
  addressToA1,
  getColumnLabel,
  getRowLabel,
  isInRange,
  normalizeRange,
} from '../../utils/addressUtils';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ── Grid Row ──────────────────────────────────────────────

interface GridRowProps {
  rowIndex: number;
  colCount: number;
  scrollRef: React.RefObject<ScrollView>;
}

const GridRow = React.memo<GridRowProps>(({ rowIndex, colCount }) => {
  const {
    activeSheet,
    selection,
    editing,
    setSelection,
    startEditing,
    commitEdit,
    extendSelection,
  } = useSpreadsheetStore();

  const sheet = activeSheet();

  const cells = useMemo(() => Array.from({ length: colCount }, (_, col) => col), [colCount]);

  const selRange = selection?.range
    ? normalizeRange(selection.range)
    : selection
    ? { start: selection.cell, end: selection.cell }
    : null;

  return (
    <View style={styles.row}>
      {/* Row header */}
      <RowHeader
        label={getRowLabel(rowIndex)}
        height={sheet.rowHeights.get(rowIndex) ?? DEFAULT_ROW_HEIGHT}
        isSelected={
          selRange !== null &&
          rowIndex >= selRange.start.row &&
          rowIndex <= selRange.end.row
        }
        onPress={() => {
          setSelection({
            cell: { row: rowIndex, col: 0 },
            range: { start: { row: rowIndex, col: 0 }, end: { row: rowIndex, col: colCount - 1 } },
          });
        }}
      />

      {/* Cells */}
      {cells.map(col => {
        const address: CellAddress = { row: rowIndex, col };
        const key = addressToA1(address).toUpperCase();
        const cell = sheet.cells.get(key);
        const isSelected = selection?.cell.row === rowIndex && selection?.cell.col === col;
        const inRange = selRange ? isInRange(address, selRange) : false;
        const isEditingCell = editing?.address.row === rowIndex && editing?.address.col === col;

        const displayValue = cell?.formula
          ? String(cell.computed ?? '')
          : String(cell?.value ?? '');

        return (
          <Cell
            key={`${rowIndex}-${col}`}
            address={address}
            cell={cell}
            displayValue={displayValue}
            width={sheet.colWidths.get(col) ?? DEFAULT_COL_WIDTH}
            height={sheet.rowHeights.get(rowIndex) ?? DEFAULT_ROW_HEIGHT}
            isSelected={isSelected}
            isInRange={inRange && !isSelected}
            isEditing={isEditingCell}
            onTap={(addr) => {
              Keyboard.dismiss();
              setSelection({ cell: addr });
            }}
            onDoubleTap={(addr) => {
              startEditing(addr);
            }}
            onLongPress={(addr) => {
              setSelection({ cell: addr });
            }}
          />
        );
      })}
    </View>
  );
}, (prev, next) => prev.rowIndex === next.rowIndex && prev.colCount === next.colCount);

GridRow.displayName = 'GridRow';

// ── Column Headers Row ────────────────────────────────────

const ColHeadersRow = React.memo(() => {
  const { activeSheet, selection, setSelection } = useSpreadsheetStore();
  const sheet = activeSheet();
  const cols = useMemo(() =>
    Array.from({ length: sheet.colCount }, (_, col) => col),
    [sheet.colCount],
  );

  const selRange = selection?.range
    ? normalizeRange(selection.range)
    : selection
    ? { start: selection.cell, end: selection.cell }
    : null;

  return (
    <View style={styles.colHeadersRow}>
      {/* Corner cell */}
      <View style={styles.cornerCell} />

      {cols.map(col => (
        <ColHeader
          key={col}
          label={getColumnLabel(col)}
          width={sheet.colWidths.get(col) ?? DEFAULT_COL_WIDTH}
          isSelected={
            selRange !== null &&
            col >= selRange.start.col &&
            col <= selRange.end.col
          }
          onPress={() => {
            setSelection({
              cell: { row: 0, col },
              range: { start: { row: 0, col }, end: { row: sheet.rowCount - 1, col } },
            });
          }}
        />
      ))}
    </View>
  );
});
ColHeadersRow.displayName = 'ColHeadersRow';

// ── Inline Cell Editor ────────────────────────────────────

const InlineCellEditor = React.memo(() => {
  const { editing, updateEditingValue, commitEdit, cancelEdit, activeSheet } = useSpreadsheetStore();
  const inputRef = useRef<TextInput>(null);

  React.useEffect(() => {
    if (editing) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [editing?.address]);

  if (!editing) return null;

  const sheet = activeSheet();
  const colWidth = sheet.colWidths.get(editing.address.col) ?? DEFAULT_COL_WIDTH;
  const rowHeight = sheet.rowHeights.get(editing.address.row) ?? DEFAULT_ROW_HEIGHT;

  return (
    <TextInput
      ref={inputRef}
      style={[
        styles.inlineEditor,
        { width: Math.max(colWidth, 100), height: rowHeight },
      ]}
      value={editing.value}
      onChangeText={updateEditingValue}
      onSubmitEditing={commitEdit}
      onBlur={commitEdit}
      returnKeyType="done"
      autoCapitalize="characters"
      autoCorrect={false}
      spellCheck={false}
    />
  );
});
InlineCellEditor.displayName = 'InlineCellEditor';

// ── Main Grid ─────────────────────────────────────────────

const SpreadsheetGrid: React.FC = () => {
  const { activeSheet, selection, setSelection, extendSelection } = useSpreadsheetStore();
  const sheet = activeSheet();
  const horizontalScrollRef = useRef<ScrollView>(null);
  const [contextMenu, setContextMenu] = useState<{ address: CellAddress } | null>(null);

  const rows = useMemo(
    () => Array.from({ length: sheet.rowCount }, (_, i) => i),
    [sheet.rowCount],
  );

  const estimatedRowHeight = DEFAULT_ROW_HEIGHT;

  const renderRow = useCallback(
    ({ item: rowIndex }: { item: number }) => (
      <GridRow
        rowIndex={rowIndex}
        colCount={sheet.colCount}
        scrollRef={horizontalScrollRef}
      />
    ),
    [sheet.colCount],
  );

  const keyExtractor = useCallback((item: number) => String(item), []);

  return (
    <View style={styles.container}>
      {/* Sticky Column Headers + Horizontal Scroll */}
      <ScrollView
        ref={horizontalScrollRef}
        horizontal
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        bounces={false}
        style={styles.horizontalScroll}
      >
        <View>
          {/* Column Headers */}
          <ColHeadersRow />

          {/* Grid rows */}
          <FlashList
            data={rows}
            renderItem={renderRow}
            keyExtractor={keyExtractor}
            estimatedItemSize={estimatedRowHeight}
            showsVerticalScrollIndicator={true}
            overScrollMode="never"
            bounces={false}
            getItemType={() => 'row'}
          />
        </View>
      </ScrollView>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          address={contextMenu.address}
          onClose={() => setContextMenu(null)}
        />
      )}
    </View>
  );
};

export default SpreadsheetGrid;

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  horizontalScroll: {
    flex: 1,
  },
  colHeadersRow: {
    flexDirection: 'row',
    position: 'sticky' as any, // Works on web; on native, use Animated approach
  },
  cornerCell: {
    width: ROW_HEADER_WIDTH,
    height: HEADER_HEIGHT,
    backgroundColor: '#F8F9FA',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#D0D0D0',
  },
  row: {
    flexDirection: 'row',
  },
  inlineEditor: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#1A73E8',
    paddingHorizontal: 4,
    fontSize: 13,
    color: '#202124',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    zIndex: 100,
  },
});
