// ─────────────────────────────────────────────
//  PPT Module — Barrel Exports
//  Import everything from this single entry point.
//
//  Usage:
//    import { PPTNavigator, usePPTEditor, PPT_THEMES } from '../ppt-module';
// ─────────────────────────────────────────────

// ── Screens ──────────────────────────────────
export { PPTNavigator }      from './screens/PPT/PPTNavigator';
export { PPTHomeScreen }     from './screens/PPT/PPTHomeScreen';
export { PPTCreatorScreen }  from './screens/PPT/PPTCreatorScreen';
export { PPTViewerScreen }   from './screens/PPT/PPTViewerScreen';
export { PPTOpenEditScreen } from './screens/PPT/PPTOpenEditScreen';

// ── Components ───────────────────────────────
export { SlideCard }             from './components/PPT/SlideCard';
export { SlideEditor }           from './components/PPT/SlideEditor';
export { SlideThumbnailStrip }   from './components/PPT/SlideThumbnailStrip';
export { ThemePicker }           from './components/PPT/ThemePicker';
export { ExportModal }           from './components/PPT/ExportModal';

// ── Hooks ────────────────────────────────────
export { usePPTEditor }   from './hooks/usePPTEditor';
export { useExportPPT }   from './hooks/useExportPPT';

// ── Services ─────────────────────────────────
export { generatePPTX, sharePPTX }                        from './services/pptxGenerator.service';
export { openPPTX, saveEditsToExistingPPTX,
         toPPTPresentation }                              from './services/pptxEditor.service';
export { buildViewerSource, googleDocsViewerUrl,
         officeViewerUrl, copyBundledPPTX }               from './services/pptxViewer.service';

// ── Themes ───────────────────────────────────
export { PPT_THEMES, THEME_LIST, getTheme,
         DEFAULT_THEME_ID }                               from './themes/pptThemes';

// ── Types ─────────────────────────────────────
export type {
  PPTPresentation,
  PPTTheme,
  Slide,
  SlideContent,
  SlideLayout,
  ThemeId,
  ExportResult,
  PPTCreationOptions,
  PPTEditorState,
  PPTViewerState,
  EditAction,
  ViewerStrategy,
  ViewerSource,
} from './types/ppt.types';
