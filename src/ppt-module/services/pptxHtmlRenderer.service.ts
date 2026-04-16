// ─────────────────────────────────────────────────────────────────
//  PPT Module — Offline PPTX → HTML Renderer
//  Parses a .pptx file fully on-device using JSZip + regex XML
//  extraction. No network required.
//
//  Each slide is converted to a positioned HTML fragment rendered
//  at 960 × 540 (16:9).  Text, colors, bold/italic, font sizes
//  and shape fills are all extracted from the PPTX XML.
// ─────────────────────────────────────────────────────────────────

import RNFS from 'react-native-fs';
import JSZip from 'jszip';

// ─── Canvas size ─────────────────────────────────
const CANVAS_W = 960;
const CANVAS_H = 540;

// ─── Public types ─────────────────────────────────

export interface SlideViewData {
  bg: string;       // CSS colour / gradient string
  content: string;  // Positioned HTML shapes fragment
}

export interface PPTXViewerData {
  title: string;
  slides: SlideViewData[];
}

// ─── Internal types ───────────────────────────────

interface ThemeColors { [key: string]: string }

interface ParsedRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSize: number;     // canvas-px
  color: string | null;
  fontFace: string;
}

interface ParsedPara {
  align: string;        // CSS text-align
  bullet: string | null;
  indent: number;       // canvas-px
  spaceBefore: number;  // canvas-px
  runs: ParsedRun[];
}

interface ParsedShape {
  x: number; y: number; w: number; h: number; // canvas-px
  rotation: number;     // degrees
  fillColor: string | null;
  borderColor: string | null;
  isTitle: boolean;
  phType: string;
  paragraphs: ParsedPara[];
}

interface ParsedSlide {
  bg: string;
  shapes: ParsedShape[];
}

// ─────────────────────────────────────────────────
//  XML helpers
// ─────────────────────────────────────────────────

/** Return the inner content of the first occurrence of <tag ...>…</tag> */
function firstInner(xml: string, tag: string): string | null {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const si = xml.indexOf(open);
  if (si === -1) return null;
  const gt = xml.indexOf('>', si);
  if (gt === -1) return null;
  // Self-closing?
  if (xml[gt - 1] === '/') return '';
  const ei = xml.indexOf(close, gt + 1);
  if (ei === -1) return null;
  return xml.slice(gt + 1, ei);
}

/** Return ALL occurrences of <tag>…</tag>, handling simple nesting */
function allInner(xml: string, tag: string): string[] {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const results: string[] = [];
  let pos = 0;

  while (pos < xml.length) {
    const si = xml.indexOf(open, pos);
    if (si === -1) break;

    const gt = xml.indexOf('>', si);
    if (gt === -1) break;

    // Self-closing
    if (xml[gt - 1] === '/') { pos = gt + 1; continue; }

    const contentStart = gt + 1;
    let depth = 1;
    let search = contentStart;

    while (depth > 0 && search < xml.length) {
      const ni = xml.indexOf(open, search);
      const ci = xml.indexOf(close, search);
      if (ci === -1) { depth = 0; break; }

      if (ni !== -1 && ni < ci) {
        const innerGt = xml.indexOf('>', ni);
        if (innerGt !== -1 && xml[innerGt - 1] === '/') {
          search = innerGt + 1;
        } else {
          depth++;
          search = ni + open.length;
        }
      } else {
        depth--;
        if (depth === 0) {
          results.push(xml.slice(contentStart, ci));
          pos = ci + close.length;
        }
        search = ci + close.length;
      }
    }

    if (depth !== 0) pos = si + 1;
  }

  return results;
}

/** Read a named XML attribute value */
function attr(xml: string, name: string): string {
  const m = xml.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : '';
}

// ─────────────────────────────────────────────────
//  Theme colour extraction
// ─────────────────────────────────────────────────

const SCHEME_DEFAULTS: ThemeColors = {
  dk1: '000000', dk2: '44546A', lt1: 'FFFFFF', lt2: 'E7E6E6',
  accent1: '4472C4', accent2: 'ED7D31', accent3: 'A9D18E',
  accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47',
  hlink: '0563C1', folHlink: '954F72',
};

