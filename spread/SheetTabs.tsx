// ============================================================
// components/spreadsheet/SheetTabs.tsx
// Bottom tab bar for managing multiple sheets
// ============================================================

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  TextInput,
  Modal,
  Platform,
} from 'react-native';
import { useSpreadsheetStore } from '../../store/spreadsheetStore';

// ── Component ─────────────────────────────────────────────

const SheetTabs: React.FC = () => {
  const {
    sheets,
    activeSheetIndex,
    setActiveSheet,
    addSheet,
    removeSheet,
    renameSheet,
  } = useSpreadsheetStore();

  const [renameModal, setRenameModal] = useState<{ index: number; name: string } | null>(null);

  const handleTabLongPress = useCallback((index: number) => {
    Alert.alert(
      `Sheet: "${sheets[index].name}"`,
      'Choose an action',
      [
        {
          text: 'Rename',
          onPress: () => setRenameModal({ index, name: sheets[index].name }),
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            if (sheets.length <= 1) {
              Alert.alert('Cannot delete', 'There must be at least one sheet.');
              return;
            }
            Alert.alert(
              'Delete Sheet',
              `Are you sure you want to delete "${sheets[index].name}"?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => removeSheet(index) },
              ],
            );
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [sheets, removeSheet]);

  const handleRenameConfirm = useCallback(() => {
    if (!renameModal) return;
    const trimmed = renameModal.name.trim();
    if (!trimmed) {
      Alert.alert('Invalid name', 'Sheet name cannot be empty.');
      return;
    }
    renameSheet(renameModal.index, trimmed);
    setRenameModal(null);
  }, [renameModal, renameSheet]);

  return (
    <>
      <View style={styles.container}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
          bounces={false}
        >
          {sheets.map((sheet, index) => (
            <TouchableOpacity
              key={sheet.id}
              style={[styles.tab, index === activeSheetIndex && styles.tabActive]}
              onPress={() => setActiveSheet(index)}
              onLongPress={() => handleTabLongPress(index)}
              delayLongPress={500}
            >
              <Text
                style={[
                  styles.tabText,
                  index === activeSheetIndex && styles.tabTextActive,
                ]}
                numberOfLines={1}
              >
                {sheet.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Add Sheet Button */}
        <TouchableOpacity style={styles.addBtn} onPress={() => addSheet()}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Rename Modal */}
      <Modal
        visible={!!renameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameModal(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Rename Sheet</Text>
            <TextInput
              style={styles.modalInput}
              value={renameModal?.name ?? ''}
              onChangeText={(text) =>
                setRenameModal(prev => prev ? { ...prev, name: text } : null)
              }
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={handleRenameConfirm}
              maxLength={31}
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalCancel]}
                onPress={() => setRenameModal(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalConfirm]}
                onPress={handleRenameConfirm}
              >
                <Text style={styles.modalConfirmText}>Rename</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

export default React.memo(SheetTabs);

// ── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    backgroundColor: '#F8F9FA',
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  tabs: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingLeft: 8,
  },
  tab: {
    paddingHorizontal: 14,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: '#E0E0E0',
    maxWidth: 120,
  },
  tabActive: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 2,
    borderTopColor: '#1A73E8',
  },
  tabText: {
    fontSize: 12,
    color: '#5F6368',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#1A73E8',
    fontWeight: '700',
  },
  addBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#E0E0E0',
  },
  addBtnText: {
    fontSize: 20,
    color: '#5F6368',
    lineHeight: 22,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    width: 280,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
    }),
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#202124',
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#DADCE0',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#202124',
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  modalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  modalCancel: {
    borderWidth: 1,
    borderColor: '#DADCE0',
  },
  modalConfirm: {
    backgroundColor: '#1A73E8',
  },
  modalCancelText: {
    fontSize: 14,
    color: '#5F6368',
    fontWeight: '500',
  },
  modalConfirmText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
