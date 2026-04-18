// ============================================================
// components/spreadsheet/ContextMenu.tsx
// Long-press context menu for cell operations
// ============================================================

import React, { useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import { useSpreadsheetStore } from '../../store/spreadsheetStore';
import { CellAddress } from '../../types/spreadsheet';
import { addressToA1 } from '../../utils/addressUtils';

// ── Props ─────────────────────────────────────────────────

interface ContextMenuProps {
  address: CellAddress;
  onClose: () => void;
}

// ── Menu Item ─────────────────────────────────────────────

interface MenuItemProps {
  icon: string;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, onPress, destructive, disabled }) => (
  <TouchableOpacity
    style={[styles.menuItem, disabled && styles.menuItemDisabled]}
    onPress={onPress}
    disabled={disabled}
    activeOpacity={0.6}
  >
    <Text style={styles.menuIcon}>{icon}</Text>
    <Text style={[styles.menuLabel, destructive && styles.menuLabelDestructive, disabled && styles.menuLabelDisabled]}>
      {label}
    </Text>
  </TouchableOpacity>
);

// ── Component ─────────────────────────────────────────────

const ContextMenu: React.FC<ContextMenuProps> = ({ address, onClose }) => {
  const {
    selection,
    clipboard,
    copy,
    cut,
    paste,
    clearCells,
    insertRow,
    deleteRow,
    insertCol,
    deleteCol,
    setSelection,
  } = useSpreadsheetStore();

  const a1 = addressToA1(address).toUpperCase();

  const handleCopy = useCallback(() => {
    setSelection({ cell: address });
    copy();
    onClose();
  }, [address, copy, onClose, setSelection]);

  const handleCut = useCallback(() => {
    setSelection({ cell: address });
    cut();
    onClose();
  }, [address, cut, onClose, setSelection]);

  const handlePaste = useCallback(() => {
    paste(address);
    onClose();
  }, [address, paste, onClose]);

  const handleClearCell = useCallback(() => {
    clearCells([address]);
    onClose();
  }, [address, clearCells, onClose]);

  const handleInsertRowAbove = useCallback(() => {
    insertRow(address.row);
    onClose();
  }, [address.row, insertRow, onClose]);

  const handleDeleteRow = useCallback(() => {
    Alert.alert('Delete Row', `Delete row ${address.row + 1}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteRow(address.row); onClose(); } },
    ]);
  }, [address.row, deleteRow, onClose]);

  const handleInsertColLeft = useCallback(() => {
    insertCol(address.col);
    onClose();
  }, [address.col, insertCol, onClose]);

  const handleDeleteCol = useCallback(() => {
    Alert.alert('Delete Column', `Delete this column?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { deleteCol(address.col); onClose(); } },
    ]);
  }, [address.col, deleteCol, onClose]);

  return (
    <TouchableWithoutFeedback onPress={onClose}>
      <View style={styles.overlay}>
        <TouchableWithoutFeedback>
          <View style={styles.menu}>
            {/* Header */}
            <View style={styles.menuHeader}>
              <Text style={styles.menuHeaderText}>{a1}</Text>
            </View>

            <View style={styles.divider} />

            {/* Clipboard */}
            <MenuItem icon="📋" label="Copy" onPress={handleCopy} />
            <MenuItem icon="✂️" label="Cut" onPress={handleCut} />
            <MenuItem icon="📌" label="Paste" onPress={handlePaste} disabled={!clipboard} />
            <MenuItem icon="🗑️" label="Clear Cell" onPress={handleClearCell} destructive />

            <View style={styles.divider} />

            {/* Row Operations */}
            <MenuItem icon="⬆️" label="Insert Row Above" onPress={handleInsertRowAbove} />
            <MenuItem icon="🗑️" label="Delete Row" onPress={handleDeleteRow} destructive />

            <View style={styles.divider} />

            {/* Column Operations */}
            <MenuItem icon="⬅️" label="Insert Column Left" onPress={handleInsertColLeft} />
            <MenuItem icon="🗑️" label="Delete Column" onPress={handleDeleteCol} destructive />
          </View>
        </TouchableWithoutFeedback>
      </View>
    </TouchableWithoutFeedback>
  );
};

export default ContextMenu;

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  menu: {
    width: 240,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.2,
        shadowRadius: 16,
      },
      android: { elevation: 12 },
    }),
  },
  menuHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F8F9FA',
  },
  menuHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1A73E8',
    letterSpacing: 0.5,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  menuItemDisabled: {
    opacity: 0.4,
  },
  menuIcon: {
    fontSize: 16,
    width: 24,
    textAlign: 'center',
  },
  menuLabel: {
    fontSize: 14,
    color: '#202124',
    fontWeight: '400',
  },
  menuLabelDestructive: {
    color: '#D93025',
  },
  menuLabelDisabled: {
    color: '#9AA0A6',
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F3F4',
    marginHorizontal: 8,
  },
});
