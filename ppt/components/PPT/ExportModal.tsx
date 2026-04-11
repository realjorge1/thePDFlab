// ─────────────────────────────────────────────
//  PPT Module — ExportModal Component
//  Bottom sheet: export progress, result, share.
// ─────────────────────────────────────────────

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { ExportStatus } from '../../hooks/useExportPPT';

interface ExportModalProps {
  visible: boolean;
  status: ExportStatus;
  progress: number;
  filePath?: string;
  error?: string;
  accentColor: string;
  onShare: () => void;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  visible,
  status,
  progress,
  filePath,
  error,
  accentColor,
  onShare,
  onClose,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {status === 'generating' && (
            <View style={styles.section}>
              <ActivityIndicator size="large" color={accentColor} />
              <Text style={styles.headingText}>Building your presentation…</Text>
              <Text style={styles.subText}>Applying theme and generating slides</Text>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${progress}%`, backgroundColor: accentColor },
                  ]}
                />
              </View>
              <Text style={[styles.progressText, { color: accentColor }]}>
                {Math.round(progress)}%
              </Text>
            </View>
          )}

          {status === 'success' && (
            <View style={styles.section}>
              <View style={[styles.iconCircle, { backgroundColor: accentColor + '18' }]}>
                <Text style={styles.iconText}>✅</Text>
              </View>
              <Text style={styles.headingText}>PPTX Ready!</Text>
              <Text style={styles.subText} numberOfLines={2}>
                {filePath?.split('/').pop()}
              </Text>

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: accentColor }]}
                onPress={onShare}
                activeOpacity={0.85}
              >
                <Text style={styles.primaryBtnText}>
                  {Platform.OS === 'ios' ? '↑ Share / AirDrop' : '↑ Share / Save'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.secondaryBtn} onPress={onClose}>
                <Text style={styles.secondaryBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}

          {status === 'error' && (
            <View style={styles.section}>
              <View style={[styles.iconCircle, { backgroundColor: '#FEE2E2' }]}>
                <Text style={styles.iconText}>❌</Text>
              </View>
              <Text style={styles.headingText}>Export Failed</Text>
              <Text style={styles.errorText}>{error ?? 'Unknown error occurred.'}</Text>
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: '#EF4444' }]}
                onPress={onClose}
              >
                <Text style={styles.primaryBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 40,
    paddingHorizontal: 24,
    paddingTop: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 12,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
    marginBottom: 24,
  },
  section: { alignItems: 'center' },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconText: { fontSize: 32 },
  headingText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
    textAlign: 'center',
  },
  subText: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
    paddingHorizontal: 16,
  },
  errorText: {
    fontSize: 13,
    color: '#EF4444',
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 16,
  },
  progressBar: {
    width: '100%',
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    width: '100%',
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
  },
  secondaryBtnText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '600',
  },
});
