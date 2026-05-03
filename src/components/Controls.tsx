import { useId, type ReactNode } from 'react';
import { COLORMAP_OPTIONS, type ColormapName } from '../lib/colormaps';

export function ControlGroup({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-200">
          {label}
        </p>
        {description ? (
          <p className="text-[11px] text-ink-300">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function NumberSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs text-ink-200">
      <span className="flex items-baseline justify-between">
        <span>{label}</span>
        <span className="font-mono text-ink-100">
          {format ? format(value) : value}
        </span>
      </span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-accent"
      />
    </label>
  );
}

export function NumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs text-ink-200">
      <span>{label}</span>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded border border-ink-600 bg-ink-800 px-2 py-1 font-mono text-ink-50 focus:border-accent focus:outline-none"
      />
    </label>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs text-ink-200">
      <span>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-ink-50 focus:border-accent focus:outline-none"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ColormapSelect({
  value,
  onChange,
}: {
  value: ColormapName;
  onChange: (v: ColormapName) => void;
}) {
  return (
    <Select
      label="配色方案"
      value={value}
      options={COLORMAP_OPTIONS}
      onChange={onChange}
    />
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center justify-between text-xs text-ink-200">
      <span>{label}</span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-accent"
      />
    </label>
  );
}
