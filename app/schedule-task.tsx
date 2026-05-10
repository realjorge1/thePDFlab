// ─────────────────────────────────────────────────────────────────────────────
// Schedule Task Screen — unified scheduling UI for all AI features
// Entry points: Quiz, Workspace AI, Generate Document
// Reads pending task data from AsyncStorage (stored by callers before navigating)
// ─────────────────────────────────────────────────────────────────────────────

import { AppHeaderContainer } from '@/components/AppHeaderContainer';
import { GradientView } from '@/components/GradientView';
import { colors } from '@/constants/theme';
import { useTheme } from '@/services/ThemeProvider';
import { addTask, newTaskId } from '@/services/scheduledTasks/store';
import type { RecurringInterval, ScheduledTask, ScheduledTaskPayload, ScheduledTaskType } from '@/services/scheduledTasks/types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  AlarmClock,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  RefreshCw,
} from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ── Constants ─────────────────────────────────────────────────────────────────

export const SCHEDULE_PENDING_KEY_PREFIX = '@schedule_pending_';

const QUICK_OPTIONS = [
  { label: 'Tomorrow',  sublabel: 'In 1 day',   days: 1  },
  { label: '3 Days',    sublabel: 'In 3 days',  days: 3  },
  { label: '1 Week',    sublabel: 'In 7 days',  days: 7  },
  { label: '2 Weeks',   sublabel: 'In 14 days', days: 14 },
  { label: '1 Month',   sublabel: 'In 30 days', days: 30 },
];

const RECURRING_OPTIONS: Array<{ label: string; sublabel: string; value: RecurringInterval }> = [
  { label: 'Daily',     sublabel: 'Every day',       value: 'daily'    },
  { label: 'Weekly',    sublabel: 'Once a week',      value: 'weekly'   },
  { label: 'Bi-weekly', sublabel: 'Every two weeks',  value: 'biweekly' },
  { label: 'Monthly',   sublabel: 'Once a month',     value: 'monthly'  },
];

