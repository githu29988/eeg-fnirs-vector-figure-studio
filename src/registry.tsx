import type { ComponentType } from 'react';

export interface ChartCategory {
  id: string;
  label: string;
  description?: string;
}

export interface ChartEntry {
  /** URL slug. */
  id: string;
  /** 显示名称（中文）。 */
  title: string;
  /** 可选的英文名称，需要中英双语时使用。 */
  titleEn?: string;
  /** Short summary shown in the sidebar. */
  summary: string;
  category: ChartCategory['id'];
  component: ComponentType;
  /** Marks charts that are still under development. */
  status?: 'stable' | 'wip';
}

export const CATEGORIES: ChartCategory[] = [
  { id: 'overview', label: '总览' },
  {
    id: 'architecture',
    label: '模型架构',
    description: '网络拓扑、融合逻辑与张量流动。',
  },
  {
    id: 'physiology',
    label: '神经生理与拓扑',
    description: '传感器空间、神经血管耦合、皮层投影。',
  },
  {
    id: 'clinical',
    label: '癫痫分析与临床',
    description: '病灶定位、动态连接、超前–滞后。',
  },
  {
    id: 'evaluation',
    label: '发表与评估指标',
    description: 'ROC/PR、特征流形、消融实验。',
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
