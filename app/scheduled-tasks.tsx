// ─────────────────────────────────────────────────────────────────────────────
// Scheduled Tasks Screen — full inbox of all tasks (pending + history)
// ─────────────────────────────────────────────────────────────────────────────

import { colors } from '@/constants/theme';
import { useTheme } from '@/services/ThemeProvider';
import {
  deleteTask,
  getCompletedTasks,
  getPendingTasks,
  loadAllTasks,
} from '@/services/scheduledTasks';
import type { ScheduledTask } from '@/services/scheduledTasks';
import { formatTimeAgo } from '@/services/scheduledTasks/messages';
import { useRouter } from 'expo-router';
import {
  AlarmClock,
  Brain,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileText,
  GraduationCap,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GradientView } from '@/components/GradientView';
import { AppHeaderContainer } from '@/components/AppHeaderContainer';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  quiz: { Icon: GraduationCap, color: '#7C3AED', label: 'Quiz' },
  workspace_ai: { Icon: Brain, color: '#0F766E', label: 'AI Block' },
  generate_document: { Icon: FileText, color: '#1E40AF', label: 'Document' },
};

const STATUS_CONFIG = {
  pending: { color: '#F59E0B', label: 'Scheduled', Icon: Clock },
  running: { color: '#3B82F6', label: 'Running…', Icon: RefreshCw },
  completed: { color: '#10B981', label: 'Completed', Icon: CheckCircle2 },
  failed: { color: '#EF4444', label: 'Failed', Icon: XCircle },
};

