/**
 * Publication-grade LaTeX → SVG rendering via MathJax v3.
 *
 * Unlike the live `katex` path (which renders into a `<foreignObject>`
 * full of HTML and depends on font availability in the viewer), MathJax
 * with the `liteAdaptor` produces pure SVG `<path>` glyphs whose
 * geometry is fully self-contained. That makes downstream PDF / EPS
 * conversion lossless even when the viewer has no math fonts installed.
 *
 * The whole pipeline is loaded lazily on first use to keep the studio's
 * cold-start fast.
 */
import type { LiteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import type { MathDocument } from 'mathjax-full/js/core/MathDocument.js';

interface MathJaxRuntime {
  adaptor: LiteAdaptor;
  // The document type is over-parameterised in MathJax's typings; we only
  // ever call `.convert(...)` on it, so a narrower shape suffices.
  doc: MathDocument<unknown, unknown, unknown>;
}

let runtimePromise: Promise<MathJaxRuntime> | null = null;

async function loadRuntime(): Promise<MathJaxRuntime> {
  if (runtimePromise) return runtimePromise;
  runtimePromise = (async () => {
    const [
      { mathjax },
      { TeX },
      { SVG },
      { liteAdaptor },
      { RegisterHTMLHandler },
      { AllPackages },
    ] = await Promise.all([
      import('mathjax-full/js/mathjax.js'),
      import('mathjax-full/js/input/tex.js'),
      import('mathjax-full/js/output/svg.js'),
      import('mathjax-full/js/adaptors/liteAdaptor.js'),
      import('mathjax-full/js/handlers/html.js'),
      import('mathjax-full/js/input/tex/AllPackages.js'),
    ]);

    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const tex = new TeX({ packages: AllPackages });
    const svg = new SVG({ fontCache: 'none' });
    const doc = mathjax.document('', { InputJax: tex, OutputJax: svg });
    return { adaptor, doc } as MathJaxRuntime;
  })();
  return runtimePromise;
}

export interface MathJaxSvg {
  /** Inner SVG markup, ready to be injected into a parent `<svg>`. */
  innerSvg: string;
  /** Rendered width in CSS pixels (assuming the requested font size). */
  widthPx: number;
  /** Rendered height in CSS pixels (assuming the requested font size). */
  heightPx: number;
}

/**
 * Convert a piece of mixed plain text + LaTeX (delimited by `$...$` or
 * `$$...$$`) into a single MathJax SVG fragment. Text outside delimiters
 * is wrapped in `\text{...}` so MathJax's text-mode glyphs are used.
 */
export async function renderInlineLatexToSvg(
  text: string,
  options: { fontSize?: number } = {},
): Promise<MathJaxSvg> {
  const fontSize = options.fontSize ?? 14;
  const tex = mixedToTex(text);
  const { adaptor, doc } = await loadRuntime();
  const node = doc.convert(tex, {
    display: false,
    em: fontSize,
    ex: fontSize / 2,
    containerWidth: 80 * fontSize,
  }) as unknown as { firstChild: unknown };

  // `mjx-container` wraps a single `<svg>`. We only need that inner SVG.
  const containerHtml = adaptor.outerHTML(node as never);
  const innerSvgString = extractInnerSvg(containerHtml);
  const { widthPx, heightPx } = measureSvg(innerSvgString, fontSize);
  return {
    innerSvg: innerSvgString,
    widthPx,
    heightPx,
  };
}

function extractInnerSvg(html: string): string {
  const match = html.match(/<svg[\s\S]*<\/svg>/);
  return match ? match[0] : html;
}

function measureSvg(svgMarkup: string, fontSize: number): {
  widthPx: number;
  heightPx: number;
} {
  // MathJax declares width/height in ex units. 1 ex ≈ 0.5 em ≈ fontSize/2.
  const widthMatch = svgMarkup.match(/\swidth="([\d.]+)ex"/);
  const heightMatch = svgMarkup.match(/\sheight="([\d.]+)ex"/);
  const exToPx = fontSize / 2;
  return {
    widthPx: widthMatch ? parseFloat(widthMatch[1]) * exToPx : 0,
    heightPx: heightMatch ? parseFloat(heightMatch[1]) * exToPx : 0,
  };
}

/**
 * Convert a string with `$inline$` / `$$display$$` markers into pure
 * TeX where outside-of-math runs are wrapped in `\text{...}`. Special
 * characters that have meaning in TeX (`{`, `}`, `\`, `#`, `$`, `&`,
 * `%`, `_`, `^`, `~`) are escaped so that purely textual content
 * remains literal.
 */
export function mixedToTex(text: string): string {
  if (!text.includes('$')) return wrapText(text);

  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '$') {
      const display = text.startsWith('$$', i);
      const marker = display ? '$$' : '$';
      const end = text.indexOf(marker, i + marker.length);
      if (end === -1) {
        // Unbalanced delimiter — treat the rest as plain text.
        out.push(wrapText(text.slice(i)));
        break;
      }
      out.push(text.slice(i + marker.length, end));
      i = end + marker.length;
      continue;
    }
    const next = text.indexOf('$', i);
    const stop = next === -1 ? text.length : next;
    out.push(wrapText(text.slice(i, stop)));
    i = stop;
  }
  return out.join('');
}

function wrapText(text: string): string {
  if (!text) return '';
  return `\\text{${escapeForText(text)}}`;
}

function escapeForText(s: string): string {
  // Step 1: de-escape common LaTeX-style escape sequences the user may
  // have typed in body text (e.g. `\%` to mean a literal `%`). Without
  // this, the live preview (KaTeX, which renders plain text as-is)
  // shows the literal `\%` while the exported SVG would route through
  // MathJax and emit a giant `<rect data-background>` error glyph.
  // De-escaping here makes both pipelines agree and avoids the error.
  s = s.replace(/\\([%&$#_{}])/g, '$1');
  // Step 2: escape characters that have meaning in TeX text mode so
  // they reach MathJax as literal glyphs. Lone backslashes / carets /
  // tildes are dropped because MathJax `mtext` does not reliably
  // accept `\textbackslash` / `\textasciicircum` / `\textasciitilde`
  // (the textcomp package defines them as math-mode commands), and
  // generating them would re-introduce the same `<rect data-background>`
  // black-bar regression. Users who really need a literal backslash
  // can write `$\backslash$` instead.
  return s
    .replace(/\\/g, '')
    .replace(/[{}]/g, '\\$&')
    .replace(/[#$&%_]/g, '\\$&')
    .replace(/\^/g, ' ')
    .replace(/~/g, ' ');
}
