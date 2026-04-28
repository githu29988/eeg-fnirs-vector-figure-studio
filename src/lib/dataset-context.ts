/**
 * Context object + types for the dataset provider, split out of
 * dataset.tsx so the .tsx file only exports a component (Vite fast
 * refresh requires this).
 */
import { createContext } from 'react';
import type { ParsedDataset } from '../workers/dataParser.worker';

export type LoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; files: string[] }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; dataset: ParsedDataset };

export interface DatasetContextValue {
  status: LoadStatus;
  load: (files: File[]) => Promise<void>;
  clear: () => void;
}

export const DatasetContext = createContext<DatasetContextValue | null>(null);
