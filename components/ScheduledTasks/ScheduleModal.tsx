// ─────────────────────────────────────────────────────────────────────────────
// ScheduleModal
// Lets the user pick WHEN a task should run (and optionally how often).
// ─────────────────────────────────────────────────────────────────────────────

import { colors } from '@/constants/theme';
import { GradientView } from '@/components/GradientView';
import { useTheme } from '@/services/ThemeProvider';
import React, { useCallback, useState } from 'react';
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AlarmClock,
  Calendar,
  ChevronLeft,
  RefreshCw,
  X,
} from 'lucide-react-native';
import type { RecurringInterval, ScheduledTaskType } from '@/services/scheduledTasks/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScheduleOptions {
  scheduledFor: number;      // unix ms
  recurring?: RecurringInterval;
}

interface QuickOption {
  label: string;
  sublabel: string;
  days: number;
}

const QUICK_OPTIONS: QuickOption[] = [
  { label: 'Tomorrow',   sublabel: 'In 1 day',   days: 1  },
  { label: '3 Days',     sublabel: 'In 3 days',  days: 3  },
  { label: '1 Week',     sublabel: 'In 7 days',  days: 7  },
  { label: '2 Weeks',    sublabel: 'In 14 days', days: 14 },
  { label: '1 Month',    sublabel: 'In 30 days', days: 30 },
];

