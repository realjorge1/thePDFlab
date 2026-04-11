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

  crimsonElite: {
    id: 'crimsonElite',
    name: 'Crimson Elite',
    description: 'Deep crimson with champagne gold. High-impact luxury.',
    thumbnail: '#8B0000',
    colors: {
      primary: '#8B0000',
      secondary: '#C9A84C',
      accent: '#FFF8E7',
      background: '#FFF9F7',
      backgroundDark: '#5C0000',
      text: '#1A0000',
      textMuted: '#8B5656',
      textOnDark: '#FFE8C0',
    },
    fonts: { heading: 'Georgia', body: 'Calibri' },
  },

  ultraviolet: {
    id: 'ultraviolet',
    name: 'Ultraviolet',
    description: 'Electric violet with cyan. Modern and innovative.',
    thumbnail: '#4F46E5',
    colors: {
      primary: '#4F46E5',
      secondary: '#818CF8',
      accent: '#22D3EE',
      background: '#F5F3FF',
      backgroundDark: '#1E1B4B',
      text: '#1E1144',
      textMuted: '#6B70AB',
      textOnDark: '#EDE9FE',
    },
    fonts: { heading: 'Arial', body: 'Arial' },
  },

  sunriseGlow: {
    id: 'sunriseGlow',
    name: 'Sunrise Glow',
    description: 'Warm amber and gold. Energetic and confident.',
    thumbnail: '#D97706',
    colors: {
      primary: '#D97706',
      secondary: '#FCD34D',
      accent: '#F97316',
      background: '#FFFBEB',
      backgroundDark: '#78350F',
      text: '#1C0A00',
      textMuted: '#92400E',
      textOnDark: '#FEF3C7',
    },
    fonts: { heading: 'Impact', body: 'Arial' },
  },

  slateTech: {
    id: 'slateTech',
    name: 'Slate Tech',
    description: 'Near-black slate with electric blue. Data and developer.',
    thumbnail: '#0F172A',
    colors: {
      primary: '#1E293B',
      secondary: '#0EA5E9',
      accent: '#38BDF8',
      background: '#F0F4F8',
      backgroundDark: '#020617',
      text: '#0F172A',
      textMuted: '#64748B',
      textOnDark: '#BAE6FD',
    },
    fonts: { heading: 'Consolas', body: 'Calibri' },
  },

  blossomSoft: {
    id: 'blossomSoft',
    name: 'Blossom',
    description: 'Dusty rose with warm gold. Elegant and approachable.',
    thumbnail: '#DB2777',
    colors: {
      primary: '#DB2777',
      secondary: '#F9A8D4',
      accent: '#FBBF24',
      background: '#FFF1F5',
      backgroundDark: '#9D174D',
      text: '#3B0023',
      textMuted: '#9D6E85',
      textOnDark: '#FCE7F3',
    },
    fonts: { heading: 'Georgia', body: 'Calibri' },
  },

  goldLuxury: {
    id: 'goldLuxury',
    name: 'Gold Luxury',
    description: 'Rich amber and gold on deep brown. Premium and timeless.',
    thumbnail: '#B45309',
    colors: {
      primary: '#92400E',
      secondary: '#F59E0B',
      accent: '#FDE68A',
      background: '#FFFDF0',
      backgroundDark: '#451A03',
      text: '#1C0E00',
      textMuted: '#78480C',
      textOnDark: '#FEF3C7',
    },
    fonts: { heading: 'Palatino', body: 'Garamond' },
  },
};

export const DEFAULT_THEME_ID: ThemeId = 'midnightExecutive';

export function getTheme(id: ThemeId): PPTTheme {
  return PPT_THEMES[id] ?? PPT_THEMES[DEFAULT_THEME_ID];
}

export const THEME_LIST: PPTTheme[] = Object.values(PPT_THEMES);
