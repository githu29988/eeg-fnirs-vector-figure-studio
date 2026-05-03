import { useState, type ReactNode } from 'react';
import { ExportToolbar } from './ExportToolbar';
import { ExpertPanel, type ExpertSchema } from './ExpertPanel';

interface ChartShellProps {
  /** The figure itself, wrapped in a `FigureFrame`. */
  figure: ReactNode;
  /** Forwarded to ExportToolbar's `getSvg`. */
  getSvg: () => SVGSVGElement | null;
  /** Filename stem for SVG/PNG downloads. */
  filename: string;
  /** Simple-mode inspector contents (handful of high-impact controls). */
  inspector?: ReactNode;
  /** Full parameter tree exposed in expert mode. */
  expertSchema?: ExpertSchema;
  /** Variant tiles ("Inspiration panel") rendered below the inspector. */
  inspiration?: ReactNode;
  /** Optional data-ingestion panel rendered above the inspector. */
  dataLoader?: ReactNode;
  /** Optional notes / data-format docs rendered under the figure. */
  notes?: ReactNode;
}

type Mode = 'simple' | 'expert';

/**
 * Two-column shell used by every chart page: left panel for the
 * controls + inspiration tiles, right panel for the figure itself
 * and its export toolbar.
 *
 * The control panel exposes two modes: a curated *Simple* inspector
 * (3–5 high-impact knobs) and an *Expert* parameter tree generated
 * from a chart-supplied schema. Toggle persists per session via
 * component state — switching charts resets to Simple by default.
 */
export function ChartShell({
  figure,
  getSvg,
  filename,
  inspector,
  expertSchema,
  inspiration,
  dataLoader,
  notes,
}: ChartShellProps) {
  const hasExpert = !!expertSchema && expertSchema.length > 0;
  const [mode, setMode] = useState<Mode>('simple');
  const activeMode: Mode = hasExpert ? mode : 'simple';

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="space-y-5">
        {dataLoader}
        {inspector || hasExpert ? (
          <section className="rounded-lg border border-ink-700 bg-ink-900 p-4">
            <header className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
                  {activeMode === 'expert' ? '专家参数树' : '简明面板'}
                </p>
                <p className="text-[11px] text-ink-300">
                  {activeMode === 'expert'
                    ? '完整参数面，可折叠分组以集中注意。'
                    : hasExpert
                    ? '常用控件。如需完整参数请切换至专家模式。'
                    : '常用控件。'}
                </p>
              </div>
              {hasExpert ? (
                <ModeToggle mode={mode} onChange={setMode} />
              ) : null}
            </header>
            <div className="space-y-3">
              {activeMode === 'expert' && expertSchema ? (
                <ExpertPanel schema={expertSchema} />
              ) : (
                inspector
              )}
            </div>
          </section>
        ) : null}
        {inspiration ? (
          <section className="rounded-lg border border-ink-700 bg-ink-900 p-4">
            <header className="mb-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
                灵感面板
              </p>
              <p className="text-[11px] text-ink-300">
                点击下方变体即可一键应用到当前图表。
              </p>
            </header>
            <div>{inspiration}</div>
          </section>
        ) : null}
      </aside>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
            图表预览
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

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="控制面板模式"
      className="flex shrink-0 rounded border border-ink-600 bg-ink-800 p-0.5 text-[10px]"
    >
      {(
        [
          { id: 'simple', label: '简明' },
          { id: 'expert', label: '专家' },
        ] as const
      ).map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={mode === m.id}
          onClick={() => onChange(m.id)}
          className={
            'rounded px-2 py-0.5 font-medium tracking-wider transition-colors ' +
            (mode === m.id
              ? 'bg-accent text-ink-900'
              : 'text-ink-300 hover:text-ink-100')
          }
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