const FEATURE_META: Record<ScheduledTaskType, { title: string; icon: string }> = {
  quiz:              { title: 'Schedule Quiz',     icon: '🎓' },
  workspace_ai:      { title: 'Defer AI Block',    icon: '🧠' },
  generate_document: { title: 'Schedule Document', icon: '📄' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function addDays(n: number) {
  return Date.now() + n * 24 * 60 * 60 * 1000;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Pending data shape stored by callers ──────────────────────────────────────

export interface PendingScheduleData {
  type: ScheduledTaskType;
  title: string;
  description?: string;
  payload: ScheduledTaskPayload;
}

// ── Screen ────────────────────────────────────────────────────────────────────

export default function ScheduleTaskScreen() {
  const router = useRouter();
  const { colors: t, mode } = useTheme();
  const isDark = mode === 'dark';

  const params = useLocalSearchParams<{
    pendingKey: string;
    taskType: string;
    taskTitle: string;
    allowRecurring?: string;
  }>();

  const taskType = (params.taskType ?? 'quiz') as ScheduledTaskType;
  const taskTitle = params.taskTitle ?? '';
  const allowRecurring = params.allowRecurring === 'true';
  const feature = FEATURE_META[taskType] ?? FEATURE_META.quiz;

  const [selectedDays, setSelectedDays] = useState(7);
  const [showCustom, setShowCustom] = useState(false);
  const [customDays, setCustomDays] = useState('');
  const [recurring, setRecurring] = useState<RecurringInterval | undefined>();
  const [showRecurring, setShowRecurring] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const effectiveDays = showCustom
    ? Math.max(1, Math.min(365, parseInt(customDays) || 1))
    : selectedDays;
  const scheduledFor = addDays(effectiveDays);

  const handleConfirm = useCallback(async () => {
    setSaving(true);
    try {
      const raw = await AsyncStorage.getItem(SCHEDULE_PENDING_KEY_PREFIX + params.pendingKey);
      if (!raw) return;
      const pending: PendingScheduleData = JSON.parse(raw);

      const task: ScheduledTask = {
        id: newTaskId(),
        type: pending.type,
        title: pending.title,
        description: pending.description,
        createdAt: Date.now(),
        scheduledFor,
        recurring: recurring ? { interval: recurring, runCount: 1 } : undefined,
        status: 'pending',
        seen: false,
        payload: pending.payload,
      };

      await addTask(task);
      await AsyncStorage.removeItem(SCHEDULE_PENDING_KEY_PREFIX + params.pendingKey);

      setDone(true);
      setTimeout(() => router.replace('/scheduled-tasks' as any), 650);
    } catch {
      setSaving(false);
    }
  }, [params.pendingKey, scheduledFor, recurring, router]);

  // ── Success state ─────────────────────────────────────────────────────────

  if (done) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: t.background }]}>
        <View style={styles.successWrap}>
          <View style={[styles.successIconWrap, { backgroundColor: '#10B98118' }]}>
            <CheckCircle2 size={40} color="#10B981" />
          </View>
          <Text style={[styles.successTitle, { color: t.text }]}>Task Scheduled!</Text>
          <Text style={[styles.successSub, { color: t.textSecondary }]}>
            Taking you to your scheduled tasks…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const cardBg = isDark ? '#1E293B' : '#FFFFFF';
  const borderColor = isDark ? '#334155' : '#E2E8F0';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: t.background }]}>
      {/* Header */}
      <AppHeaderContainer>
        <GradientView
          colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ChevronLeft size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerEmoji}>{feature.icon}</Text>
            <View>
              <Text style={styles.headerTitle}>{feature.title}</Text>
              {!!taskTitle && (
                <Text style={styles.headerSubtitle} numberOfLines={1}>{taskTitle}</Text>
              )}
            </View>
          </View>
          <View style={{ width: 40 }} />
        </GradientView>
      </AppHeaderContainer>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* When section */}
        <View style={[styles.section, { backgroundColor: cardBg, borderColor }]}>
          <View style={styles.sectionHeader}>
            <AlarmClock size={16} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: t.text }]}>Run this task in…</Text>
          </View>
          <View style={styles.chipGrid}>
            {QUICK_OPTIONS.map(opt => {
              const active = !showCustom && selectedDays === opt.days;
              return (
                <TouchableOpacity
                  key={opt.days}
                  style={[styles.chip, {
                    backgroundColor: active ? `${colors.primary}18` : (isDark ? '#0F172A' : '#F8FAFC'),
                    borderColor: active ? colors.primary : borderColor,
                    borderWidth: active ? 1.5 : 1,
                  }]}
                  onPress={() => { setSelectedDays(opt.days); setShowCustom(false); }}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.chipLabel, { color: active ? colors.primary : t.text }]}>{opt.label}</Text>
                  <Text style={[styles.chipSub, { color: active ? colors.primary : t.textSecondary }]}>{opt.sublabel}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.chip, {
                backgroundColor: showCustom ? `${colors.primary}18` : (isDark ? '#0F172A' : '#F8FAFC'),
                borderColor: showCustom ? colors.primary : borderColor,
                borderWidth: showCustom ? 1.5 : 1,
              }]}
              onPress={() => setShowCustom(true)}
              activeOpacity={0.75}
            >
              <Text style={[styles.chipLabel, { color: showCustom ? colors.primary : t.text }]}>Custom</Text>
              <Text style={[styles.chipSub, { color: showCustom ? colors.primary : t.textSecondary }]}>Pick exact days</Text>
            </TouchableOpacity>
          </View>

          {showCustom && (
            <View style={[styles.customRow, { borderTopColor: borderColor }]}>
              <Text style={[styles.customLabel, { color: t.textSecondary }]}>In</Text>
              <TextInput
                style={[styles.customInput, { borderColor: colors.primary, color: colors.primary }]}
                value={customDays}
                onChangeText={setCustomDays}
                keyboardType="number-pad"
                placeholder="14"
                placeholderTextColor="#94A3B8"
                maxLength={3}
              />
              <Text style={[styles.customLabel, { color: t.textSecondary }]}>days from now</Text>
            </View>
          )}
        </View>

        {/* Date preview */}
        <View style={[styles.datePreview, { backgroundColor: isDark ? '#1E1B4B' : '#EEF2FF' }]}>
          <Calendar size={16} color={colors.primary} />
          <Text style={[styles.datePreviewText, { color: isDark ? '#818CF8' : '#4338CA' }]}>
            Scheduled for{' '}
            <Text style={styles.datePreviewBold}>{formatDate(scheduledFor)}</Text>
          </Text>
        </View>

        {/* Recurring section */}
        {allowRecurring && (
          <View style={[styles.section, { backgroundColor: cardBg, borderColor }]}>
            <TouchableOpacity
              style={styles.recurringToggle}
              onPress={() => setShowRecurring(v => !v)}
              activeOpacity={0.8}
            >
              <View style={styles.recurringLeft}>
                <RefreshCw size={16} color={recurring ? colors.primary : t.textSecondary} />
                <View>
                  <Text style={[styles.sectionTitle, { color: recurring ? colors.primary : t.text }]}>
                    Repeat automatically
                  </Text>
                  <Text style={[styles.recurringHint, { color: t.textSecondary }]}>
                    {recurring
                      ? `Runs ${RECURRING_OPTIONS.find(r => r.value === recurring)?.sublabel?.toLowerCase() ?? recurring}`
                      : 'One-time task by default'}
                  </Text>
                </View>
              </View>
              <View style={[
                styles.togglePill,
                recurring ? { backgroundColor: colors.primary } : { backgroundColor: isDark ? '#334155' : '#E2E8F0' },
              ]}>
                <View style={[styles.toggleDot, recurring && styles.toggleDotOn]} />
              </View>
            </TouchableOpacity>

            {showRecurring && (
              <View style={[styles.chipGrid, { marginTop: 12 }]}>
                <TouchableOpacity
                  style={[styles.chip, {
                    backgroundColor: !recurring ? `${colors.primary}18` : (isDark ? '#0F172A' : '#F8FAFC'),
                    borderColor: !recurring ? colors.primary : borderColor,
                    borderWidth: !recurring ? 1.5 : 1,
                  }]}
                  onPress={() => setRecurring(undefined)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.chipLabel, { color: !recurring ? colors.primary : t.text }]}>None</Text>
                  <Text style={[styles.chipSub, { color: !recurring ? colors.primary : t.textSecondary }]}>One-time</Text>
                </TouchableOpacity>
                {RECURRING_OPTIONS.map(opt => {
                  const active = recurring === opt.value;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.chip, {
                        backgroundColor: active ? `${colors.primary}18` : (isDark ? '#0F172A' : '#F8FAFC'),
                        borderColor: active ? colors.primary : borderColor,
                        borderWidth: active ? 1.5 : 1,
                      }]}
                      onPress={() => setRecurring(opt.value)}
                      activeOpacity={0.75}
                    >
                      <Text style={[styles.chipLabel, { color: active ? colors.primary : t.text }]}>{opt.label}</Text>
                      <Text style={[styles.chipSub, { color: active ? colors.primary : t.textSecondary }]}>{opt.sublabel}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Info box */}
        <View style={[styles.infoBox, { backgroundColor: isDark ? '#1E293B' : '#F1F5F9' }]}>
          <Text style={[styles.infoText, { color: t.textSecondary }]}>
            {allowRecurring && recurring
              ? `Will run "${taskTitle}" ${RECURRING_OPTIONS.find(r => r.value === recurring)?.sublabel?.toLowerCase() ?? ''}, starting on ${formatDate(scheduledFor)}.`
              : `Will run this task on ${formatDate(scheduledFor)} and notify you when it's done.`}
          </Text>
        </View>
      </ScrollView>

      {/* Footer */}
      <View style={[styles.footer, { backgroundColor: cardBg, borderTopColor: borderColor }]}>
        <TouchableOpacity
          style={[styles.cancelBtn, { borderColor }]}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Text style={[styles.cancelText, { color: t.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmBtn, { opacity: saving ? 0.7 : 1 }]}
          onPress={handleConfirm}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <AlarmClock size={18} color="#fff" />}
          <Text style={styles.confirmText}>
            {allowRecurring && recurring ? 'Set Recurring Task' : 'Schedule Task'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  backBtn: { width: 40, alignItems: 'flex-start' },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  headerEmoji: { fontSize: 24 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },
  headerSubtitle: { fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 1 },

  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },

  section: {
    borderRadius: 16,
    borderWidth: 1,
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

  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexGrow: 1,
    flexBasis: '30%',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  chipLabel: { fontSize: 13, fontWeight: '600' },
  chipSub: { fontSize: 10, marginTop: 2 },

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
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 7,
    fontSize: 16,
    fontWeight: '700',
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
  recurringLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  recurringHint: { fontSize: 11, marginTop: 2 },
  togglePill: { width: 44, height: 24, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 3 },
  toggleDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' },
  toggleDotOn: { alignSelf: 'flex-end' },

  infoBox: { borderRadius: 12, padding: 14, marginTop: 4 },
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

  successWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  successIconWrap: { width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  successSub: { fontSize: 14, textAlign: 'center' },
});
