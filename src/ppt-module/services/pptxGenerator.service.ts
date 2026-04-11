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

/** Shared footer: thin line + slide number on all content slides */
function addFooter(pptx: PptxGenJS, pSlide: any, theme: PPTTheme, index: number) {
  const { colors, fonts } = theme;
  pSlide.addShape(pptx.ShapeType.rect, {
    x: 0.4,
    y: H - 0.4,
    w: W - 0.8,
    h: 0.02,
    fill: { color: hex(colors.primary), transparency: 60 },
    line: { color: hex(colors.primary), transparency: 60 },
  });
  pSlide.addText(String(index + 1), {
    x: W - 1.0,
    y: H - 0.5,
    w: 0.6,
    h: 0.3,
    fontSize: 10,
    color: hex(colors.textMuted),
    fontFace: fonts.body,
    align: 'right',
  });
}

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

  const { content } = slide;

  switch (slide.layout as SlideLayout) {
    // ─── Title Slide ─────────────────────────
    case 'title': {
      // Full dark background already set
      // Decorative corner accent — top-right arc
      pSlide.addShape(pptx.ShapeType.ellipse, {
        x: 9.2,
        y: -2.8,
        w: 6.0,
        h: 6.0,
        fill: { color: hex(colors.primary), transparency: 72 },
        line: { color: hex(colors.primary), transparency: 72 },
      });
      // Smaller secondary circle
      pSlide.addShape(pptx.ShapeType.ellipse, {
        x: 11.4,
        y: -1.0,
        w: 3.2,
        h: 3.2,
        fill: { color: hex(colors.secondary), transparency: 78 },
        line: { color: hex(colors.secondary), transparency: 78 },
      });

      // Bottom accent band
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: H - 0.55,
        w: W,
        h: 0.55,
        fill: { color: hex(colors.primary), transparency: 30 },
        line: { color: hex(colors.primary), transparency: 30 },
      });
      // Thin accent line above band
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: H - 0.58,
        w: W,
        h: 0.04,
        fill: { color: hex(colors.secondary) },
        line: { color: hex(colors.secondary) },
      });

      // Left side accent bar
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 2.1,
        w: 0.06,
        h: 1.9,
        fill: { color: hex(colors.secondary) },
        line: { color: hex(colors.secondary) },
      });

      pSlide.addText(content.title ?? 'Untitled', {
        x: 0.9,
        y: 1.8,
        w: 9.5,
        h: 2.0,
        fontSize: 46,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.textOnDark),
        wrap: true,
        valign: 'middle',
      });

      if (content.subtitle) {
        // Thin separator line
        pSlide.addShape(pptx.ShapeType.rect, {
          x: 0.9,
          y: 3.95,
          w: 3.5,
          h: 0.04,
          fill: { color: hex(colors.secondary), transparency: 30 },
          line: { color: hex(colors.secondary), transparency: 30 },
        });
        pSlide.addText(content.subtitle, {
          x: 0.9,
          y: 4.1,
          w: 9.5,
          h: 0.9,
          fontSize: 18,
          fontFace: fonts.body,
          color: hex(colors.secondary),
          wrap: true,
        });
      }

      // Slide number in bottom band
      pSlide.addText(String(index + 1), {
        x: W - 1.2,
        y: H - 0.48,
        w: 0.7,
        h: 0.36,
        fontSize: 11,
        color: hex(colors.textOnDark),
        fontFace: fonts.body,
        align: 'right',
        bold: true,
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
        h: 1.5,
        fill: { color: hex(colors.primary) },
        line: { color: hex(colors.primary) },
      });
      // Thin accent strip under header
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 1.5,
        w: W,
        h: 0.05,
        fill: { color: hex(colors.secondary) },
        line: { color: hex(colors.secondary) },
      });

      // Decorative circle — right side
      pSlide.addShape(pptx.ShapeType.ellipse, {
        x: W - 1.2,
        y: -1.2,
        w: 2.8,
        h: 2.8,
        fill: { color: hex(colors.textOnDark), transparency: 88 },
        line: { color: hex(colors.textOnDark), transparency: 88 },
      });

      pSlide.addText(content.title ?? '', {
        x: 0.55,
        y: 0.2,
        w: W - 1.1,
        h: 1.1,
        fontSize: 30,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.textOnDark),
        wrap: true,
        valign: 'middle',
      });

      if (content.body) {
        pSlide.addText(content.body, {
          x: 0.55,
          y: 1.8,
          w: W - 1.1,
          h: 4.6,
          fontSize: 15,
          fontFace: fonts.body,
          color: textColor,
          wrap: true,
          valign: 'top',
          lineSpacingMultiple: 1.3,
        });
      }

      if (content.bullets && content.bullets.length > 0) {
        pSlide.addText(
          content.bullets.map(b => ({ text: b, options: { bullet: { type: 'bullet' } } })),
          {
            x: 0.55,
            y: 1.8,
            w: W - 1.1,
            h: 4.6,
            fontSize: 15,
            fontFace: fonts.body,
            color: textColor,
            lineSpacingMultiple: 1.4,
            paraSpaceAfter: 6,
          },
        );
      }

      addFooter(pptx, pSlide, theme, index);
      break;
    }

    // ─── Two Columns ─────────────────────────
    case 'twoColumn': {
      // Header band
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: W,
        h: 1.3,
        fill: { color: hex(colors.primary) },
        line: { color: hex(colors.primary) },
      });
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 1.3,
        w: W,
        h: 0.04,
        fill: { color: hex(colors.secondary) },
        line: { color: hex(colors.secondary) },
      });

      pSlide.addText(content.title ?? '', {
        x: 0.55,
        y: 0.15,
        w: W - 1.1,
        h: 1.0,
        fontSize: 28,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.textOnDark),
        valign: 'middle',
      });

      // Column divider
      pSlide.addShape(pptx.ShapeType.rect, {
        x: W / 2 - 0.015,
        y: 1.55,
        w: 0.03,
        h: H - 2.2,
        fill: { color: hex(colors.secondary), transparency: 30 },
        line: { color: hex(colors.secondary), transparency: 30 },
      });

      pSlide.addText(content.leftContent ?? '', {
        x: 0.55,
        y: 1.6,
        w: W / 2 - 0.9,
        h: H - 2.3,
        fontSize: 14,
        fontFace: fonts.body,
        color: textColor,
        wrap: true,
        valign: 'top',
        lineSpacingMultiple: 1.35,
      });

      pSlide.addText(content.rightContent ?? '', {
        x: W / 2 + 0.35,
        y: 1.6,
        w: W / 2 - 0.9,
        h: H - 2.3,
        fontSize: 14,
        fontFace: fonts.body,
        color: textColor,
        wrap: true,
        valign: 'top',
        lineSpacingMultiple: 1.35,
      });

      addFooter(pptx, pSlide, theme, index);
      break;
    }

    // ─── Stat Highlight ──────────────────────
    case 'statHighlight': {
      // Dark background already set
      // Background accent circles for depth
      pSlide.addShape(pptx.ShapeType.ellipse, {
        x: -1.5,
        y: -1.5,
        w: 5.5,
        h: 5.5,
        fill: { color: hex(colors.primary), transparency: 82 },
        line: { color: hex(colors.primary), transparency: 82 },
      });
      pSlide.addShape(pptx.ShapeType.ellipse, {
        x: 8.8,
        y: 4.0,
        w: 6.0,
        h: 6.0,
        fill: { color: hex(colors.secondary), transparency: 85 },
        line: { color: hex(colors.secondary), transparency: 85 },
      });

      // Top accent line
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 3.5,
        y: 0.55,
        w: W - 7.0,
        h: 0.05,
        fill: { color: hex(colors.secondary) },
        line: { color: hex(colors.secondary) },
      });

      pSlide.addText(content.title ?? '', {
        x: 1.0,
        y: 0.65,
        w: W - 2.0,
        h: 0.9,
        fontSize: 22,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.secondary),
        align: 'center',
        letterSpacing: 1,
      });

      // The big stat
      const statAccent = colors.accent === '#FFFFFF' ? colors.secondary : colors.accent;
      pSlide.addText(content.stat?.value ?? '', {
        x: 0.5,
        y: 1.4,
        w: W - 1.0,
        h: 3.4,
        fontSize: 120,
        bold: true,
        fontFace: fonts.heading,
        color: hex(statAccent),
        align: 'center',
      });

      // Bottom separator line
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 3.5,
        y: 5.1,
        w: W - 7.0,
        h: 0.04,
        fill: { color: hex(colors.secondary), transparency: 40 },
        line: { color: hex(colors.secondary), transparency: 40 },
      });

      pSlide.addText(content.stat?.label ?? '', {
        x: 1.0,
        y: 5.2,
        w: W - 2.0,
        h: 0.8,
        fontSize: 20,
        fontFace: fonts.body,
        color: hex(colors.textOnDark),
        align: 'center',
        letterSpacing: 0.5,
      });

      if (content.footnote) {
        pSlide.addText(content.footnote, {
          x: 0.5,
          y: H - 0.55,
          w: W - 1.0,
          h: 0.35,
          fontSize: 10,
          fontFace: fonts.body,
          color: mutedColor,
          align: 'center',
          italic: true,
        });
      }
      break;
    }

    // ─── Image Left ──────────────────────────
    case 'imageLeft': {
      // Thin top accent bar
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: W,
        h: 0.1,
        fill: { color: hex(colors.primary) },
        line: { color: hex(colors.primary) },
      });

      if (content.imageUri) {
        pSlide.addImage({
          path: content.imageUri,
          x: 0.1,
          y: 0.1,
          w: 5.8,
          h: H - 0.3,
        });
      } else {
        pSlide.addShape(pptx.ShapeType.rect, {
          x: 0.1,
          y: 0.1,
          w: 5.8,
          h: H - 0.3,
          fill: { color: hex(colors.secondary), transparency: 30 },
          line: { color: hex(colors.secondary) },
        });
      }

      // Right side: title + body
      pSlide.addText(content.title ?? '', {
        x: 6.3,
        y: 0.7,
        w: 6.6,
        h: 1.1,
        fontSize: 28,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.primary),
        wrap: true,
      });
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 6.3,
        y: 1.85,
        w: 2.5,
        h: 0.04,
        fill: { color: hex(colors.primary), transparency: 40 },
        line: { color: hex(colors.primary), transparency: 40 },
      });
      pSlide.addText(content.body ?? '', {
        x: 6.3,
        y: 2.05,
        w: 6.6,
        h: 4.2,
        fontSize: 14,
        fontFace: fonts.body,
        color: textColor,
        wrap: true,
        valign: 'top',
        lineSpacingMultiple: 1.35,
      });

      addFooter(pptx, pSlide, theme, index);
      break;
    }

    // ─── Image Right ─────────────────────────
    case 'imageRight': {
      // Thin top accent bar
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: W,
        h: 0.1,
        fill: { color: hex(colors.primary) },
        line: { color: hex(colors.primary) },
      });

      pSlide.addText(content.title ?? '', {
        x: 0.5,
        y: 0.7,
        w: 6.4,
        h: 1.1,
        fontSize: 28,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.primary),
        wrap: true,
      });
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 1.85,
        w: 2.5,
        h: 0.04,
        fill: { color: hex(colors.primary), transparency: 40 },
        line: { color: hex(colors.primary), transparency: 40 },
      });
      pSlide.addText(content.body ?? '', {
        x: 0.5,
        y: 2.05,
        w: 6.4,
        h: 4.2,
        fontSize: 14,
        fontFace: fonts.body,
        color: textColor,
        wrap: true,
        valign: 'top',
        lineSpacingMultiple: 1.35,
      });

      if (content.imageUri) {
        pSlide.addImage({
          path: content.imageUri,
          x: 7.3,
          y: 0.1,
          w: 5.8,
          h: H - 0.3,
        });
      } else {
        pSlide.addShape(pptx.ShapeType.rect, {
          x: 7.3,
          y: 0.1,
          w: 5.8,
          h: H - 0.3,
          fill: { color: hex(colors.secondary), transparency: 30 },
          line: { color: hex(colors.secondary) },
        });
      }

      addFooter(pptx, pSlide, theme, index);
      break;
    }

    // ─── Timeline ────────────────────────────
    case 'timeline': {
      // Header band
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: W,
        h: 1.3,
        fill: { color: hex(colors.primary) },
        line: { color: hex(colors.primary) },
      });
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 1.3,
        w: W,
        h: 0.04,
        fill: { color: hex(colors.secondary) },
        line: { color: hex(colors.secondary) },
      });

      pSlide.addText(content.title ?? '', {
        x: 0.55,
        y: 0.15,
        w: W - 1.1,
        h: 1.0,
        fontSize: 28,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.textOnDark),
        valign: 'middle',
      });

      // Timeline spine
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0.5,
        y: 2.1,
        w: W - 1.0,
        h: 0.05,
        fill: { color: hex(colors.primary) },
        line: { color: hex(colors.primary) },
      });

      const items = content.timelineItems ?? [];
      const step = (W - 1.0) / Math.max(items.length, 1);
      const dotAccent = colors.accent === '#FFFFFF' ? colors.secondary : colors.accent;

      items.forEach((item, i) => {
        const cx = 0.5 + i * step + step / 2;

        // Connector line from spine to dot
        pSlide.addShape(pptx.ShapeType.rect, {
          x: cx - 0.015,
          y: 1.87,
          w: 0.03,
          h: 0.27,
          fill: { color: hex(colors.primary), transparency: 40 },
          line: { color: hex(colors.primary), transparency: 40 },
        });

        // Dot
        pSlide.addShape(pptx.ShapeType.ellipse, {
          x: cx - 0.2,
          y: 1.87,
          w: 0.4,
          h: 0.4,
          fill: { color: hex(dotAccent) },
          line: { color: hex(colors.primary), pt: 2 },
        });

        pSlide.addText(item.year, {
          x: cx - 0.6,
          y: 2.32,
          w: 1.2,
          h: 0.4,
          fontSize: 13,
          bold: true,
          fontFace: fonts.heading,
          color: hex(colors.primary),
          align: 'center',
        });

        pSlide.addText(item.event, {
          x: cx - step / 2 + 0.1,
          y: 2.8,
          w: step - 0.2,
          h: 3.5,
          fontSize: 12,
          fontFace: fonts.body,
          color: textColor,
          align: 'center',
          wrap: true,
          valign: 'top',
          lineSpacingMultiple: 1.2,
        });
      });

      addFooter(pptx, pSlide, theme, index);
      break;
    }

    // ─── Closing Slide ───────────────────────
    case 'closing': {
      // Full dark bg already set
      // Decorative elements
      pSlide.addShape(pptx.ShapeType.ellipse, {
        x: -2.0,
        y: H - 4.5,
        w: 6.0,
        h: 6.0,
        fill: { color: hex(colors.primary), transparency: 72 },
        line: { color: hex(colors.primary), transparency: 72 },
      });
      pSlide.addShape(pptx.ShapeType.ellipse, {
        x: W - 3.5,
        y: -1.5,
        w: 5.0,
        h: 5.0,
        fill: { color: hex(colors.secondary), transparency: 80 },
        line: { color: hex(colors.secondary), transparency: 80 },
      });

      // Horizontal accent line above title
      pSlide.addShape(pptx.ShapeType.rect, {
        x: W / 2 - 1.5,
        y: 2.3,
        w: 3.0,
        h: 0.05,
        fill: { color: hex(colors.secondary) },
        line: { color: hex(colors.secondary) },
      });

      pSlide.addText(content.title ?? 'Thank You', {
        x: 1.5,
        y: 2.4,
        w: W - 3.0,
        h: 1.5,
        fontSize: 52,
        bold: true,
        fontFace: fonts.heading,
        color: hex(colors.textOnDark),
        align: 'center',
      });

      // Accent line below title
      pSlide.addShape(pptx.ShapeType.rect, {
        x: W / 2 - 1.5,
        y: 4.05,
        w: 3.0,
        h: 0.05,
        fill: { color: hex(colors.secondary) },
        line: { color: hex(colors.secondary) },
      });

      if (content.subtitle) {
        pSlide.addText(content.subtitle, {
          x: 1.5,
          y: 4.2,
          w: W - 3.0,
          h: 0.8,
          fontSize: 18,
          fontFace: fonts.body,
          color: hex(colors.secondary),
          align: 'center',
          letterSpacing: 0.5,
        });
      }

      // Bottom band
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: H - 0.5,
        w: W,
        h: 0.5,
        fill: { color: hex(colors.primary), transparency: 35 },
        line: { color: hex(colors.primary), transparency: 35 },
      });
      pSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: H - 0.52,
        w: W,
        h: 0.04,
        fill: { color: hex(colors.secondary) },
        line: { color: hex(colors.secondary) },
      });
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
    pptx.author = 'PDFLab';

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
