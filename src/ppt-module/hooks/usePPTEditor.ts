// ─────────────────────────────────────────────
//  PPT Module — usePPTEditor Hook
//  Centralised state for create / edit workflows.
//  Includes undo/redo history.
// ─────────────────────────────────────────────

import { useCallback, useReducer } from 'react';
import { v4 as uuid } from 'uuid';
import {
  PPTEditorState,
  PPTPresentation,
  Slide,
  ThemeId,
  EditAction,
  SlideContent,
  SlideLayout,
} from '../types/ppt.types';
import { DEFAULT_THEME_ID } from '../themes/pptThemes';

// ─── Default new presentation ────────────────
function createDefaultPresentation(title = 'New Presentation', themeId: ThemeId = DEFAULT_THEME_ID): PPTPresentation {
  return {
    id: uuid(),
    title,
    themeId,
    createdAt: new Date(),
    updatedAt: new Date(),
    slides: [
      {
        id: uuid(),
        layout: 'title',
        content: {
          title,
          subtitle: 'Your subtitle here',
        },
      },
      {
        id: uuid(),
        layout: 'titleContent',
        content: {
          title: 'Introduction',
          bullets: ['Key point one', 'Key point two', 'Key point three'],
        },
      },
      {
        id: uuid(),
        layout: 'closing',
        content: {
          title: 'Thank You',
          subtitle: 'Questions?',
        },
      },
    ],
  };
}

// ─── Reducer ─────────────────────────────────
type EditorAction =
  | { type: 'SET_PRESENTATION'; payload: PPTPresentation }
  | { type: 'UPDATE_TITLE'; payload: string }
  | { type: 'UPDATE_THEME'; payload: ThemeId }
  | { type: 'ADD_SLIDE'; payload: { layout: SlideLayout; after?: number } }
  | { type: 'DELETE_SLIDE'; payload: number }
  | { type: 'UPDATE_SLIDE_CONTENT'; payload: { index: number; content: Partial<SlideContent> } }
  | { type: 'UPDATE_SLIDE_LAYOUT'; payload: { index: number; layout: SlideLayout } }
  | { type: 'UPDATE_SLIDE_NOTES'; payload: { index: number; notes: string } }
  | { type: 'REORDER_SLIDE'; payload: { from: number; to: number } }
  | { type: 'SELECT_SLIDE'; payload: number }
  | { type: 'UNDO' }
  | { type: 'REDO' };

function applyAction(
  presentation: PPTPresentation,
  action: EditorAction,
): PPTPresentation {
  const now = new Date();
  switch (action.type) {
    case 'SET_PRESENTATION':
      return { ...action.payload, updatedAt: now };

    case 'UPDATE_TITLE':
      return { ...presentation, title: action.payload, updatedAt: now };

    case 'UPDATE_THEME':
      return { ...presentation, themeId: action.payload, updatedAt: now };

    case 'ADD_SLIDE': {
      const newSlide: Slide = {
        id: uuid(),
        layout: action.payload.layout,
        content: { title: 'New Slide' },
      };
      const slides = [...presentation.slides];
      const insertAt =
        action.payload.after !== undefined
          ? action.payload.after + 1
          : slides.length;
      slides.splice(insertAt, 0, newSlide);
      return { ...presentation, slides, updatedAt: now };
    }

    case 'DELETE_SLIDE': {
      const slides = presentation.slides.filter((_, i) => i !== action.payload);
      return { ...presentation, slides, updatedAt: now };
    }

    case 'UPDATE_SLIDE_CONTENT': {
      const slides = presentation.slides.map((s, i) =>
        i === action.payload.index
          ? { ...s, content: { ...s.content, ...action.payload.content } }
          : s,
      );
      return { ...presentation, slides, updatedAt: now };
    }

    case 'UPDATE_SLIDE_LAYOUT': {
      const slides = presentation.slides.map((s, i) =>
        i === action.payload.index ? { ...s, layout: action.payload.layout } : s,
      );
      return { ...presentation, slides, updatedAt: now };
    }

    case 'UPDATE_SLIDE_NOTES': {
      const slides = presentation.slides.map((s, i) =>
        i === action.payload.index
          ? { ...s, speakerNotes: action.payload.notes }
          : s,
      );
      return { ...presentation, slides, updatedAt: now };
    }

    case 'REORDER_SLIDE': {
      const slides = [...presentation.slides];
      const [moved] = slides.splice(action.payload.from, 1);
      slides.splice(action.payload.to, 0, moved);
      return { ...presentation, slides, updatedAt: now };
    }

    default:
      return presentation;
  }
}