async function parseThemeColors(zip: JSZip): Promise<ThemeColors> {
  try {
    const key = Object.keys(zip.files).find(k =>
      /^ppt\/theme\/theme\d*\.xml$/.test(k));
    if (!key) return { ...SCHEME_DEFAULTS };

    const xml = await zip.file(key)!.async('string');
    const result: ThemeColors = { ...SCHEME_DEFAULTS };

    for (const name of Object.keys(SCHEME_DEFAULTS)) {
      const sec = firstInner(xml, `a:${name}`);
      if (!sec) continue;
      const srgb = sec.match(/srgbClr\s+val="([0-9A-Fa-f]{6})"/);
      if (srgb) { result[name] = srgb[1]; continue; }
      const sys = sec.match(/sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/);
      if (sys) { result[name] = sys[1]; }
    }

    return result;
  } catch {
    return { ...SCHEME_DEFAULTS };
  }
}

// ─────────────────────────────────────────────────
//  Colour resolution
// ─────────────────────────────────────────────────

const PRESET_COLORS: ThemeColors = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000',
  blue: '0000FF', yellow: 'FFFF00', cyan: '00FFFF', magenta: 'FF00FF',
  orange: 'FFA500', purple: '800080', pink: 'FFC0CB', darkGray: 'A9A9A9',
  gray: '808080', lightGray: 'D3D3D3', navy: '000080', teal: '008080',
  maroon: '800000', lime: '00FF00', silver: 'C0C0C0', gold: 'FFD700',
};

function adjustLum(hex: string, mod: number, off: number): string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const adj = (c: number) =>
    Math.min(255, Math.max(0, Math.round(c * mod + off * 255)))
      .toString(16).padStart(2, '0');
  return adj(r) + adj(g) + adj(b);
}

/**
 * Resolve a fill XML fragment (content inside a:solidFill, a:gradFill, etc.)
 * to a CSS colour string. Returns null for no-fill / transparent.
 */
function resolveColor(
  fillXml: string,
  theme: ThemeColors,
): string | null {
  if (!fillXml || fillXml.includes('<a:noFill')) return null;

  // ── sRGB direct ──────────────────────────────
  const srgb = fillXml.match(/a:srgbClr\s+val="([0-9A-Fa-f]{6})"/);
  if (srgb) {
    const alphaM = fillXml.match(/a:alpha\s+val="(\d+)"/);
    if (alphaM) {
      const a = (parseInt(alphaM[1]) / 100000).toFixed(2);
      const hex = srgb[1];
      return `rgba(${parseInt(hex.slice(0,2),16)},${parseInt(hex.slice(2,4),16)},${parseInt(hex.slice(4,6),16)},${a})`;
    }
    return '#' + srgb[1];
  }

  // ── Scheme colour ────────────────────────────
  const sc = fillXml.match(/a:schemeClr\s+val="([^"]+)"/);
  if (sc) {
    const base = theme[sc[1]] ?? 'AAAAAA';
    const lm = fillXml.match(/a:lumMod\s+val="(\d+)"/);
    const lo = fillXml.match(/a:lumOff\s+val="(\d+)"/);
    const alphaM = fillXml.match(/a:alpha\s+val="(\d+)"/);
    let hex = lm || lo
      ? adjustLum(base, lm ? parseInt(lm[1]) / 100000 : 1, lo ? parseInt(lo[1]) / 100000 : 0)
      : base;
    if (alphaM) {
      const a = (parseInt(alphaM[1]) / 100000).toFixed(2);
      return `rgba(${parseInt(hex.slice(0,2),16)},${parseInt(hex.slice(2,4),16)},${parseInt(hex.slice(4,6),16)},${a})`;
    }
    return '#' + hex;
  }

  // ── Preset ───────────────────────────────────
  const prst = fillXml.match(/a:prstClr\s+val="([^"]+)"/);
  if (prst && PRESET_COLORS[prst[1]]) return '#' + PRESET_COLORS[prst[1]];

  // ── System colour ────────────────────────────
  const sys = fillXml.match(/a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/);
  if (sys) return '#' + sys[1];

  return null;
}

/** Try to resolve a colour from a <a:solidFill> child inside xml */
function solidFillColor(xml: string, theme: ThemeColors): string | null {
  const inner = firstInner(xml, 'a:solidFill');
  if (!inner && xml.includes('<a:noFill')) return null;
  if (!inner) return null;
  return resolveColor(inner, theme);
}

// ─────────────────────────────────────────────────
//  Slide parsing
// ─────────────────────────────────────────────────

