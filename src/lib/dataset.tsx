/**
 * Provider component: spawns a parser Worker per upload and pushes
 * the result into a context. Hook lives in `useDataset.ts`.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { DatasetContext, type LoadStatus } from './dataset-context';
import type { WorkerResponse } from '../workers/dataParser.worker';

function spawnWorker(): Worker {
  return new Worker(
    new URL('../workers/dataParser.worker.ts', import.meta.url),
    { type: 'module' },
  );
}

export function DatasetProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LoadStatus>({ kind: 'idle' });

  const load = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setStatus({ kind: 'loading', files: files.map((f) => f.name) });
    const worker = spawnWorker();
    await new Promise<void>((resolve) => {
      const finish = () => {
        worker.terminate();
        resolve();
      };
      worker.addEventListener(
        'message',
        (event: MessageEvent<WorkerResponse>) => {
          const msg = event.data;
          if (msg.kind === 'parsed') {
            setStatus({ kind: 'loaded', dataset: msg.dataset });
          } else {
            setStatus({ kind: 'error', message: msg.message });
          }
          finish();
        },
        { once: true },
      );
      // Worker module-load failures and uncaught crashes never
      // post a `message`; without an `error` listener the UI
      // would stay stuck in `loading`.
      worker.addEventListener(
        'error',
        (e) => {
          setStatus({
            kind: 'error',
            message: e.message || 'Worker crashed unexpectedly.',
          });
          finish();
        },
        { once: true },
      );
      worker.addEventListener(
        'messageerror',
        () => {
          setStatus({
            kind: 'error',
            message: 'Worker returned a message that could not be deserialised.',
          });
          finish();
        },
        { once: true },
      );
      worker.postMessage({ kind: 'parse', files });
    });
  }, []);

  const clear = useCallback(() => {
    setStatus({ kind: 'idle' });
  }, []);

  const value = useMemo(
    () => ({ status, load, clear }),
    [status, load, clear],
  );

  return (
    <DatasetContext.Provider value={value}>{children}</DatasetContext.Provider>
  );
}
