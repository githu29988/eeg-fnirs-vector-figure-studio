/**
 * Inspiration panel — declarative variant tiles.
 *
 * Each chart provides a small list of named presets. Clicking a tile
 * fires the preset's `apply` callback, which is expected to call the
 * chart's own setState hooks and, optionally, return a tag string for
 * the active-state badge. The panel is purely presentational; it owns
 * no state beyond which preset (if any) was last clicked.
 */
import { useState } from 'react';

export interface InspirationPreset {
  /** Stable id used for the active-tile highlight. */
  id: string;
  /** Short tile label shown in the tile body. */
  label: string;
  /** One-line copy explaining the variant. */
  description?: string;
  /** Optional badge / scenario tag (e.g. "clinical"). */
  hint?: string;
  /** Side-effect: set the chart's state to the preset values. */
  apply: () => void;
}

export function InspirationPanel({
  presets,
}: {
  presets: InspirationPreset[];
}) {
  const [active, setActive] = useState<string | null>(null);

  if (presets.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-2">
      {presets.map((preset) => {
        const isActive = active === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              preset.apply();
              setActive(preset.id);
            }}
            className={
              'group flex flex-col gap-1 rounded border px-3 py-2 text-left transition-colors ' +
              (isActive
                ? 'border-accent bg-ink-800 text-ink-50'
                : 'border-ink-700 bg-ink-900 text-ink-100 hover:border-ink-500 hover:bg-ink-800')
            }
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] font-semibold leading-tight">
                {preset.label}
              </span>
              {preset.hint ? (
                <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-200">
                  {preset.hint}
                </span>
              ) : null}
            </div>
            {preset.description ? (
              <span className="text-[11px] leading-snug text-ink-300">
                {preset.description}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