function parseSlide(
  xml: string,
  theme: ThemeColors,
  slideW: number,
  slideH: number,
): ParsedSlide {
  const sx = (emu: number) => (emu / slideW) * CANVAS_W;
  const sy = (emu: number) => (emu / slideH) * CANVAS_H;

  // ── Background ──────────────────────────────
  let bg = '#FFFFFF';
  const bgPr = firstInner(xml, 'p:bgPr');
  if (bgPr) {
    // solid fill
    const solidInner = firstInner(bgPr, 'a:solidFill');
    if (solidInner) {
      const col = resolveColor(solidInner, theme);
      if (col) bg = col;
    }
    // gradient – take first stop
    if (!solidInner) {
      const gradFill = firstInner(bgPr, 'a:gradFill');
      if (gradFill) {
        const gsContent = firstInner(gradFill, 'a:gs');
        if (gsContent) {
          const col = resolveColor(gsContent, theme);
          if (col) bg = col;
        }
      }
    }
  }

  // ── Shapes ───────────────────────────────────
  const shapes: ParsedShape[] = [];
  const spContents = allInner(xml, 'p:sp');

  for (const spXml of spContents) {
    // Placeholder type
    const phMatch = spXml.match(/<p:ph\b([^>]*)>/);
    const phType = phMatch ? attr(phMatch[1], 'type') : '';
    const isTitle = phType === 'title' || phType === 'ctrTitle';

    // Position / size
    const spPr = firstInner(spXml, 'p:spPr') ?? '';
    const xfrm = firstInner(spPr, 'a:xfrm') ?? '';
    const offM = xfrm.match(/a:off[^/]*x="(-?\d+)"[^/]*y="(-?\d+)"/);
    const extM = xfrm.match(/a:ext[^/]*cx="(\d+)"[^/]*cy="(\d+)"/);
    const rotM = xfrm.match(/\brot="(-?\d+)"/);

    const x = offM ? sx(parseInt(offM[1])) : 0;
    const y = offM ? sy(parseInt(offM[2])) : 0;
    const w = extM ? sx(parseInt(extM[1])) : CANVAS_W;
    const h = extM ? sy(parseInt(extM[2])) : CANVAS_H;
    const rotation = rotM ? parseInt(rotM[1]) / 60000 : 0; // 60000ths of a degree

    // Shape fill & border
    let fillColor: string | null = null;
    if (spPr.includes('<a:noFill')) {
      fillColor = null; // transparent
    } else {
      fillColor = solidFillColor(spPr, theme);
    }

    let borderColor: string | null = null;
    const lnContent = firstInner(spPr, 'a:ln');
    if (lnContent && !lnContent.includes('<a:noFill')) {
      borderColor = solidFillColor(lnContent, theme);
    }

    // Text body
    const txBody = firstInner(spXml, 'p:txBody') ?? '';
    const paragraphs: ParsedPara[] = [];
    const paraXmls = allInner(txBody, 'a:p');

    // Default run properties (from txBody/a:bodyPr and lstStyle)
    const bodyDefSz = txBody.match(/\bsz="(\d+)"/)?.[1];

    for (const pXml of paraXmls) {
      const pPr = firstInner(pXml, 'a:pPr') ?? '';

      // Paragraph align
      const algn = attr(pPr, 'algn');
      const ALIGN_MAP: Record<string, string> = {
        l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify',
      };
      const align = ALIGN_MAP[algn] ?? 'left';

      // Indent / bullet
      const marL = parseInt(attr(pPr, 'marL') || '0');
      const indent = marL ? sx(marL) : 0;

      const buChar = pXml.match(/a:buChar[^>]+char="([^"]+)"/)?.[1] ?? null;
      const buAutoNum = /a:buAutoNum/.test(pXml);
      const buNone = /a:buNone/.test(pXml);
      const bullet = buNone ? null : (buChar ?? (buAutoNum ? '•' : null));

      // Space before
      const spcBefPts = pXml.match(/a:spcBef[\s\S]*?a:spcPts[^>]+val="(\d+)"/)?.[1];
      const spaceBefore = spcBefPts ? sy((parseInt(spcBefPts) / 100) * 12700) : 0;

      // Default run props from paragraph props
      const defRpr = firstInner(pPr, 'a:defRPr') ?? '';

      // Collect runs (a:r) and line breaks (a:br → \n)
      const runs: ParsedRun[] = [];
      const runOrBrRe = /<a:(r|br)\b/g;
      let rmatch: RegExpExecArray | null;

      while ((rmatch = runOrBrRe.exec(pXml)) !== null) {
        const tag = rmatch[1];
        if (tag === 'br') {
          // Line break – add newline to last run or as empty run
          if (runs.length > 0) {
            runs[runs.length - 1].text += '\n';
          } else {
            runs.push({ text: '\n', bold: false, italic: false, underline: false,
              fontSize: 14, color: null, fontFace: 'Arial' });
          }
          continue;
        }

        // Regular run
        const ri = rmatch.index;
        const rClose = pXml.indexOf('</a:r>', ri);
        if (rClose === -1) continue;
        const rXml = pXml.slice(ri, rClose + 6);

        const tInner = firstInner(rXml, 'a:t');
        if (tInner === null) continue; // no text node

        const rPr = firstInner(rXml, 'a:rPr') ?? defRpr;

        const bold = /\bb="1"/.test(rPr);
        const italic = /\bi="1"/.test(rPr);
        const underline = /\bu="sng"/.test(rPr) || /\bu="dbl"/.test(rPr);

        // Font size: sz is in hundredths of a point. On a 960×540 canvas
        // representing a 13.33×7.5 inch slide, 1 canvas-px ≈ 1 typographic point.
        const szRaw = attr(rPr, 'sz') || attr(defRpr, 'sz') || bodyDefSz || '1800';
        const fontSize = Math.max(8, parseInt(szRaw) / 100);

        // Text colour
        const solidFillRpr = firstInner(rPr, 'a:solidFill');
        const color = solidFillRpr ? resolveColor(solidFillRpr, theme) : null;

        // Font face
        const latinM = rPr.match(/a:latin[^>]+typeface="([^"]+)"/);
        let fontFace = latinM ? latinM[1] : 'Arial';
        // Resolve theme font references
        if (fontFace === '+mj-lt' || fontFace === '+mj-ea') fontFace = 'Georgia, serif';
        else if (fontFace === '+mn-lt' || fontFace === '+mn-ea') fontFace = 'Arial, sans-serif';

        runs.push({ text: tInner, bold, italic, underline, fontSize, color, fontFace });
      }

      if (runs.length > 0) {
        paragraphs.push({ align, bullet, indent, spaceBefore, runs });
      }
    }

    shapes.push({
      x, y, w, h, rotation,
      fillColor,
      borderColor,
      isTitle,
      phType,
      paragraphs,
    });
  }

  return { bg, shapes };
}

