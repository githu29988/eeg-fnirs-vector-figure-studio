import { useState, type ReactNode } from 'react';
import {
  ColormapSelect,
  NumberInput,
  NumberSlider,
  Select,
  Toggle,
} from './Controls';
import type { ColormapName } from '../lib/colormaps';

/**
 * Schema-driven expert inspector. Each chart declares an
 * `ExpertSchema` describing the *full* parameter tree (including
 * fields the simple inspector intentionally hides) and the panel below
 * renders a dense, collapsible editor for it.
 *
 * Field state lives on the chart component, not on the schema; the
 * schema only references the existing `value` / `onChange` callbacks.
 * This keeps the simple inspector and the expert panel always in sync
 * without a parallel state container.
 */

interface NumberField {
  type: 'number';
  key: string;
  label: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  /** When set, render as a slider; otherwise as a numeric input. */
  slider?: boolean;
  format?: (v: number) => string;
}

interface ToggleField {
  type: 'toggle';
  key: string;
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

interface SelectField<T extends string = string> {
  type: 'select';
  key: string;
  label: string;
  description?: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}

interface ColormapField {
  type: 'colormap';
  key: string;
  label?: string;
  description?: string;
  value: ColormapName;
  onChange: (v: ColormapName) => void;
}

interface InfoField {
  type: 'info';
  key: string;
  label: string;
  value: string;
}

export type ExpertField =
  | NumberField
  | ToggleField
  | SelectField
  | ColormapField
  | InfoField;

export interface ExpertGroup {
  label: string;
  description?: string;
  fields: ExpertField[];
  /** Whether the group starts open. Defaults to true. */
  defaultOpen?: boolean;
}

export type ExpertSchema = ExpertGroup[];

export function ExpertPanel({ schema }: { schema: ExpertSchema }) {
  return (
    <div className="space-y-3">
      {schema.map((group) => (
        <ExpertGroupSection key={group.label} group={group} />
      ))}
    </div>
  );
}

function ExpertGroupSection({ group }: { group: ExpertGroup }) {
  const [open, setOpen] = useState(group.defaultOpen !== false);
  return (
    <section className="rounded border border-ink-700 bg-ink-800/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-100">
            {group.label}
          </span>
          {group.description ? (
            <span className="ml-2 text-[11px] text-ink-300">
              {group.description}
            </span>
          ) : null}
        </span>
        <span aria-hidden className="text-[10px] text-ink-300">
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? (
        <div className="space-y-2.5 border-t border-ink-700 px-3 py-3">
          {group.fields.map((field) => (
            <ExpertFieldRow key={field.key} field={field} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ExpertFieldRow({ field }: { field: ExpertField }) {
  return (
    <div className="space-y-1">
      {renderField(field)}
      {'description' in field && field.description ? (
        <p className="text-[11px] text-ink-300">{field.description}</p>
      ) : null}
    </div>
  );
}

function renderField(field: ExpertField): ReactNode {
  switch (field.type) {
    case 'number':
      return field.slider ? (
        <NumberSlider
          label={field.label}
          value={field.value}
          min={field.min ?? 0}
          max={field.max ?? 100}
          step={field.step ?? 1}
          onChange={field.onChange}
          format={field.format}
        />
      ) : (
        <NumberInput
          label={field.label}
          value={field.value}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={field.onChange}
        />
      );
    case 'toggle':
      return (
        <Toggle
          label={field.label}
          checked={field.value}
          onChange={field.onChange}
        />
      );
    case 'select':
      return (
        <Select
          label={field.label}
          value={field.value}
          options={field.options}
          onChange={field.onChange}
        />
      );
    case 'colormap':
      return <ColormapSelect value={field.value} onChange={field.onChange} />;
    case 'info':
      return (
        <div className="flex items-baseline justify-between text-xs text-ink-200">
          <span>{field.label}</span>
          <span className="font-mono text-ink-100">{field.value}</span>
        </div>
      );
  }
}
