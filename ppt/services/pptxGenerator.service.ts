// ─────────────────────────────────────────────
//  PPT Module — PPTX Generation Service
//  Builds .pptx files via pptxgenjs
//  Works fully on-device, no server needed.
// ─────────────────────────────────────────────

import PptxGenJS from 'pptxgenjs';
import RNFS from 'react-native-fs';
import Share from 'react-native-share';
import { Platform } from 'react-native';
import {
  PPTPresentation,
  Slide,
  SlideLayout,
  ExportResult,
  PPTTheme,
} from '../types/ppt.types';
import { getTheme } from '../themes/pptThemes';

// ─── Slide Dimensions (inches) ───────────────
const W = 13.33;
const H = 7.5;

// ─── Helpers ─────────────────────────────────
const hex = (c: string) => c.replace('#', '');

function buildSlide(
  pptx: PptxGenJS,
  slide: Slide,
  theme: PPTTheme,
  index: number,
) {
  const pSlide = pptx.addSlide();
  const { colors, fonts } = theme;
  const isTitle =
    slide.layout === 'title' || slide.layout === 'closing';
  const bgColor = isTitle
    ? hex(colors.backgroundDark)
    : hex(colors.background);
  const textColor = isTitle
    ? hex(colors.textOnDark)
    : hex(colors.text);
  const mutedColor = isTitle
    ? hex(colors.secondary)
    : hex(colors.textMuted);

  // Background
  pSlide.background = { color: bgColor };

  // Accent left bar (carried visual motif across all slides)
  pSlide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.08,
    h: H,
    fill: { color: hex(colors.primary) },
    line: { color: hex(colors.primary) },
  });

  const { content } = slide;

  switch (slide.layout as SlideLayout) {
    // ─── Title Slide ─────────────────────────
    case 'title': {
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: W,
        h: H,
        fill: { color: bgColor },
        line: { color: bgColor },
      });

      // Large decorative circle (top-right)
      pSlide.addShape(pptx.ShapeType.ellipse, {
        x: 9.8,
        y: -1.5,
        w: 5,
        h: 5,
        fill: { color: hex(colors.primary), transparency: 60 },
        line: { color: hex(colors.primary), transparency: 60 },
      });

      pSlide.addText(content.title ?? 'Untitled', {
        x: 0.8,
        y: 2.0,
        w: 9,
        h: 1.5,
        fontSize: 44,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.textOnDark),
        wrap: true,
      });

      if (content.subtitle) {
        pSlide.addText(content.subtitle, {
          x: 0.8,
          y: 3.8,
          w: 8,
          h: 0.8,
          fontSize: 18,
          fontFace: fonts.body,
          color: hex(colors.secondary),
          wrap: true,
        });
      }

      // Slide number at bottom
      pSlide.addText(String(index + 1), {
        x: W - 1.2,
        y: H - 0.6,
        w: 0.8,
        h: 0.4,
        fontSize: 11,
        color: mutedColor,
        fontFace: fonts.body,
        align: 'right',
      });
      break;
    }

    // ─── Title + Content ─────────────────────
    case 'titleContent': {
      // Header band
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: W,
        h: 1.4,
        fill: { color: hex(colors.primary) },
        line: { color: hex(colors.primary) },
      });

      pSlide.addText(content.title ?? '', {
        x: 0.5,
        y: 0.2,
        w: W - 1,
        h: 1.0,
        fontSize: 28,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.textOnDark),
        wrap: true,
      });

      if (content.body) {
        pSlide.addText(content.body, {
          x: 0.5,
          y: 1.7,
          w: W - 1,
          h: 4.5,
          fontSize: 15,
          fontFace: fonts.body,
          color: textColor,
          wrap: true,
        });
      }

      if (content.bullets && content.bullets.length > 0) {
        pSlide.addText(
          content.bullets.map(b => ({ text: b, options: { bullet: true } })),
          {
            x: 0.5,
            y: 1.7,
            w: W - 1,
            h: 4.5,
            fontSize: 15,
            fontFace: fonts.body,
            color: textColor,
          },
        );
      }

      pSlide.addText(String(index + 1), {
        x: W - 1.2,
        y: H - 0.5,
        w: 0.8,
        h: 0.3,
        fontSize: 10,
        color: mutedColor,
        fontFace: fonts.body,
        align: 'right',
      });
      break;
    }

    // ─── Two Columns ─────────────────────────
    case 'twoColumn': {
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: W,
        h: 1.2,
        fill: { color: hex(colors.primary) },
        line: { color: hex(colors.primary) },
      });
      pSlide.addText(content.title ?? '', {
        x: 0.5,
        y: 0.15,
        w: W - 1,
        h: 0.9,
        fontSize: 26,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.textOnDark),
      });

      // Divider
      pSlide.addShape(pptx.ShapeType.rect, {
        x: W / 2 - 0.01,
        y: 1.4,
        w: 0.02,
        h: H - 1.9,
        fill: { color: hex(colors.secondary) },
        line: { color: hex(colors.secondary) },
      });

      pSlide.addText(content.leftContent ?? '', {
        x: 0.5,
        y: 1.5,
        w: W / 2 - 0.8,
        h: H - 2.2,
        fontSize: 14,
        fontFace: fonts.body,
        color: textColor,
        wrap: true,
        valign: 'top',
      });

      pSlide.addText(content.rightContent ?? '', {
        x: W / 2 + 0.3,
        y: 1.5,
        w: W / 2 - 0.8,
        h: H - 2.2,
        fontSize: 14,
        fontFace: fonts.body,
        color: textColor,
        wrap: true,
        valign: 'top',
      });

      pSlide.addText(String(index + 1), {
        x: W - 1.2,
        y: H - 0.5,
        w: 0.8,
        h: 0.3,
        fontSize: 10,
        color: mutedColor,
        fontFace: fonts.body,
        align: 'right',
      });
      break;
    }

    // ─── Stat Highlight ──────────────────────
    case 'statHighlight': {
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: W,
        h: H,
        fill: { color: hex(colors.backgroundDark) },
        line: { color: hex(colors.backgroundDark) },
      });

      pSlide.addText(content.title ?? '', {
        x: 1,
        y: 0.6,
        w: W - 2,
        h: 0.8,
        fontSize: 22,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.secondary),
        align: 'center',
      });

      pSlide.addText(content.stat?.value ?? '', {
        x: 1,
        y: 1.6,
        w: W - 2,
        h: 3.0,
        fontSize: 110,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.accent === '#FFFFFF' ? colors.secondary : colors.accent),
        align: 'center',
      });

      pSlide.addText(content.stat?.label ?? '', {
        x: 1,
        y: 4.9,
        w: W - 2,
        h: 0.8,
        fontSize: 20,
        fontFace: fonts.body,
        color: hex(colors.textOnDark),
        align: 'center',
      });

      if (content.footnote) {
        pSlide.addText(content.footnote, {
          x: 0.5,
          y: H - 0.6,
          w: W - 1,
          h: 0.4,
          fontSize: 10,
          fontFace: fonts.body,
          color: mutedColor,
          align: 'center',
        });
      }
      break;
    }

    // ─── Image Left ──────────────────────────
    case 'imageLeft': {
      if (content.imageUri) {
        pSlide.addImage({
          path: content.imageUri,
          x: 0.1,
          y: 0.2,
          w: 5.8,
          h: H - 0.4,
        });
      } else {
        pSlide.addShape(pptx.ShapeType.rect, {
          x: 0.1,
          y: 0.2,
          w: 5.8,
          h: H - 0.4,
          fill: { color: hex(colors.secondary) },
          line: { color: hex(colors.secondary) },
        });
      }

      pSlide.addText(content.title ?? '', {
        x: 6.3,
        y: 0.8,
        w: 6.5,
        h: 1.0,
        fontSize: 26,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.primary),
        wrap: true,
      });

      pSlide.addText(content.body ?? '', {
        x: 6.3,
        y: 2.1,
        w: 6.5,
        h: 4.0,
        fontSize: 14,
        fontFace: fonts.body,
        color: textColor,
        wrap: true,
        valign: 'top',
      });

      pSlide.addText(String(index + 1), {
        x: W - 1.2,
        y: H - 0.5,
        w: 0.8,
        h: 0.3,
        fontSize: 10,
        color: mutedColor,
        fontFace: fonts.body,
        align: 'right',
      });
      break;
    }

    // ─── Image Right ─────────────────────────
    case 'imageRight': {
      pSlide.addText(content.title ?? '', {
        x: 0.5,
        y: 0.8,
        w: 6.5,
        h: 1.0,
        fontSize: 26,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.primary),
        wrap: true,
      });

      pSlide.addText(content.body ?? '', {
        x: 0.5,
        y: 2.1,
        w: 6.5,
        h: 4.0,
        fontSize: 14,
        fontFace: fonts.body,
        color: textColor,
        wrap: true,
        valign: 'top',
      });

      if (content.imageUri) {
        pSlide.addImage({
          path: content.imageUri,
          x: 7.3,
          y: 0.2,
          w: 5.8,
          h: H - 0.4,
        });
      } else {
        pSlide.addShape(pptx.ShapeType.rect, {
          x: 7.3,
          y: 0.2,
          w: 5.8,
          h: H - 0.4,
          fill: { color: hex(colors.secondary) },
          line: { color: hex(colors.secondary) },
        });
      }

      pSlide.addText(String(index + 1), {
        x: W - 1.2,
        y: H - 0.5,
        w: 0.8,
        h: 0.3,
        fontSize: 10,
        color: mutedColor,
        fontFace: fonts.body,
        align: 'right',
      });
      break;
    }

    // ─── Timeline ────────────────────────────
    case 'timeline': {
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: W,
        h: 1.2,
        fill: { color: hex(colors.primary) },
        line: { color: hex(colors.primary) },
      });
      pSlide.addText(content.title ?? '', {
        x: 0.5,
        y: 0.15,
        w: W - 1,
        h: 0.9,
        fontSize: 26,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.textOnDark),
      });

      // Timeline spine
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 1.6,
        w: W - 1,
        h: 0.04,
        fill: { color: hex(colors.primary) },
        line: { color: hex(colors.primary) },
      });

      const items = content.timelineItems ?? [];
      const step = (W - 1) / Math.max(items.length, 1);
      items.forEach((item, i) => {
        const cx = 0.5 + i * step + step / 2;

        // Dot
        pSlide.addShape(pptx.ShapeType.ellipse, {
          x: cx - 0.15,
          y: 1.45,
          w: 0.3,
          h: 0.3,
          fill: { color: hex(colors.accent === '#FFFFFF' ? colors.secondary : colors.accent) },
          line: { color: hex(colors.primary) },
        });

        pSlide.addText(item.year, {
          x: cx - 0.5,
          y: 1.85,
          w: 1,
          h: 0.35,
          fontSize: 12,
          bold: true,
          fontFace: fonts.heading,
          color: hex(colors.primary),
          align: 'center',
        });

        pSlide.addText(item.event, {
          x: cx - 0.8,
          y: 2.3,
          w: 1.6,
          h: 3.5,
          fontSize: 11,
          fontFace: fonts.body,
          color: textColor,
          align: 'center',
          wrap: true,
          valign: 'top',
        });
      });

      pSlide.addText(String(index + 1), {
        x: W - 1.2,
        y: H - 0.5,
        w: 0.8,
        h: 0.3,
        fontSize: 10,
        color: mutedColor,
        fontFace: fonts.body,
        align: 'right',
      });
      break;
    }

    // ─── Closing Slide ───────────────────────
    case 'closing': {
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: W,
        h: H,
        fill: { color: hex(colors.backgroundDark) },
        line: { color: hex(colors.backgroundDark) },
      });

      // Decorative bottom-left circle
      pSlide.addShape(pptx.ShapeType.ellipse, {
        x: -1.5,
        y: H - 3,
        w: 5,
        h: 5,
        fill: { color: hex(colors.primary), transparency: 50 },
        line: { color: hex(colors.primary), transparency: 50 },
      });

      pSlide.addText(content.title ?? 'Thank You', {
        x: 1.5,
        y: 2.4,
        w: W - 3,
        h: 1.5,
        fontSize: 48,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.textOnDark),
        align: 'center',
      });

      if (content.subtitle) {
        pSlide.addText(content.subtitle, {
          x: 1.5,
          y: 4.1,
          w: W - 3,
          h: 0.7,
          fontSize: 16,
          fontFace: fonts.body,
          color: hex(colors.secondary),
          align: 'center',
        });
      }
      break;
    }

    // ─── Blank ───────────────────────────────
    case 'blank':
    default:
      break;
  }

  return pSlide;
}

// ─── Public API ──────────────────────────────

export async function generatePPTX(
  presentation: PPTPresentation,
): Promise<ExportResult> {
  try {
    const theme = getTheme(presentation.themeId);
    const pptx = new PptxGenJS();

    pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
    pptx.title = presentation.title;
    pptx.author = 'PPT Module';

    presentation.slides.forEach((slide, idx) => {
      buildSlide(pptx, slide, theme, idx);
    });

    // Write to base64 string (works in React Native)
    const base64 = await pptx.write({ outputType: 'base64' });

    const dir =
      Platform.OS === 'ios'
        ? RNFS.DocumentDirectoryPath
        : RNFS.ExternalDirectoryPath ?? RNFS.DocumentDirectoryPath;

    const safeName = presentation.title
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase();
    const fileName = `${safeName}_${Date.now()}.pptx`;
    const filePath = `${dir}/${fileName}`;

    await RNFS.writeFile(filePath, base64 as string, 'base64');

    return { success: true, filePath };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[PPT] generatePPTX error:', message);
    return { success: false, error: message };
  }
}

export async function sharePPTX(filePath: string, title: string): Promise<void> {
  await Share.open({
    url: `file://${filePath}`,
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    title,
    failOnCancel: false,
  });
}
