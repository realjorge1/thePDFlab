// Virtualized spreadsheet grid.
//
// Layout:
//   ┌──────────┬───────────────────────────┐
//   │  corner  │  column headers (frozen)  │
//   ├──────────┼───────────────────────────┤
//   │ row hdrs │  main grid (FlashList)    │
//   │ (frozen) │                           │
//   └──────────┴───────────────────────────┘
//
//   * Main grid horizontal scroll is at the parent ScrollView level.
//   * Main grid vertical scroll is virtualized by FlashList (one item per row).
//   * Frozen headers are non-interactive ScrollViews kept in sync via scrollTo.
//   * No `position: sticky` (web-only). All native-friendly.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSpreadsheetStore } from '../store/spreadsheetStore';
import {
  CellAddress,
  Cell as CellType,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  HEADER_HEIGHT,
  ROW_HEADER_WIDTH,
} from '../types/spreadsheet';
import {
  addressToA1,
  colIndexToLetter,
  isInRange,
} from '../engine/addressUtils';
import Cell, { ColHeader, RowHeader } from './Cell';
import ContextMenu from './ContextMenu';

// ─────────────────────────────────────────────────────────────
// Row renderer — one row of cells, used by FlashList
// ─────────────────────────────────────────────────────────────

interface RowRendererProps {
  rowIndex: number;
  colCount: number;
  rowHeight: number;
  colWidths: Map<number, number>;
  cells: Map<string, CellType>;
  selectedAddr?: CellAddress | null;
  rangeRows?: { minRow: number; maxRow: number; minCol: number; maxCol: number } | null;
  editingAddr?: CellAddress | null;
  onTap: (address: CellAddress) => void;
  onDoubleTap: (address: CellAddress) => void;
  onLongPress: (address: CellAddress) => void;
}

const RowRenderer = React.memo<RowRendererProps>(({
  rowIndex,
  colCount,
  rowHeight,
  colWidths,
  cells,
  selectedAddr,
  rangeRows,
  editingAddr,
  onTap,
  onDoubleTap,
  onLongPress,
}) => {
  const cols = useMemo(() => {
    const out: { col: number; width: number }[] = [];
    for (let c = 0; c < colCount; c++) {
      out.push({ col: c, width: colWidths.get(c) ?? DEFAULT_COL_WIDTH });
    }
    return out;
  }, [colCount, colWidths]);

  return (
    <View style={[styles.row, { height: rowHeight }]}>
      {cols.map(({ col, width }) => {
        const addr: CellAddress = { row: rowIndex, col };
        const a1 = addressToA1(addr).toUpperCase();
        const cell = cells.get(a1);
        const display = cell
          ? cell.formula
            ? String(cell.computed ?? '')
            : String(cell.value ?? '')
          : '';

        const isSelected =
          !!selectedAddr &&
          selectedAddr.row === rowIndex &&
          selectedAddr.col === col;

        const isInRangeFlag =
          !!rangeRows &&
          rowIndex >= rangeRows.minRow &&
          rowIndex <= rangeRows.maxRow &&
          col >= rangeRows.minCol &&
          col <= rangeRows.maxCol;

        const isEditing =
          !!editingAddr &&
          editingAddr.row === rowIndex &&
          editingAddr.col === col;

        return (
          <Cell
            key={col}
            address={addr}
            cell={cell}
            displayValue={display}
            width={width}
            height={rowHeight}
            isSelected={isSelected}
            isInRange={isInRangeFlag}
            isEditing={isEditing}
            onTap={onTap}
            onDoubleTap={onDoubleTap}
            onLongPress={onLongPress}
          />
        );
      })}
    </View>
  );
});
RowRenderer.displayName = 'SpreadsheetRow';

// ─────────────────────────────────────────────────────────────
// Main grid
// ─────────────────────────────────────────────────────────────

