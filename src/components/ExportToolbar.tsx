import { useState } from 'react';
import { exportPng, exportSvg } from '../lib/export';

interface ExportToolbarProps {
  getSvg: () => SVGSVGElement | null;
  baseFilename?: string;
}

const DPI_OPTIONS = [96, 150, 300, 600, 1200];

export function ExportToolbar({
  getSvg,
  baseFilename = 'figure',
}: ExportToolbarProps) {
  const [dpi, setDpi] = useState(300);
  const [busy, setBusy] = useState(false);

  const onSvg = () => {
    const svg = getSvg();
    if (!svg) return;
    exportSvg(svg, `${baseFilename}.svg`);
  };

  const onPng = async () => {
    const svg = getSvg();
    if (!svg) return;
    try {
      setBusy(true);
      await exportPng(svg, {
        filename: `${baseFilename}@${dpi}dpi.png`,
        dpi,
        background: '#ffffff',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <button
        type="button"
        onClick={onSvg}
        className="rounded border border-ink-600 bg-ink-800 px-3 py-1.5 font-medium text-ink-50 hover:border-accent hover:text-accent"
      >
        Export SVG
      </button>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onPng}
          disabled={busy}
          className="rounded border border-ink-600 bg-ink-800 px-3 py-1.5 font-medium text-ink-50 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Rendering…' : `Export PNG @ ${dpi} DPI`}
        </button>
        <select
          value={dpi}
          onChange={(e) => setDpi(Number(e.target.value))}
          className="rounded border border-ink-600 bg-ink-800 px-2 py-1.5 text-ink-50"
        >
          {DPI_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} DPI
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