// ─────────────────────────────────────────────────
//  HTML generation
// ─────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateSlideHtml(slide: ParsedSlide): SlideViewData {
  let shapesHtml = '';

  for (const shape of slide.shapes) {
    if (shape.paragraphs.length === 0 && !shape.fillColor) continue;

    // Compute sensible padding
    const padH = Math.max(3, shape.w * 0.025);
    const padV = Math.max(3, shape.h * 0.06);

    const divStyles: string[] = [
      `left:${shape.x.toFixed(1)}px`,
      `top:${shape.y.toFixed(1)}px`,
      `width:${shape.w.toFixed(1)}px`,
      `height:${shape.h.toFixed(1)}px`,
      `padding:${padV.toFixed(0)}px ${padH.toFixed(0)}px`,
    ];

    if (shape.fillColor && shape.fillColor !== 'transparent') {
      divStyles.push(`background:${shape.fillColor}`);
    }
    if (shape.borderColor) {
      divStyles.push(`border:1px solid ${shape.borderColor}`);
    }
    if (shape.rotation) {
      divStyles.push(`transform:rotate(${shape.rotation.toFixed(2)}deg)`);
    }

    let innerHtml = '';
    for (const para of shape.paragraphs) {
      const pStyles: string[] = [`text-align:${para.align}`];
      if (para.spaceBefore > 0) pStyles.push(`margin-top:${para.spaceBefore.toFixed(0)}px`);
      if (para.indent > 0) pStyles.push(`padding-left:${para.indent.toFixed(0)}px`);

      let pContent = '';

      if (para.bullet) {
        pContent += `<span style="margin-right:5px">${esc(para.bullet)}</span>`;
      }

      for (const run of para.runs) {
        const rStyles: string[] = [];
        rStyles.push(`font-size:${run.fontSize.toFixed(1)}px`);
        if (run.bold) rStyles.push('font-weight:700');
        if (run.italic) rStyles.push('font-style:italic');
        if (run.underline) rStyles.push('text-decoration:underline');
        if (run.color) rStyles.push(`color:${run.color}`);
        if (run.fontFace && run.fontFace !== 'Arial') {
          rStyles.push(`font-family:'${run.fontFace.replace(/'/g, "\\'")}',Arial,sans-serif`);
        }

        // Preserve newlines within a run
        const textParts = run.text.split('\n');
        const escapedParts = textParts.map(esc);
        const runsContent = escapedParts.join('<br>');

        pContent += `<span style="${rStyles.join(';')}">${runsContent}</span>`;
      }

      if (pContent) {
        innerHtml += `<p style="${pStyles.join(';')}">${pContent}</p>`;
      }
    }

    if (innerHtml || shape.fillColor) {
      shapesHtml += `<div class="shape" style="${divStyles.join(';')}">${innerHtml}</div>`;
    }
  }

  return { bg: slide.bg, content: shapesHtml };
}

