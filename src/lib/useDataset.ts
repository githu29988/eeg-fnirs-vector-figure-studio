import { useContext } from 'react';
import { DatasetContext, type DatasetContextValue } from './dataset-context';

export function useDataset(): DatasetContextValue {
  const ctx = useContext(DatasetContext);
  if (!ctx) throw new Error('useDataset used outside <DatasetProvider>.');
  return ctx;
}
