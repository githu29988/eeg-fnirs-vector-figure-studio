import katex from 'katex';

export interface RenderLatexOptions {
  displayMode?: boolean;
  throwOnError?: boolean;
}

/**
 * Render a LaTeX string to an HTML string using KaTeX. The output is a
 * `<span class="katex">` block that can be injected with
 * `dangerouslySetInnerHTML` or appended to a `foreignObject` inside an
 * SVG. KaTeX's HTML+CSS rendering is then post-processed by the export
 * pipeline (which inlines the required font glyphs as SVG `<path>`
 * elements so the figure remains lossless).
 */
export function renderLatexToHtml(
  source: string,
  { displayMode = false, throwOnError = false }: RenderLatexOptions = {},
): string {
  return katex.renderToString(source, {
    displayMode,
    throwOnError,
    output: 'html',
    strict: 'ignore',
  });
}

/**
 * Replace `$inline$` and `$$display$$` segments inside a string with
 * KaTeX-rendered HTML. Used by axis labels and legend rendering.
 */
export function renderInlineLatex(text: string): string {
  if (!text.includes('$')) return escapeHtml(text);
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    const display = text.startsWith('$$', i);
    const marker = display ? '$$' : '$';
    if (text[i] === '$') {
      const end = text.indexOf(marker, i + marker.length);
      if (end === -1) {
        out.push(escapeHtml(text.slice(i)));
        break;
      }
      const expr = text.slice(i + marker.length, end);
      out.push(renderLatexToHtml(expr, { displayMode: display }));
      i = end + marker.length;
    } else {
      const next = text.indexOf('$', i);
      const stop = next === -1 ? text.length : next;
      out.push(escapeHtml(text.slice(i, stop)));
      i = stop;
    }
  }
  return out.join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