const SpreadsheetGrid: React.FC = () => {
  const sheet = useSpreadsheetStore(s => s.sheets[s.activeSheetIndex]);
  const selection = useSpreadsheetStore(s => s.selection);
  // Subscribe only to address numbers — NOT the full editing object — so the grid
  // does NOT re-render on every keystroke while a cell is being typed into.
  const editingRow = useSpreadsheetStore(s => s.editing?.address.row ?? -1);
  const editingCol = useSpreadsheetStore(s => s.editing?.address.col ?? -1);
  const editingAddr = editingRow >= 0 ? { row: editingRow, col: editingCol } : null;
  const setSelection = useSpreadsheetStore(s => s.setSelection);
  const startEditing = useSpreadsheetStore(s => s.startEditing);

  const [contextMenu, setContextMenu] = useState<CellAddress | null>(null);

  const colHeaderRef = useRef<ScrollView>(null);
  const rowHeaderRef = useRef<ScrollView>(null);

  const colWidths = sheet.colWidths;
  const rowHeights = sheet.rowHeights;
  const colCount = sheet.colCount;
  const rowCount = sheet.rowCount;

  // Compute total content width (sum of column widths)
  const totalWidth = useMemo(() => {
    let w = 0;
    for (let c = 0; c < colCount; c++) {
      w += colWidths.get(c) ?? DEFAULT_COL_WIDTH;
    }
    return w;
  }, [colCount, colWidths]);

  const rowIndices = useMemo(
    () => Array.from({ length: rowCount }, (_, i) => i),
    [rowCount],
  );

  // Pre-compute selection range bounds
  const rangeBounds = useMemo(() => {
    if (!selection?.range) return null;
    return {
      minRow: Math.min(selection.range.start.row, selection.range.end.row),
      maxRow: Math.max(selection.range.start.row, selection.range.end.row),
      minCol: Math.min(selection.range.start.col, selection.range.end.col),
      maxCol: Math.max(selection.range.start.col, selection.range.end.col),
    };
  }, [selection]);

  // ── Cell interaction handlers ─────────────────────────────
  const handleCellTap = useCallback((addr: CellAddress) => {
    setSelection({ cell: addr });
  }, [setSelection]);

  const handleCellDoubleTap = useCallback((addr: CellAddress) => {
    startEditing(addr);
  }, [startEditing]);

  const handleCellLongPress = useCallback((addr: CellAddress) => {
    setSelection({ cell: addr });
    setContextMenu(addr);
  }, [setSelection]);

  // ── Header tap handlers ───────────────────────────────────
  const handleColHeaderTap = useCallback((col: number) => {
    setSelection({
      cell: { row: 0, col },
      range: { start: { row: 0, col }, end: { row: rowCount - 1, col } },
    });
  }, [setSelection, rowCount]);

  const handleRowHeaderTap = useCallback((row: number) => {
    setSelection({
      cell: { row, col: 0 },
      range: { start: { row, col: 0 }, end: { row, col: colCount - 1 } },
    });
  }, [setSelection, colCount]);

  // ── Scroll sync ───────────────────────────────────────────
  const onMainHScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    colHeaderRef.current?.scrollTo({ x, animated: false });
  }, []);

  const onMainVScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    rowHeaderRef.current?.scrollTo({ y, animated: false });
  }, []);

  // ── Render ────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Top-left corner (above all scrolls) */}
      <View style={[styles.corner, { width: ROW_HEADER_WIDTH, height: HEADER_HEIGHT }]} />

      {/* Frozen column header (top, scroll-synced) */}
      <View
        style={[
          styles.colHeaderClip,
          { left: ROW_HEADER_WIDTH, height: HEADER_HEIGHT },
        ]}
        pointerEvents="box-none"
      >
        <ScrollView
          ref={colHeaderRef}
          horizontal
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ width: totalWidth, height: HEADER_HEIGHT }}
        >
          <View style={styles.colHeaderRow}>
            {Array.from({ length: colCount }).map((_, c) => {
              const w = colWidths.get(c) ?? DEFAULT_COL_WIDTH;
              const isSel =
                !!selection &&
                ((selection.range && c >= (rangeBounds?.minCol ?? -1) && c <= (rangeBounds?.maxCol ?? -2)) ||
                  selection.cell.col === c);
              return (
                <ColHeader
                  key={c}
                  label={colIndexToLetter(c)}
                  width={w}
                  height={HEADER_HEIGHT}
                  isSelected={isSel}
                  onPress={() => handleColHeaderTap(c)}
                />
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Frozen row header (left, scroll-synced) */}
      <View
        style={[
          styles.rowHeaderClip,
          { top: HEADER_HEIGHT, width: ROW_HEADER_WIDTH },
        ]}
        pointerEvents="box-none"
      >
        <ScrollView
          ref={rowHeaderRef}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ width: ROW_HEADER_WIDTH }}
        >
          {Array.from({ length: rowCount }).map((_, r) => {
            const h = rowHeights.get(r) ?? DEFAULT_ROW_HEIGHT;
            const isSel =
              !!selection &&
              ((selection.range && r >= (rangeBounds?.minRow ?? -1) && r <= (rangeBounds?.maxRow ?? -2)) ||
                selection.cell.row === r);
            return (
              <RowHeader
                key={r}
                label={String(r + 1)}
                height={h}
                width={ROW_HEADER_WIDTH}
                isSelected={isSel}
                onPress={() => handleRowHeaderTap(r)}
              />
            );
          })}
        </ScrollView>
      </View>

      {/* Main grid area: horizontal scroll → vertical FlashList */}
      <View
        style={[
          styles.gridArea,
          { top: HEADER_HEIGHT, left: ROW_HEADER_WIDTH },
        ]}
      >
        <ScrollView
          horizontal
          scrollEventThrottle={16}
          onScroll={onMainHScroll}
          showsHorizontalScrollIndicator
          showsVerticalScrollIndicator={false}
          bounces={false}
          keyboardShouldPersistTaps="handled"
          style={styles.hScroll}
          contentContainerStyle={{ width: totalWidth }}
        >
          <FlashList
            data={rowIndices}
            keyExtractor={(item) => `r${item}`}
            estimatedItemSize={DEFAULT_ROW_HEIGHT}
            scrollEventThrottle={16}
            onScroll={onMainVScroll}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: rowIndex }) => (
              <RowRenderer
                rowIndex={rowIndex}
                colCount={colCount}
                rowHeight={rowHeights.get(rowIndex) ?? DEFAULT_ROW_HEIGHT}
                colWidths={colWidths}
                cells={sheet.cells}
                selectedAddr={selection?.cell ?? null}
                rangeRows={rangeBounds}
                editingAddr={editingAddr}
                onTap={handleCellTap}
                onDoubleTap={handleCellDoubleTap}
                onLongPress={handleCellLongPress}
              />
            )}
            getItemType={() => 'row'}
            extraData={`${selection?.cell.row}:${selection?.cell.col}:${rangeBounds?.minRow}:${rangeBounds?.maxRow}:${editingRow}:${editingCol}`}
          />
        </ScrollView>
      </View>

      {/* Long-press context menu */}
      {contextMenu && (
        <ContextMenu
          address={contextMenu}
          onClose={() => setContextMenu(null)}
        />
      )}
    </View>
  );
};

export default SpreadsheetGrid;

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: '#F1F3F4',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#D0D0D0',
    zIndex: 10,
  },
  colHeaderClip: {
    position: 'absolute',
    top: 0,
    right: 0,
    overflow: 'hidden',
    backgroundColor: '#F8F9FA',
    zIndex: 5,
  },
  colHeaderRow: {
    flexDirection: 'row',
    height: HEADER_HEIGHT,
  },
  rowHeaderClip: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    overflow: 'hidden',
    backgroundColor: '#F8F9FA',
    zIndex: 5,
  },
  gridArea: {
    position: 'absolute',
    right: 0,
    bottom: 0,
  },
  hScroll: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
  },
});