const RECURRING_OPTIONS: Array<{ label: string; sublabel: string; value: RecurringInterval }> = [
  { label: 'Daily',      sublabel: 'Every day',        value: 'daily'    },
  { label: 'Weekly',     sublabel: 'Once a week',       value: 'weekly'   },
  { label: 'Bi-weekly',  sublabel: 'Every two weeks',   value: 'biweekly' },
  { label: 'Monthly',    sublabel: 'Once a month',      value: 'monthly'  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(days: number): number {
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

const FEATURE_LABELS: Record<ScheduledTaskType, { title: string; icon: string }> = {
  quiz: { title: 'Schedule Quiz', icon: '🎓' },
  workspace_ai: { title: 'Defer AI Block', icon: '🧠' },
  generate_document: { title: 'Schedule Document', icon: '📄' },
};

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  taskType: ScheduledTaskType;
  taskTitle: string;
  allowRecurring?: boolean;
  onConfirm: (opts: ScheduleOptions) => void;
  onClose: () => void;
}

export function ScheduleModal({
  visible,
  taskType,
  taskTitle,
  allowRecurring = false,
  onConfirm,
  onClose,
}: Props) {
  const { colors: t, mode } = useTheme();
  const [selectedDays, setSelectedDays] = useState<number>(7);
  const [customDays, setCustomDays] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [recurring, setRecurring] = useState<RecurringInterval | undefined>();
  const [showRecurring, setShowRecurring] = useState(false);

  const effectiveDays = showCustom
    ? Math.max(1, Math.min(365, parseInt(customDays) || 1))
    : selectedDays;

  const scheduledFor = addDays(effectiveDays);

  const handleConfirm = useCallback(() => {
    onConfirm({ scheduledFor, recurring });
    // Reset state
    setSelectedDays(7);
    setCustomDays('');
    setShowCustom(false);
    setRecurring(undefined);
    setShowRecurring(false);
  }, [scheduledFor, recurring, onConfirm]);

  const feature = FEATURE_LABELS[taskType];

  const isDark = mode === 'dark';
  const bg = isDark ? '#0F172A' : '#F8FAFC';
  const cardBg = isDark ? '#1E293B' : '#FFFFFF';
  const borderColor = isDark ? '#334155' : '#E2E8F0';
  const textPrimary = isDark ? '#F1F5F9' : '#0F172A';
  const textSecondary = isDark ? '#94A3B8' : '#64748B';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={[styles.root, { backgroundColor: bg }]}>
        {/* Header */}
        <GradientView
          colors={[colors.gradientStart, colors.gradientMid]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.header}
        >
          <TouchableOpacity onPress={onClose} style={styles.headerBack}>
            <ChevronLeft size={22} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerEmoji}>{feature.icon}</Text>
            <Text style={styles.headerTitle}>{feature.title}</Text>
            <Text style={styles.headerSubtitle} numberOfLines={1}>{taskTitle}</Text>
          </View>
          <View style={{ width: 40 }} />
        </GradientView>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

          {/* When section */}
          <View style={[styles.section, { backgroundColor: cardBg, borderColor, borderWidth: 1 }]}>
            <View style={styles.sectionHeader}>
              <AlarmClock size={16} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: textPrimary }]}>Run this task in…</Text>
            </View>

            <View style={styles.chipGrid}>
              {QUICK_OPTIONS.map(opt => {
                const active = !showCustom && selectedDays === opt.days;
                return (
                  <TouchableOpacity
                    key={opt.days}
                    style={[styles.chip, { backgroundColor: active ? '#EEF2FF' : isDark ? '#0F172A' : '#F8FAFC', borderColor: active ? colors.primary : borderColor }]}
                    onPress={() => { setSelectedDays(opt.days); setShowCustom(false); }}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.chipLabel, { color: active ? colors.primary : textPrimary }]}>{opt.label}</Text>
                    <Text style={[styles.chipSub, { color: active ? colors.primaryLight : textSecondary }]}>{opt.sublabel}</Text>
                  </TouchableOpacity>
                );
              })}

              {/* Custom chip */}
              <TouchableOpacity
                style={[styles.chip, { backgroundColor: showCustom ? '#EEF2FF' : isDark ? '#0F172A' : '#F8FAFC', borderColor: showCustom ? colors.primary : borderColor }]}
                onPress={() => setShowCustom(true)}
                activeOpacity={0.75}
              >
                <Text style={[styles.chipLabel, { color: showCustom ? colors.primary : textPrimary }]}>Custom</Text>
                <Text style={[styles.chipSub, { color: showCustom ? colors.primaryLight : textSecondary }]}>Pick exact days</Text>
              </TouchableOpacity>
            </View>

            {showCustom && (
              <View style={[styles.customRow, { borderTopColor: borderColor }]}>
                <Text style={[styles.customLabel, { color: textSecondary }]}>In</Text>
                <TextInput
                  style={[styles.customInput, { borderColor: colors.primary, color: colors.primary }]}
                  value={customDays}
                  onChangeText={setCustomDays}
                  keyboardType="number-pad"
                  placeholder="14"
                  placeholderTextColor="#94A3B8"
                  maxLength={3}
                />
                <Text style={[styles.customLabel, { color: textSecondary }]}>days from now</Text>
              </View>
            )}
          </View>

          {/* Scheduled date preview */}
          <View style={[styles.datePreview, { backgroundColor: isDark ? '#1E1B4B' : '#EEF2FF' }]}>
            <Calendar size={16} color={colors.primary} />
            <Text style={[styles.datePreviewText, { color: isDark ? '#818CF8' : '#4338CA' }]}>
              Scheduled for <Text style={styles.datePreviewBold}>{formatDate(scheduledFor)}</Text>
            </Text>
          </View>

          {/* Recurring section (only for generate_document) */}
          {allowRecurring && (
            <View style={[styles.section, { backgroundColor: cardBg, borderColor, borderWidth: 1 }]}>
              <TouchableOpacity
                style={styles.recurringToggle}
                onPress={() => setShowRecurring(v => !v)}
                activeOpacity={0.8}
              >
                <View style={styles.recurringToggleLeft}>
                  <RefreshCw size={16} color={recurring ? colors.primary : textSecondary} />
                  <View>
                    <Text style={[styles.sectionTitle, { color: recurring ? colors.primary : textPrimary }]}>
                      Repeat automatically
                    </Text>
                    <Text style={[styles.recurringHint, { color: textSecondary }]}>
                      {recurring
                        ? `Runs ${RECURRING_OPTIONS.find(r => r.value === recurring)?.sublabel?.toLowerCase() ?? recurring}`
                        : 'One-time task by default'}
                    </Text>
                  </View>
                </View>
                <View style={[styles.togglePill, recurring && styles.togglePillOn, !recurring && { backgroundColor: isDark ? '#334155' : '#E2E8F0' }]}>
                  <View style={[styles.toggleDot, recurring && styles.toggleDotOn]} />
                </View>
              </TouchableOpacity>

              {showRecurring && (
                <View style={styles.chipGrid}>
                  {/* None option */}
                  <TouchableOpacity
                    style={[styles.chip, { backgroundColor: !recurring ? '#EEF2FF' : isDark ? '#0F172A' : '#F8FAFC', borderColor: !recurring ? colors.primary : borderColor }]}
                    onPress={() => setRecurring(undefined)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.chipLabel, { color: !recurring ? colors.primary : textPrimary }]}>None</Text>
                    <Text style={[styles.chipSub, { color: !recurring ? colors.primaryLight : textSecondary }]}>One-time</Text>
                  </TouchableOpacity>
                  {RECURRING_OPTIONS.map(opt => {
                    const active = recurring === opt.value;
                    return (
                      <TouchableOpacity
                        key={opt.value}
                        style={[styles.chip, { backgroundColor: active ? '#EEF2FF' : isDark ? '#0F172A' : '#F8FAFC', borderColor: active ? colors.primary : borderColor }]}
                        onPress={() => setRecurring(opt.value)}
                        activeOpacity={0.75}
                      >
                        <Text style={[styles.chipLabel, { color: active ? colors.primary : textPrimary }]}>{opt.label}</Text>
                        <Text style={[styles.chipSub, { color: active ? colors.primaryLight : textSecondary }]}>{opt.sublabel}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {/* Description */}
          <View style={[styles.infoBox, { backgroundColor: isDark ? '#1E293B' : '#F1F5F9' }]}>
            <Text style={[styles.infoText, { color: textSecondary }]}>
              {allowRecurring && recurring
                ? `inScribed will generate "${taskTitle}" ${RECURRING_OPTIONS.find(r => r.value === recurring)?.sublabel?.toLowerCase() ?? ''}, starting on ${formatDate(scheduledFor)}.`
                : `inScribed will run this task on ${formatDate(scheduledFor)} and let you know when it's done.`}
            </Text>
          </View>
        </ScrollView>

        {/* Confirm */}
        <View style={[styles.footer, { backgroundColor: cardBg, borderTopColor: borderColor }]}>
          <TouchableOpacity style={[styles.cancelBtn, { borderColor }]} onPress={onClose} activeOpacity={0.8}>
            <Text style={[styles.cancelText, { color: textSecondary }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirm} activeOpacity={0.85}>
            <AlarmClock size={18} color="#fff" />
            <Text style={styles.confirmText}>
              {allowRecurring && recurring ? 'Set Recurring Task' : 'Schedule Task'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 16,
    gap: 8,
  },
  headerBack: { width: 40, alignItems: 'flex-start' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerEmoji: { fontSize: 28, marginBottom: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  headerSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 2 },

  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },

  section: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  sectionTitle: { fontSize: 14, fontWeight: '600' },

  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    minWidth: 88,
  },
  chipActive: {},
  chipLabel: { fontSize: 13, fontWeight: '600' },
  chipLabelActive: {},
  chipSub: { fontSize: 10, marginTop: 2 },
  chipSubActive: {},

  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
  },
  customLabel: { fontSize: 14, fontWeight: '500' },
  customInput: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 7,
    fontSize: 16,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
  },

  datePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  datePreviewText: { fontSize: 14 },
  datePreviewBold: { fontWeight: '700' },

  recurringToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  recurringToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  recurringHint: { fontSize: 11, marginTop: 2 },
  togglePill: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  togglePillOn: { backgroundColor: colors.primary },
  toggleDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
  },
  toggleDotOn: { alignSelf: 'flex-end' },

  infoBox: {
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
  },
  infoText: { fontSize: 13, lineHeight: 20 },

  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 8 : 16,
    borderTopWidth: 1,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  cancelText: { fontSize: 15, fontWeight: '600' },
  confirmBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  confirmText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
