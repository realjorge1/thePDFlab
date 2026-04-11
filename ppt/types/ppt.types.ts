// ─────────────────────────────────────────────
//  PPT Module — Type Definitions
//  Professional React Native PowerPoint Module
// ─────────────────────────────────────────────

export type SlideLayout =
  | 'title'
  | 'titleContent'
  | 'twoColumn'
  | 'blank'
  | 'imageLeft'
  | 'imageRight'
  | 'statHighlight'
  | 'timeline'
  | 'closing';

export type ThemeId =
  | 'midnightExecutive'
  | 'milkCream'
  | 'forestMoss'
  | 'oceanGradient'
  | 'warmTerracotta'
  | 'charcoalMinimal';

export interface PPTTheme {
  id: ThemeId;
  name: string;
  description: string;
  thumbnail: string; // hex color used as preview
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    backgroundDark: string;
    text: string;
    textMuted: string;
    textOnDark: string;
  };
  fonts: {
    heading: string;
    body: string;
  };
}

export interface SlideTextElement {
  type: 'text';
  content: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
}

export interface SlideImageElement {
  type: 'image';
  uri: string; // local or remote URI
  width?: number;
  height?: number;
}

export interface SlideShapeElement {
  type: 'shape';
  shape: 'rect' | 'roundRect' | 'ellipse';
  fill?: string;
  width?: number;
  height?: number;
}

export type SlideElement =
  | SlideTextElement
  | SlideImageElement
  | SlideShapeElement;

export interface SlideContent {
  title?: string;
  subtitle?: string;
  body?: string;
  bullets?: string[];
  stat?: { value: string; label: string };
  imageUri?: string;
  leftContent?: string;
  rightContent?: string;
  timelineItems?: Array<{ year: string; event: string }>;
  footnote?: string;
}

export interface Slide {
  id: string;
  layout: SlideLayout;
  content: SlideContent;
  speakerNotes?: string;
}

export interface PPTPresentation {
  id: string;
  title: string;
  themeId: ThemeId;
  slides: Slide[];
  createdAt: Date;
  updatedAt: Date;
  filePath?: string; // path on device after export
}

export interface PPTCreationOptions {
  title: string;
  themeId: ThemeId;
  slides: Slide[];
}

export type PPTExportFormat = 'pptx' | 'pdf';

export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface PPTViewerState {
  currentSlide: number;
  totalSlides: number;
  isLoading: boolean;
  error?: string;
  slideImages: string[]; // base64 or URIs for preview
}

export interface EditAction {
  type:
    | 'UPDATE_SLIDE'
    | 'ADD_SLIDE'
    | 'DELETE_SLIDE'
    | 'REORDER_SLIDE'
    | 'UPDATE_THEME'
    | 'UPDATE_TITLE';
  payload: Record<string, unknown>;
  timestamp: Date;
}

export interface PPTEditorState {
  presentation: PPTPresentation;
  selectedSlideIndex: number;
  isDirty: boolean; // unsaved changes
  history: EditAction[];
  historyIndex: number;
}

export type ViewerStrategy = 'webview_google' | 'webview_office' | 'native_cards';

export interface ViewerSource {
  strategy: ViewerStrategy;
  uri?: string;
  slides?: Slide[];
}
