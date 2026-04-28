import type { ComponentType } from 'react';

export interface ChartCategory {
  id: string;
  label: string;
  description?: string;
}

export interface ChartEntry {
  /** URL slug. */
  id: string;
  /** Display name in English. */
  title: string;
  /** Optional Chinese title for bilingual UI. */
  titleZh?: string;
  /** Short summary shown in the sidebar. */
  summary: string;
  category: ChartCategory['id'];
  component: ComponentType;
  /** Marks charts that are still under development. */
  status?: 'stable' | 'wip';
}

export const CATEGORIES: ChartCategory[] = [
  { id: 'overview', label: 'Overview' },
  {
    id: 'architecture',
    label: 'Model Architecture',
    description: 'Network topology, fusion logic, and tensor flow.',
  },
  {
    id: 'physiology',
    label: 'Neurophysiology & Topology',
    description: 'Sensor space, neurovascular coupling, cortical projection.',
  },
  {
    id: 'clinical',
    label: 'Seizure Analysis & Clinical',
    description: 'Focus localization, dynamic connectivity, lead-lag.',
  },
  {
    id: 'evaluation',
    label: 'Publication Metrics',
    description: 'ROC/PR, manifolds, ablation studies.',
  },
];

// Chart entries are populated by individual chart modules importing
// `registerChart`. We keep the module side-effectful so each chart
// stays self-contained.
const _entries: ChartEntry[] = [];

export function registerChart(entry: ChartEntry) {
  if (_entries.some((e) => e.id === entry.id)) return;
  _entries.push(entry);
}

export function listCharts(): ChartEntry[] {
  return [..._entries].sort((a, b) =>
    a.category.localeCompare(b.category) || a.title.localeCompare(b.title),
  );
}

export function findChart(id: string): ChartEntry | undefined {
  return _entries.find((e) => e.id === id);
}