// ─────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────

/**
 * Parse a .pptx file on-device and return per-slide HTML view data.
 * Fully offline — no network required.
 *
 * @param fileUri  Can be a bare path (/data/…) or file:// URI.
 */
export async function parsePPTXForViewer(
  fileUri: string,
): Promise<PPTXViewerData> {
  // ── Normalise path for RNFS (strip file://) ──
  const filePath = fileUri.startsWith('file://')
    ? decodeURIComponent(fileUri.replace('file://', ''))
    : fileUri;

  // ── Read & unzip ─────────────────────────────
  const base64 = await RNFS.readFile(filePath, 'base64');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const zip = await JSZip.loadAsync(bytes.buffer as ArrayBuffer);

  // ── Theme colours ────────────────────────────
  const theme = await parseThemeColors(zip);

  // ── Slide dimensions from presentation.xml ───
  let slideW = 9144000;   // default 10 in
  let slideH = 6858000;   // default 7.5 in
  try {
    const presXml = await zip.file('ppt/presentation.xml')!.async('string');
    const szM = presXml.match(/p:sldSz[^>]+cx="(\d+)"[^>]+cy="(\d+)"/);
    if (szM) { slideW = parseInt(szM[1]); slideH = parseInt(szM[2]); }
  } catch { /* keep defaults */ }

  // ── Presentation title ───────────────────────
  let title = 'Presentation';
  try {
    const coreXml = await zip.file('docProps/core.xml')!.async('string');
    const tm = coreXml.match(/<dc:title>([^<]*)<\/dc:title>/);
    if (tm && tm[1]) title = tm[1];
  } catch { /* keep default */ }

  // ── Ordered slide file names ─────────────────
  const slideNames = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/(\d+)\.xml$/)![1], 10);
      const nb = parseInt(b.match(/(\d+)\.xml$/)![1], 10);
      return na - nb;
    });

  // ── Parse each slide ─────────────────────────
  const slides: SlideViewData[] = [];
  for (const name of slideNames) {
    const xml = await zip.file(name)!.async('string');
    const parsed = parseSlide(xml, theme, slideW, slideH);
    slides.push(generateSlideHtml(parsed));
  }

  return { title, slides };
}

// ─────────────────────────────────────────────────
//  Master HTML generator
//  Builds a complete self-contained HTML page that
//  embeds all slides and exposes window.goToSlide(n).
// ─────────────────────────────────────────────────

export function buildPresentationHtml(viewerData: PPTXViewerData): string {
  const slidesJson = JSON.stringify(viewerData.slides);

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{width:100%;height:100%;overflow:hidden;background:#111827;
  font-family:-apple-system,system-ui,'Segoe UI',Arial,sans-serif;}
#stage{position:absolute;top:0;left:0;width:100%;height:100%;
  display:flex;align-items:center;justify-content:center;}
.slide{position:relative;width:960px;height:540px;overflow:hidden;
  transform-origin:center center;
  box-shadow:0 10px 50px rgba(0,0,0,0.7);}
.shape{position:absolute;overflow:hidden;word-wrap:break-word;word-break:break-word;}
p{margin:0;padding:0;line-height:1.25;white-space:pre-wrap;}
</style>
</head>
<body>
<div id="stage"><div id="slide" class="slide"></div></div>
<script>
var SLIDES=${slidesJson};
var cur=0;
function fit(){
  var el=document.getElementById('slide');
  if(!el)return;
  var s=Math.min(window.innerWidth/960,window.innerHeight/540)*0.97;
  el.style.transform='scale('+s+')';
}
function show(i){
  if(i<0||i>=SLIDES.length)return;
  cur=i;
  var el=document.getElementById('slide');
  var s=SLIDES[i];
  el.style.background=s.bg;
  el.innerHTML=s.content;
  fit();
  try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'slide',index:i,total:SLIDES.length}));}catch(e){}
}
window.goToSlide=function(i){show(i);};
window.addEventListener('resize',fit);
show(0);
</script>
</body>
</html>`;
}