function formatScheduledFor(ms: number): string {
  const diff = ms - Date.now();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days < 0) return 'Past due';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  if (days < 14) return 'In 1 week';
  if (days < 30) return `In ${Math.floor(days / 7)} weeks`;
  return `In ${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? 's' : ''}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// ── Task Card ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onDelete,
}: {
  task: ScheduledTask;
  onDelete: (id: string) => void;
}) {
  const { colors: t, mode } = useTheme();
  const typeCfg = TYPE_CONFIG[task.type];
  const statusCfg = STATUS_CONFIG[task.status];
  const TypeIcon = typeCfg.Icon;
  const StatusIcon = statusCfg.Icon;

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Remove Task',
      task.status === 'pending'
        ? 'Cancel this scheduled task? This cannot be undone.'
        : 'Remove this task from history?',
      [
        { text: 'Keep', style: 'cancel' },
        { text: task.status === 'pending' ? 'Cancel Task' : 'Remove', style: 'destructive', onPress: () => onDelete(task.id) },
      ],
    );
  }, [task.id, task.status, onDelete]);

  return (
    <View style={[
      taskStyles.card,
      {
        backgroundColor: mode === 'dark' ? '#1E293B' : '#FFFFFF',
        borderColor: mode === 'dark' ? '#334155' : '#F1F5F9',
      },
    ]}>
      {/* Type icon */}
      <View style={[taskStyles.typeIcon, { backgroundColor: typeCfg.color + '18' }]}>
        <TypeIcon size={20} color={typeCfg.color} />
      </View>

      {/* Content */}
      <View style={taskStyles.content}>
        <View style={taskStyles.titleRow}>
          <Text style={[taskStyles.title, { color: t.text }]} numberOfLines={1}>{task.title}</Text>
          {task.recurring && (
            <View style={[taskStyles.recurBadge, { backgroundColor: typeCfg.color + '18' }]}>
              <RefreshCw size={9} color={typeCfg.color} />
              <Text style={[taskStyles.recurText, { color: typeCfg.color }]}>
                {task.recurring.interval}
              </Text>
            </View>
          )}
        </View>

        <View style={taskStyles.metaRow}>
          <Text style={[taskStyles.typeLabel, { color: typeCfg.color }]}>{typeCfg.label}</Text>
          <Text style={taskStyles.dot}>·</Text>
          {task.status === 'pending' ? (
            <Text style={[taskStyles.metaText, { color: t.textSecondary }]}>{formatScheduledFor(task.scheduledFor)} · {formatDate(task.scheduledFor)}</Text>
          ) : task.status === 'completed' ? (
            <Text style={[taskStyles.metaText, { color: t.textSecondary }]}>Done {formatTimeAgo(task.completedAt ?? task.createdAt)}</Text>
          ) : (
            <Text style={[taskStyles.metaText, { color: t.textSecondary }]}>Created {formatTimeAgo(task.createdAt)}</Text>
          )}
        </View>

        {/* Status badge */}
        <View style={taskStyles.statusRow}>
          <View style={[taskStyles.statusBadge, { backgroundColor: statusCfg.color + '18' }]}>
            <StatusIcon size={10} color={statusCfg.color} />
            <Text style={[taskStyles.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
          </View>
        </View>

        {/* Return message preview for completed tasks */}
        {task.status === 'completed' && task.returnMessage && (
          <Text style={[taskStyles.preview, { color: t.textSecondary }]} numberOfLines={2}>{task.returnMessage}</Text>
        )}

        {/* Error message for failed tasks */}
        {task.status === 'failed' && task.error && (
          <Text style={taskStyles.errorText} numberOfLines={2}>{task.error}</Text>
        )}
      </View>

      {/* Delete */}
      <TouchableOpacity onPress={handleDelete} style={taskStyles.deleteBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Trash2 size={16} color="#94A3B8" />
      </TouchableOpacity>
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function ScheduledTasksScreen() {
  const router = useRouter();
  const { colors: t, mode } = useTheme();
  const [pendingTasks, setPendingTasks] = useState<ScheduledTask[]>([]);
  const [completedTasks, setCompletedTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pending, completed] = await Promise.all([getPendingTasks(), getCompletedTasks()]);
      setPendingTasks(pending.sort((a, b) => a.scheduledFor - b.scheduledFor));
      setCompletedTasks(completed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteTask(id);
    load();
  }, [load]);

  const totalCount = pendingTasks.length + completedTasks.length;

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
            <AlarmClock size={22} color="#fff" />
            <Text style={styles.headerTitle}>Scheduled Tasks</Text>
          </View>
          <View style={{ width: 40 }} />
        </GradientView>
      </AppHeaderContainer>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {totalCount === 0 && !loading && (
          <View style={styles.empty}>
            <View style={[styles.emptyIconWrap, { backgroundColor: mode === 'dark' ? '#1E293B' : '#EFF6FF' }]}>
              <AlarmClock size={34} color={colors.primary} />
            </View>
            <Text style={[styles.emptyTitle, { color: t.text }]}>No tasks scheduled</Text>
            <Text style={[styles.emptySubtitle, { color: t.textSecondary }]}>
              Schedule quizzes, AI tasks, and documents to run automatically — we'll notify you when they're done.
            </Text>
            <View style={styles.emptyChips}>
              {(['🎓 Quizzes', '🧠 AI Tasks', '📄 Documents'] as const).map((label) => (
                <View
                  key={label}
                  style={[styles.emptyChip, {
                    backgroundColor: mode === 'dark' ? '#1E293B' : '#F8FAFC',
                    borderColor: mode === 'dark' ? '#334155' : '#E2E8F0',
                  }]}
                >
                  <Text style={[styles.emptyChipText, { color: t.textSecondary }]}>{label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Pending */}
        {pendingTasks.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIconWrap, { backgroundColor: colors.primary + '18' }]}>
                <Clock size={12} color={colors.primary} />
              </View>
              <Text style={[styles.sectionTitle, { color: t.text }]}>Upcoming</Text>
              <View style={[styles.sectionCountBadge, { backgroundColor: colors.primary + '18' }]}>
                <Text style={[styles.sectionCountText, { color: colors.primary }]}>{pendingTasks.length}</Text>
              </View>
            </View>
            {pendingTasks.map(t => (
              <TaskCard key={t.id} task={t} onDelete={handleDelete} />
            ))}
          </View>
        )}

        {/* Completed */}
        {completedTasks.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIconWrap, { backgroundColor: '#10B98118' }]}>
                <CheckCircle2 size={12} color="#10B981" />
              </View>
              <Text style={[styles.sectionTitle, { color: t.text }]}>History</Text>
              <View style={[styles.sectionCountBadge, { backgroundColor: '#10B98118' }]}>
                <Text style={[styles.sectionCountText, { color: '#10B981' }]}>{completedTasks.length}</Text>
              </View>
            </View>
            {completedTasks.map(t => (
              <TaskCard key={t.id} task={t} onDelete={handleDelete} />
            ))}
          </View>
        )}
      </ScrollView>
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
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#fff', letterSpacing: -0.3 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 14, paddingTop: 20, paddingBottom: 48 },

  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, paddingHorizontal: 2 },
  sectionIconWrap: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flex: 1, fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  sectionCountBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10 },
  sectionCountText: { fontSize: 11, fontWeight: '700' },

  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32, gap: 14 },
  emptyIconWrap: { width: 72, height: 72, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center', letterSpacing: -0.3 },
  emptySubtitle: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
  emptyChips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 },
  emptyChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  emptyChipText: { fontSize: 12, fontWeight: '600' },
});

const taskStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
  },
  typeIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  content: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  title: { flex: 1, fontSize: 14.5, fontWeight: '700', letterSpacing: -0.2 },
  recurBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  recurText: { fontSize: 9, fontWeight: '700', textTransform: 'capitalize' },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  typeLabel: { fontSize: 11, fontWeight: '700' },
  dot: { color: '#CBD5E1', fontSize: 11 },
  metaText: { fontSize: 11, flex: 1 },

  statusRow: { flexDirection: 'row', marginBottom: 4 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 10, fontWeight: '700' },

  preview: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  errorText: { fontSize: 12, color: '#EF4444', lineHeight: 18, marginTop: 4 },

  deleteBtn: { padding: 4, paddingTop: 2 },
});
