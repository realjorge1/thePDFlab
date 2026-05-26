import AsyncStorage from "@react-native-async-storage/async-storage";

const WORKSPACE_KEY = "@wordsinscribed/ai_workspace_state_v1";

let _uid = 0;
const newId = (prefix: string) => `${prefix}_${Date.now()}_${_uid++}`;

interface NoteBlock {
  id: string;
  kind: "note";
  text: string;
  color?: string;
  pinned?: boolean;
  sourceLabel?: string;
}

export interface WorkspaceTaskBlock {
  id: string;
  kind: "task";
  text: string;
  completed?: boolean;
  reminder?: boolean;
  sourceLabel?: string;
}

type WorkspaceBlock = NoteBlock | WorkspaceTaskBlock;

interface WorkspaceState {
  blocks: WorkspaceBlock[];
  lastEditedId: string | null;
  updatedAt: number;
}

export async function addNoteToWorkspace(
  content: string,
  sourceLabel?: string,
): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) return;

  const newBlock: NoteBlock = {
    id: newId("wsnote"),
    kind: "note",
    text: trimmed,
    ...(sourceLabel ? { sourceLabel } : {}),
  };

  const raw = await AsyncStorage.getItem(WORKSPACE_KEY);
  let state: WorkspaceState = { blocks: [], lastEditedId: null, updatedAt: Date.now() };

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.blocks)) state = parsed;
    } catch {}
  }

  state.blocks = [...state.blocks, newBlock];
  state.lastEditedId = newBlock.id;
  state.updatedAt = Date.now();

  await AsyncStorage.setItem(WORKSPACE_KEY, JSON.stringify(state));
}

export async function addTasksToMyTasks(
  tasks: Array<{ action?: string; text?: string; [key: string]: any }>,
  sourceLabel?: string,
): Promise<void> {
  if (!Array.isArray(tasks) || tasks.length === 0) return;

  const raw = await AsyncStorage.getItem(WORKSPACE_KEY);
  let state: WorkspaceState = { blocks: [], lastEditedId: null, updatedAt: Date.now() };

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.blocks)) state = parsed;
    } catch {}
  }

  const taskBlocks: WorkspaceTaskBlock[] = tasks.map((t) => ({
    id: newId("wstask"),
    kind: "task",
    text: (t.action || t.text || "Untitled task").trim(),
    completed: false,
    reminder: false,
    ...(sourceLabel ? { sourceLabel } : {}),
  }));

  state.blocks = [...state.blocks, ...taskBlocks];
  state.lastEditedId = taskBlocks[taskBlocks.length - 1].id;
  state.updatedAt = Date.now();

  await AsyncStorage.setItem(WORKSPACE_KEY, JSON.stringify(state));
}
