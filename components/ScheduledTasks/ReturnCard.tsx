// ─────────────────────────────────────────────────────────────────────────────
// ReturnCard
// The "comeback" card shown when a scheduled task completes.
// This is the centrepiece of the whole feature — it needs to feel human.
// ─────────────────────────────────────────────────────────────────────────────

import { colors } from '@/constants/theme';
import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  BookOpen,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  GraduationCap,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react-native';
import type { ScheduledTask } from '@/services/scheduledTasks/types';
import { formatTimeAgo } from '@/services/scheduledTasks/messages';

// ── Icon mapping ──────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  quiz: {
    Icon: GraduationCap,
    gradient: ['#7C3AED', '#A855F7'],
    label: 'Quiz Ready',
    accentColor: '#7C3AED',
  },
  workspace_ai: {
    Icon: Brain,
    gradient: ['#0F766E', '#14B8A6'],
    label: 'AI Response',
    accentColor: '#0F766E',
  },
  generate_document: {
    Icon: FileText,
    gradient: ['#1E40AF', '#3B82F6'],
    label: 'Document Ready',
    accentColor: '#1E40AF',
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCompletedAt(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ReturnCardAction {
  label: string;
  icon: React.ComponentType<any>;
  onPress: () => void;
  primary?: boolean;
}

interface ReturnCardProps {
  task: ScheduledTask;
  onDismiss: (id: string) => void;
  onViewResult?: (task: ScheduledTask) => void;
  actions?: ReturnCardAction[];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReturnCard({ task, onDismiss, onViewResult, actions }: ReturnCardProps) {
  const slideAnim = useRef(new Animated.Value(60)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        damping: 22,
        stiffness: 280,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleDismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -40,
        duration: 240,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 240,
        useNativeDriver: true,
      }),
    ]).start(() => onDismiss(task.id));
  }, [task.id, onDismiss, slideAnim, fadeAnim]);

  const cfg = TYPE_CONFIG[task.type];
  const Icon = cfg.Icon;
  const message = task.returnMessage ?? 'Your task is complete.';
  const timeAgo = formatTimeAgo(task.createdAt);
  const completedAtStr = task.completedAt ? formatCompletedAt(task.completedAt) : '';

  return (
    <Animated.View
      style={[
        styles.card,
        { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
      ]}
    >
      {/* Top bar with icon + dismiss */}
      <View style={[styles.topBar, { backgroundColor: cfg.accentColor + '14' }]}>
        <View style={[styles.iconCircle, { backgroundColor: cfg.accentColor }]}>
          <Icon size={18} color="#fff" />
        </View>
        <View style={styles.topBarCenter}>
          <View style={styles.tagRow}>
            <Text style={[styles.typeTag, { color: cfg.accentColor }]}>{cfg.label}</Text>
            {task.recurring && (
              <View style={[styles.recurBadge, { backgroundColor: cfg.accentColor + '20' }]}>
                <RefreshCw size={9} color={cfg.accentColor} />
                <Text style={[styles.recurBadgeText, { color: cfg.accentColor }]}>Recurring</Text>
              </View>
            )}
          </View>
          <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
        </View>
        <TouchableOpacity onPress={handleDismiss} style={styles.dismissBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <X size={18} color="#94A3B8" />
        </TouchableOpacity>
      </View>

      {/* The human message */}
      <View style={styles.messageBox}>
        <Text style={styles.messageText}>{message}</Text>
      </View>

      {/* Metadata */}
      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Clock size={11} color="#94A3B8" />
          <Text style={styles.metaText}>Scheduled {timeAgo}</Text>
        </View>
        {completedAtStr ? (
          <View style={styles.metaItem}>
            <CheckCircle2 size={11} color="#10B981" />
            <Text style={[styles.metaText, { color: '#10B981' }]}>Done {completedAtStr}</Text>
          </View>
        ) : null}
      </View>

      {/* Actions */}
      {actions && actions.length > 0 && (
        <View style={styles.actionsRow}>
          {actions.map((action, idx) => {
            const ActionIcon = action.icon;
            return (
              <TouchableOpacity
                key={idx}
                style={[
                  styles.actionBtn,
                  action.primary
                    ? [styles.actionBtnPrimary, { backgroundColor: cfg.accentColor }]
                    : styles.actionBtnSecondary,
                ]}
                onPress={action.onPress}
                activeOpacity={0.8}
              >
                <ActionIcon size={14} color={action.primary ? '#fff' : cfg.accentColor} />
                <Text
                  style={[
                    styles.actionBtnText,
                    action.primary ? styles.actionBtnTextPrimary : { color: cfg.accentColor },
                  ]}
                >
                  {action.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Fallback tap target if no explicit actions */}
      {(!actions || actions.length === 0) && onViewResult && (
        <TouchableOpacity style={[styles.viewResultBtn, { borderColor: cfg.accentColor + '40' }]} onPress={() => onViewResult(task)} activeOpacity={0.8}>
          <Text style={[styles.viewResultText, { color: cfg.accentColor }]}>View Result</Text>
          <ChevronRight size={14} color={cfg.accentColor} />
        </TouchableOpacity>
      )}
    </Animated.View>
  );
}

// ── Full-screen overlay that shows all unseen cards ───────────────────────────

interface ReturnCardOverlayProps {
  tasks: ScheduledTask[];
  onDismiss: (id: string) => void;
  onQuizResult?: (task: ScheduledTask) => void;
  onDocumentResult?: (task: ScheduledTask) => void;
  onWorkspaceResult?: (task: ScheduledTask) => void;
}

export function ReturnCardOverlay({
  tasks,
  onDismiss,
  onQuizResult,
  onDocumentResult,
  onWorkspaceResult,
}: ReturnCardOverlayProps) {
  if (tasks.length === 0) return null;

  return (
    <View style={overlayStyles.container} pointerEvents="box-none">
      <ScrollView
        style={overlayStyles.scroll}
        contentContainerStyle={overlayStyles.scrollContent}
        showsVerticalScrollIndicator={false}
        pointerEvents="box-none"
      >
        {tasks.map(task => {
          const actions = buildActions(task, onDismiss, onQuizResult, onDocumentResult, onWorkspaceResult);
          return (
            <ReturnCard
              key={task.id}
              task={task}
              onDismiss={onDismiss}
              actions={actions}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

function buildActions(
  task: ScheduledTask,
  onDismiss: (id: string) => void,
  onQuizResult?: (task: ScheduledTask) => void,
  onDocumentResult?: (task: ScheduledTask) => void,
  onWorkspaceResult?: (task: ScheduledTask) => void,
): ReturnCardAction[] {
  if (task.status === 'failed') {
    return [
      { label: 'Dismiss', icon: X, primary: false, onPress: () => onDismiss(task.id) },
    ];
  }

  switch (task.type) {
    case 'quiz':
      return [
        {
          label: 'Take Quiz',
          icon: GraduationCap,
          primary: true,
          onPress: () => { onQuizResult?.(task); onDismiss(task.id); },
        },
        {
          label: 'Later',
          icon: Clock,
          primary: false,
          onPress: () => onDismiss(task.id),
        },
      ];
    case 'generate_document':
      return [
        {
          label: 'Review & Save',
          icon: BookOpen,
          primary: true,
          onPress: () => { onDocumentResult?.(task); onDismiss(task.id); },
        },
        {
          label: 'Dismiss',
          icon: X,
          primary: false,
          onPress: () => onDismiss(task.id),
        },
      ];
    case 'workspace_ai':
      return [
        {
          label: 'View Response',
          icon: Brain,
          primary: true,
          onPress: () => { onWorkspaceResult?.(task); onDismiss(task.id); },
        },
        {
          label: 'Dismiss',
          icon: X,
          primary: false,
          onPress: () => onDismiss(task.id),
        },
      ];
    default:
      return [{ label: 'Dismiss', icon: X, primary: false, onPress: () => onDismiss(task.id) }];
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarCenter: { flex: 1 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  typeTag: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  recurBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  recurBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },
  taskTitle: { fontSize: 13, fontWeight: '600', color: '#334155' },
  dismissBtn: { padding: 4 },

  messageBox: {
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#334155',
    fontWeight: '400',
  },

  metaRow: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, color: '#94A3B8' },

  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
  },
  actionBtnPrimary: {},
  actionBtnSecondary: {
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  actionBtnText: { fontSize: 13, fontWeight: '600' },
  actionBtnTextPrimary: { color: '#fff' },

  viewResultBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginHorizontal: 14,
    marginBottom: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  viewResultText: { fontSize: 13, fontWeight: '600' },
});

const overlayStyles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    maxHeight: '65%',
    zIndex: 1000,
  },
  scroll: { flex: 1 },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
});
