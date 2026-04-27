// ============================================
// TaskRenderer — Integrated Task Manager for "Tasks" feature
// Consumes: { tasks: [{ action, owner, deadline, priority, context, category }] }
// ============================================

import { useTheme } from "@/services/ThemeProvider";
import {
  Bell,
  BellOff,
  Calendar,
  CheckSquare,
  Pencil,
  Square,
  User,
  X,
} from "lucide-react-native";
import React, { useMemo, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { AIActionsBar } from "./AIActionsBar";

export interface TaskItem {
  action: string;
  owner?: string;
  deadline?: string;
  priority?: "high" | "medium" | "low" | "urgent";
  context?: string;
  category?: string;
}

export interface TaskData {
  tasks?: TaskItem[];
}

interface Props {
  data: TaskData;
  onAddAllToTodos?: (tasks: TaskItem[]) => void;
  onExport?: () => void;
  onAddToNotes?: () => void;
}

const PRIORITY_COLOR: Record<string, string> = {
  urgent: "#DC2626",
  high: "#EF4444",
  medium: "#F59E0B",
  low: "#10B981",
};

const PRIORITY_OPTIONS: Array<TaskItem["priority"]> = ["low", "medium", "high", "urgent"];

const CATEGORY_ORDER = [
  "urgent", "deliverable", "decision", "follow-up",
  "communication", "review", "other",
];
const CATEGORY_LABEL: Record<string, string> = {
  urgent: "Urgent",
  deliverable: "Deliverable",
  decision: "Decision",
  "follow-up": "Follow-Up",
  communication: "Communication",
  review: "Review",
  other: "Other",
};

export function TaskRenderer({ data, onAddAllToTodos, onExport, onAddToNotes }: Props) {
  const { colors: t, mode } = useTheme();
  const [completed, setCompleted] = useState<Record<number, boolean>>({});
  const [reminders, setReminders] = useState<Record<number, boolean>>({});
  const [editing, setEditing] = useState<Record<number, boolean>>({});
  const [localTasks, setLocalTasks] = useState<TaskItem[]>(
    Array.isArray(data?.tasks) ? data.tasks : [],
  );

  const tasks = localTasks;

  const grouped = useMemo(() => {
    const map: Record<string, { task: TaskItem; idx: number }[]> = {};
    tasks.forEach((task, idx) => {
      const cat = (task.category || "other").toLowerCase();
      if (!map[cat]) map[cat] = [];
      map[cat].push({ task, idx });
    });
    const keys = Object.keys(map).sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return keys.map((cat) => ({ cat, items: map[cat] }));
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF",
            borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
          },
        ]}
      >
        <Text style={{ color: t.textSecondary, fontSize: 13 }}>
          No tasks were found in this document.
        </Text>
      </View>
    );
  }

  const toggle = (i: number) => setCompleted((s) => ({ ...s, [i]: !s[i] }));
  const toggleReminder = (i: number) => setReminders((s) => ({ ...s, [i]: !s[i] }));
  const toggleEdit = (i: number) => setEditing((s) => ({ ...s, [i]: !s[i] }));

  const updateTask = (i: number, patch: Partial<TaskItem>) =>
    setLocalTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  const renderTaskCard = (task: TaskItem, idx: number) => {
    const prio = (task.priority || "medium").toLowerCase();
    const prColor = PRIORITY_COLOR[prio] ?? PRIORITY_COLOR.medium;
    const isDone = !!completed[idx];
    const hasReminder = !!reminders[idx];
    const isEditing = !!editing[idx];

    return (
      <View
        key={idx}
        style={[
          styles.taskCard,
          {
            backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF",
            borderColor: mode === "dark" ? "#334155" : "#E2E8F0",
            borderLeftColor: prColor,
          },
          isDone ? { opacity: 0.55 } : null,
        ]}
      >
        <View style={styles.taskHeader}>
          <TouchableOpacity onPress={() => toggle(idx)} activeOpacity={0.7}>
            {isDone ? (
              <CheckSquare size={18} color={prColor} />
            ) : (
              <Square size={18} color={t.textSecondary} />
            )}
          </TouchableOpacity>
          <Text
            style={[
              styles.action,
              {
                color: t.text,
                textDecorationLine: isDone ? "line-through" : "none",
              },
            ]}
          >
            {task.action || "Untitled task"}
          </Text>
          <View style={[styles.priorityPill, { backgroundColor: `${prColor}22` }]}>
            <Text style={[styles.priorityText, { color: prColor }]}>
              {(task.priority || "medium").toUpperCase()}
            </Text>
          </View>
          <TouchableOpacity onPress={() => toggleEdit(idx)} activeOpacity={0.7} style={styles.editBtn}>
            {isEditing ? (
              <X size={14} color={t.textSecondary} />
            ) : (
              <Pencil size={14} color={t.textSecondary} />
            )}
          </TouchableOpacity>
        </View>

        {isEditing ? (
          <View style={[styles.editPanel, { backgroundColor: mode === "dark" ? "#1E293B" : "#F8FAFC", borderColor: mode === "dark" ? "#334155" : "#E2E8F0" }]}>
            <View style={styles.editRow}>
              <Text style={[styles.editLabel, { color: t.textSecondary }]}>Priority</Text>
              <View style={styles.priorityChips}>
                {PRIORITY_OPTIONS.map((p) => {
                  const pColor = PRIORITY_COLOR[p!] ?? PRIORITY_COLOR.medium;
                  const selected = (task.priority || "medium") === p;
                  return (
                    <TouchableOpacity
                      key={p}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: selected ? `${pColor}22` : "transparent",
                          borderColor: selected ? pColor : mode === "dark" ? "#475569" : "#CBD5E1",
                        },
                      ]}
                      onPress={() => updateTask(idx, { priority: p })}
                      activeOpacity={0.7}
                    >
                      <Text style={{ fontSize: 11, fontWeight: "700", color: selected ? pColor : t.textSecondary }}>
                        {p!.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <View style={styles.editRow}>
              <Text style={[styles.editLabel, { color: t.textSecondary }]}>Owner</Text>
              <TextInput
                style={[styles.editInput, { color: t.text, borderColor: mode === "dark" ? "#475569" : "#CBD5E1", backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF" }]}
                value={task.owner ?? ""}
                onChangeText={(v) => updateTask(idx, { owner: v })}
                placeholder="Assign owner…"
                placeholderTextColor={t.textTertiary}
              />
            </View>
            <View style={styles.editRow}>
              <Text style={[styles.editLabel, { color: t.textSecondary }]}>Deadline</Text>
              <TextInput
                style={[styles.editInput, { color: t.text, borderColor: mode === "dark" ? "#475569" : "#CBD5E1", backgroundColor: mode === "dark" ? "#0F172A" : "#FFFFFF" }]}
                value={task.deadline ?? ""}
                onChangeText={(v) => updateTask(idx, { deadline: v })}
                placeholder="e.g. 2026-10-16"
                placeholderTextColor={t.textTertiary}
              />
            </View>
          </View>
        ) : (
          <View style={styles.metaRow}>
            {task.owner ? (
              <View style={styles.metaItem}>
                <User size={11} color={t.textTertiary} />
                <Text style={[styles.metaText, { color: t.textSecondary }]} numberOfLines={1}>
                  {task.owner}
                </Text>
              </View>
            ) : null}
            {task.deadline ? (
              <View style={styles.metaItem}>
                <Calendar size={11} color={t.textTertiary} />
                <Text style={[styles.metaText, { color: t.textSecondary }]} numberOfLines={1}>
                  {task.deadline}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        {task.context ? (
          <Text style={[styles.context, { color: t.textSecondary }]}>{task.context}</Text>
        ) : null}

        <TouchableOpacity
          style={[
            styles.reminderRow,
            {
              backgroundColor: hasReminder
                ? `${prColor}15`
                : mode === "dark"
                  ? "#1E293B"
                  : "#F8FAFC",
              borderColor: hasReminder ? prColor : mode === "dark" ? "#334155" : "#E2E8F0",
            },
          ]}
          onPress={() => toggleReminder(idx)}
          activeOpacity={0.7}
        >
          {hasReminder ? (
            <Bell size={12} color={prColor} />
          ) : (
            <BellOff size={12} color={t.textTertiary} />
          )}
          <Text
            style={{
              fontSize: 11,
              color: hasReminder ? prColor : t.textSecondary,
              fontWeight: "600",
            }}
          >
            {hasReminder ? "Reminder enabled" : "Enable reminder"}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.wrap}>
      {grouped.map(({ cat, items }) => (
        <View key={cat}>
          <View style={[styles.categoryHeader, { borderBottomColor: mode === "dark" ? "#1E293B" : "#E2E8F0" }]}>
            <Text style={[styles.categoryHeaderText, { color: t.textSecondary }]}>
              {CATEGORY_LABEL[cat] ?? (cat.charAt(0).toUpperCase() + cat.slice(1))}
            </Text>
            <View style={[styles.categoryCountBadge, { backgroundColor: mode === "dark" ? "#1E293B" : "#F1F5F9" }]}>
              <Text style={[styles.categoryCountText, { color: t.textTertiary }]}>{items.length}</Text>
            </View>
          </View>
          {items.map(({ task, idx }) => renderTaskCard(task, idx))}
        </View>
      ))}

      <AIActionsBar
        actions={[
          onAddAllToTodos && {
            id: "todos",
            label: `Add ${tasks.length} to My Tasks`,
            icon: CheckSquare,
            onPress: () => onAddAllToTodos(tasks),
          },
        ].filter(Boolean) as any}
      />
      <AIActionsBar handlers={{ onAddToNotes, onExport }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12 },
  taskCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: 10,
    gap: 6,
  },
  taskHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  action: { flex: 1, fontSize: 13.5, fontWeight: "600", lineHeight: 19 },
  priorityPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  priorityText: { fontSize: 10, fontWeight: "700" },
  editBtn: { padding: 4 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 11.5, maxWidth: 160 },
  categoryHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
    marginTop: 4,
  },
  categoryHeaderText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  categoryCountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
  },
  categoryCountText: {
    fontSize: 10.5,
    fontWeight: "700",
  },
  context: { fontSize: 12, fontStyle: "italic", lineHeight: 17 },
  reminderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  editPanel: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  editRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  editLabel: {
    fontSize: 11.5,
    fontWeight: "600",
    width: 56,
  },
  editInput: {
    flex: 1,
    fontSize: 12.5,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  priorityChips: {
    flexDirection: "row",
    gap: 5,
    flexWrap: "wrap",
  },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
});
