/**
 * SVG / PNG export helpers.
 *
 * The studio's contract is *vector-first*: every 2D figure is built as
 * a `<svg>` element whose attributes already encode the final geometry.
 * `exportSvg` simply serializes that node, inlines the computed style
 * (so external CSS doesn't ghost on download) and triggers a browser
 * download.
 *
 * For the rare case where a publisher demands raster output, the
 * `exportPng` path rasterises the same SVG at an arbitrary DPI through
 * an offscreen canvas and a deterministic SVG → blob → image pipeline.
 */

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
  if (!cloned.getAttribute('xmlns')) {
    cloned.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!cloned.getAttribute('xmlns:xlink')) {
    cloned.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }
  return new XMLSerializer().serializeToString(cloned);
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

export function exportSvg(svg: SVGSVGElement, filename = 'figure.svg') {
  const xml = svgToString(svg);
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

  const xml = svgToString(svg);
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
