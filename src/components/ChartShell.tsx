import type { ReactNode } from 'react';
import { ExportToolbar } from './ExportToolbar';

interface ChartShellProps {
  /** The figure itself, wrapped in a `FigureFrame`. */
  figure: ReactNode;
  /** Forwarded to ExportToolbar's `getSvg`. */
  getSvg: () => SVGSVGElement | null;
  /** Filename stem for SVG/PNG downloads. */
  filename: string;
  /** Simple-mode inspector contents (handful of high-impact controls). */
  inspector?: ReactNode;
  /** Variant tiles ("Inspiration panel") rendered below the inspector. */
  inspiration?: ReactNode;
  /** Optional notes / data-format docs rendered under the figure. */
  notes?: ReactNode;
}

/**
 * Two-column shell used by every chart page: left panel for the
 * controls + inspiration tiles, right panel for the figure itself
 * and its export toolbar.
 *
 * The split is responsive — on narrow viewports the controls collapse
 * above the figure.
 */
export function ChartShell({
  figure,
  getSvg,
  filename,
  inspector,
  inspiration,
  notes,
}: ChartShellProps) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-5">
        {inspector ? (
          <section className="rounded-lg border border-ink-700 bg-ink-900 p-4">
            <header className="mb-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
                Simple inspector
              </p>
              <p className="text-[11px] text-ink-300">
                Core controls. Open expert mode for the full parameter tree.
              </p>
            </header>
            <div className="space-y-3">{inspector}</div>
          </section>
        ) : null}
        {inspiration ? (
          <section className="rounded-lg border border-ink-700 bg-ink-900 p-4">
            <header className="mb-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
                Inspiration
              </p>
              <p className="text-[11px] text-ink-300">
                Click a variant to apply it to the current figure.
              </p>
            </header>
            <div>{inspiration}</div>
          </section>
        ) : null}
      </aside>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
            Figure preview
          </p>
          <ExportToolbar getSvg={getSvg} baseFilename={filename} />
        </div>
        <div className="rounded-lg border border-ink-700 bg-white p-6 text-ink-900">
          {figure}
        </div>
        {notes ? (
          <div className="rounded-lg border border-ink-700 bg-ink-900 p-4 text-xs text-ink-200">
            {notes}
          </div>
        ) : null}
      </section>
    </div>
  );
}