interface HistoryState {
  past: PPTPresentation[];
  present: PPTPresentation;
  future: PPTPresentation[];
}

interface EditorReducerState extends PPTEditorState {
  _history: HistoryState;
}

function initialState(initial?: PPTPresentation, initialThemeId?: ThemeId): EditorReducerState {
  const presentation = initial ?? createDefaultPresentation('New Presentation', initialThemeId);
  return {
    presentation,
    selectedSlideIndex: 0,
    isDirty: false,
    history: [],
    historyIndex: -1,
    _history: { past: [], present: presentation, future: [] },
  };
}

function editorReducer(
  state: EditorReducerState,
  action: EditorAction,
): EditorReducerState {
  switch (action.type) {
    case 'UNDO': {
      if (state._history.past.length === 0) return state;
      const past = [...state._history.past];
      const previous = past.pop()!;
      return {
        ...state,
        presentation: previous,
        isDirty: true,
        _history: {
          past,
          present: previous,
          future: [state._history.present, ...state._history.future],
        },
      };
    }

    case 'REDO': {
      if (state._history.future.length === 0) return state;
      const [next, ...future] = state._history.future;
      return {
        ...state,
        presentation: next,
        isDirty: true,
        _history: {
          past: [...state._history.past, state._history.present],
          present: next,
          future,
        },
      };
    }

    case 'SELECT_SLIDE':
      return { ...state, selectedSlideIndex: action.payload };

    default: {
      const newPresentation = applyAction(state.presentation, action);
      return {
        ...state,
        presentation: newPresentation,
        isDirty: true,
        _history: {
          past: [...state._history.past, state._history.present],
          present: newPresentation,
          future: [], // clear redo stack on new action
        },
      };
    }
  }
}

// ─── Hook ────────────────────────────────────
export function usePPTEditor(initial?: PPTPresentation, initialThemeId?: ThemeId) {
  const [state, dispatch] = useReducer(
    editorReducer,
    undefined,
    () => initialState(initial, initialThemeId),
  );

  const setPresentation = useCallback(
    (p: PPTPresentation) => dispatch({ type: 'SET_PRESENTATION', payload: p }),
    [],
  );
  const updateTitle = useCallback(
    (title: string) => dispatch({ type: 'UPDATE_TITLE', payload: title }),
    [],
  );
  const updateTheme = useCallback(
    (id: ThemeId) => dispatch({ type: 'UPDATE_THEME', payload: id }),
    [],
  );
  const addSlide = useCallback(
    (layout: SlideLayout, after?: number) =>
      dispatch({ type: 'ADD_SLIDE', payload: { layout, after } }),
    [],
  );
  const deleteSlide = useCallback(
    (index: number) => dispatch({ type: 'DELETE_SLIDE', payload: index }),
    [],
  );
  const updateSlideContent = useCallback(
    (index: number, content: Partial<SlideContent>) =>
      dispatch({ type: 'UPDATE_SLIDE_CONTENT', payload: { index, content } }),
    [],
  );
  const updateSlideLayout = useCallback(
    (index: number, layout: SlideLayout) =>
      dispatch({ type: 'UPDATE_SLIDE_LAYOUT', payload: { index, layout } }),
    [],
  );
  const updateSlideNotes = useCallback(
    (index: number, notes: string) =>
      dispatch({ type: 'UPDATE_SLIDE_NOTES', payload: { index, notes } }),
    [],
  );
  const reorderSlide = useCallback(
    (from: number, to: number) =>
      dispatch({ type: 'REORDER_SLIDE', payload: { from, to } }),
    [],
  );
  const selectSlide = useCallback(
    (index: number) => dispatch({ type: 'SELECT_SLIDE', payload: index }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);

  return {
    presentation: state.presentation,
    selectedSlideIndex: state.selectedSlideIndex,
    isDirty: state.isDirty,
    canUndo: state._history.past.length > 0,
    canRedo: state._history.future.length > 0,
    // Actions
    setPresentation,
    updateTitle,
    updateTheme,
    addSlide,
    deleteSlide,
    updateSlideContent,
    updateSlideLayout,
    updateSlideNotes,
    reorderSlide,
    selectSlide,
    undo,
    redo,
  };
}

export { createDefaultPresentation };
