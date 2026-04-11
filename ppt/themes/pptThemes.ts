// ─────────────────────────────────────────────
//  PPT Module — Theme Definitions
//  6 Professional Themes with full color systems
// ─────────────────────────────────────────────

import { PPTTheme, ThemeId } from '../types/ppt.types';

export const PPT_THEMES: Record<ThemeId, PPTTheme> = {
  midnightExecutive: {
    id: 'midnightExecutive',
    name: 'Midnight Executive',
    description: 'Bold navy with ice-blue accents. Premium corporate feel.',
    thumbnail: '#1E2761',
    colors: {
      primary: '#1E2761',
      secondary: '#CADCFC',
      accent: '#FFFFFF',
      background: '#F4F7FF',
      backgroundDark: '#1E2761',
      text: '#1A1A2E',
      textMuted: '#6B7280',
      textOnDark: '#FFFFFF',
    },
    fonts: { heading: 'Georgia', body: 'Calibri' },
  },

  milkCream: {
    id: 'milkCream',
    name: 'Milk Cream',
    description: 'Warm creamy white with soft tan. Gentle and elegant.',
    thumbnail: '#F5F0E6',
    colors: {
      primary: '#C4A484',
      secondary: '#FAF6F0',
      accent: '#8B7355',
      background: '#FFFDF9',
      backgroundDark: '#5C4A3A',
      text: '#3D3028',
      textMuted: '#8B7B6B',
      textOnDark: '#FAF6F0',
    },
    fonts: { heading: 'Georgia', body: 'Calibri' },
  },

  forestMoss: {
    id: 'forestMoss',
    name: 'Forest & Moss',
    description: 'Earthy forest green with moss tones. Calm and trustworthy.',
    thumbnail: '#2C5F2D',
    colors: {
      primary: '#2C5F2D',
      secondary: '#97BC62',
      accent: '#F5F5F5',
      background: '#F7FAF5',
      backgroundDark: '#1E3F1F',
      text: '#1A2E1A',
      textMuted: '#5A7A5A',
      textOnDark: '#F5F5F5',
    },
    fonts: { heading: 'Cambria', body: 'Calibri' },
  },

  oceanGradient: {
    id: 'oceanGradient',
    name: 'Ocean Gradient',
    description: 'Deep ocean blues with teal highlights. Clean and modern.',
    thumbnail: '#065A82',
    colors: {
      primary: '#065A82',
      secondary: '#1C7293',
      accent: '#02C39A',
      background: '#F0F8FF',
      backgroundDark: '#021B2E',
      text: '#0A2540',
      textMuted: '#4A6B8A',
      textOnDark: '#E0F4FF',
    },
    fonts: { heading: 'Trebuchet MS', body: 'Calibri' },
  },

  warmTerracotta: {
    id: 'warmTerracotta',
    name: 'Warm Terracotta',
    description: 'Rich terracotta with sage and sand. Warm and sophisticated.',
    thumbnail: '#B85042',
    colors: {
      primary: '#B85042',
      secondary: '#E7E8D1',
      accent: '#A7BEAE',
      background: '#FAF9F3',
      backgroundDark: '#7A2E22',
      text: '#2E1A16',
      textMuted: '#8B6B64',
      textOnDark: '#F5F2EC',
    },
    fonts: { heading: 'Palatino', body: 'Garamond' },
  },

  charcoalMinimal: {
    id: 'charcoalMinimal',
    name: 'Charcoal Minimal',
    description: 'Pure charcoal and white. Ultra-clean and editorial.',
    thumbnail: '#36454F',
    colors: {
      primary: '#36454F',
      secondary: '#F2F2F2',
      accent: '#212121',
      background: '#FFFFFF',
      backgroundDark: '#1A1A1A',
      text: '#1A1A1A',
      textMuted: '#757575',
      textOnDark: '#F2F2F2',
    },
    fonts: { heading: 'Consolas', body: 'Calibri' },
  },
};

export const DEFAULT_THEME_ID: ThemeId = 'midnightExecutive';

export function getTheme(id: ThemeId): PPTTheme {
  return PPT_THEMES[id] ?? PPT_THEMES[DEFAULT_THEME_ID];
}

export const THEME_LIST: PPTTheme[] = Object.values(PPT_THEMES);
