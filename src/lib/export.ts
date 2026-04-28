/**
 * SVG / PNG export helpers.
 *
 * The studio's contract is *vector-first*: every 2D figure is built as
 * a `<svg>` element whose attributes already encode the final geometry.
 * `exportSvg` serialises that node, inlines computed styles, and — for
 * any title/caption authored as LaTeX — replaces the live KaTeX
 * `<foreignObject>` markup with MathJax-rendered SVG glyph paths so the
 * resulting file is fully self-contained (no font dependency, no HTML
 * inside SVG).
 *
 * For the rare case where a publisher demands raster output, the
 * `exportPng` path rasterises the converted SVG at an arbitrary DPI
 * through an offscreen canvas and a deterministic SVG → blob → image
 * pipeline.
 */
import { renderInlineLatexToSvg } from './mathjax';

const STYLE_PROPERTIES: Array<keyof CSSStyleDeclaration> = [
  'font',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fill',
  'stroke',
  'strokeWidth',
  'strokeOpacity',
  'fillOpacity',
  'opacity',
  'textAnchor',
  'dominantBaseline',
  'letterSpacing',
];

function inlineComputedStyles(root: SVGElement): SVGElement {
  const clone = root.cloneNode(true) as SVGElement;
  const originals = root.querySelectorAll<SVGElement>('*');
  const clones = clone.querySelectorAll<SVGElement>('*');
  // Apply to root itself first.
  applyStyle(root, clone);
  originals.forEach((el, i) => applyStyle(el, clones[i]));
  return clone;
}

function applyStyle(src: Element, dst: Element) {
  if (!(src instanceof SVGElement) || !(dst instanceof SVGElement)) return;
  const computed = window.getComputedStyle(src);
  for (const prop of STYLE_PROPERTIES) {
    const value = computed.getPropertyValue(prop as string);
    if (value) dst.style.setProperty(prop as string, value);
  }
}

export function svgToString(svg: SVGSVGElement): string {
  const cloned = inlineComputedStyles(svg) as SVGSVGElement;
  ensureSvgNamespaces(cloned);
  return new XMLSerializer().serializeToString(cloned);
}

function ensureSvgNamespaces(svg: SVGSVGElement) {
  if (!svg.getAttribute('xmlns')) {
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!svg.getAttribute('xmlns:xlink')) {
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }
}

/**
 * Build the publication-ready SVG markup: clone the live SVG, inline
 * computed styles, and replace every `<foreignObject data-latex>` with
 * MathJax-rendered glyph paths so the file becomes self-contained.
 */
export async function svgToVectorString(svg: SVGSVGElement): Promise<string> {
  const cloned = inlineComputedStyles(svg) as SVGSVGElement;
  ensureSvgNamespaces(cloned);
  // Mount the clone off-screen so DOM operations like `replaceWith`
  // and namespace lookups behave consistently.
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:-99999px;';
  document.body.appendChild(host);
  host.appendChild(cloned);
  try {
    await replaceLatexForeignObjects(cloned);
    return new XMLSerializer().serializeToString(cloned);
  } finally {
    host.remove();
  }
}

/**
 * Walk the cloned SVG and replace every `<foreignObject data-latex>`
 * with a MathJax-rendered SVG fragment. The result is pure SVG: no HTML
 * inside SVG, no font dependency.
 *
 * Layout: the replacement `<g>` uses the same x/y/width as the original
 * foreignObject, then horizontally centres the math fragment within
 * that box. Vertical baseline aligns to the foreignObject mid-line so
 * single-line titles look right.
 */
export async function replaceLatexForeignObjects(svg: SVGSVGElement): Promise<void> {
  const ns = 'http://www.w3.org/2000/svg';
  const targets = Array.from(
    svg.querySelectorAll<SVGForeignObjectElement>('foreignObject[data-latex]'),
  );
  for (const fo of targets) {
    const latex = fo.getAttribute('data-latex') ?? '';
    if (!latex) continue;
    const fontSize = parseFloat(
      fo.getAttribute('data-latex-font-size') ?? '14',
    );
    const fontWeight = fo.getAttribute('data-latex-font-weight') ?? '400';
    const fontStyle = fo.getAttribute('data-latex-font-style') ?? 'normal';

    const x = parseFloat(fo.getAttribute('x') ?? '0');
    const y = parseFloat(fo.getAttribute('y') ?? '0');
    const width = parseFloat(fo.getAttribute('width') ?? '0');
    const height = parseFloat(fo.getAttribute('height') ?? '0');

    const { innerSvg, widthPx, heightPx } = await renderInlineLatexToSvg(
      latex,
      { fontSize },
    );

    // Compose a wrapper <g> at the foreignObject's position. Inside,
    // place a nested <svg> sized to `widthPx × heightPx` so its
    // viewBox-driven coordinates land where we want them, then translate
    // to centre.
    const g = document.createElementNS(ns, 'g');
    g.setAttribute(
      'transform',
      `translate(${x + (width - widthPx) / 2}, ${y + (height - heightPx) / 2})`,
    );
    g.setAttribute('font-weight', fontWeight);
    g.setAttribute('font-style', fontStyle);
    g.setAttribute('aria-label', latex);

    // Parse the MathJax SVG markup into a real DOM element under our
    // namespace and reset its width/height/style so it lays out at the
    // measured pixel size we already computed.
    const parser = new DOMParser();
    const doc = parser.parseFromString(innerSvg, 'image/svg+xml');
    const inner = doc.documentElement;
    if (inner.nodeName.toLowerCase() === 'svg') {
      inner.setAttribute('width', widthPx.toString());
      inner.setAttribute('height', heightPx.toString());
      // The MathJax style attribute uses HTML units like `vertical-align`
      // that confuse strict SVG renderers; strip it.
      inner.removeAttribute('style');
      g.appendChild(document.importNode(inner, true));
      fo.replaceWith(g);
    }
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke so Safari has a chance to read the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportSvg(
  svg: SVGSVGElement,
  filename = 'figure.svg',
): Promise<void> {
  const xml = await svgToVectorString(svg);
  const blob = new Blob(
    [`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`],
    { type: 'image/svg+xml;charset=utf-8' },
  );
  downloadBlob(blob, filename);
}

export interface RasterExportOptions {
  filename?: string;
  /** Target DPI for print. 96 is screen-default; 300/600/1200 are journal-grade. */
  dpi?: number;
  /** If specified, override SVG width/height (in CSS pixels) before rasterising. */
  width?: number;
  height?: number;
  /** Background colour. Defaults to transparent. */
  background?: string | null;
}

export async function exportPng(
  svg: SVGSVGElement,
  options: RasterExportOptions = {},
): Promise<void> {
  const {
    filename = 'figure.png',
    dpi = 300,
    background = null,
  } = options;

  const xml = await svgToVectorString(svg);
  const bbox = svg.getBoundingClientRect();
  const cssWidth = options.width ?? bbox.width;
  const cssHeight = options.height ?? bbox.height;

  const scale = dpi / 96;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cssWidth * scale);
  canvas.height = Math.round(cssHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');

  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }

  const pngBlob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))),
      'image/png',
    ),
  );
  downloadBlob(pngBlob, filename);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}
