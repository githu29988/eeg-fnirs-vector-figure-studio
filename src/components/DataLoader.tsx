/**
 * Data ingestion drop zone. Accepts EDF + BIDS sidecar files via
 * either the file picker or drag-and-drop, hands them to the worker
 * via `useDataset`, and renders status (idle / loading / error /
 * loaded). When loaded, charts that opt in (currently the topomap)
 * can read the parsed channel array from `useDataset`.
 */
import { useCallback, useRef, useState } from 'react';
import { useDataset } from '../lib/useDataset';

export function DataLoader() {
  const { status, load, clear } = useDataset();
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFiles = useCallback(
    (files: FileList | File[] | null) => {
      if (!files) return;
      const arr = Array.from(files);
      if (arr.length === 0) return;
      void load(arr);
    },
    [load],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      onFiles(e.dataTransfer.files);
    },
    [onFiles],
  );

  return (
    <section className="rounded-lg border border-ink-700 bg-ink-900 p-4">
      <header className="mb-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink-300">
          Data ingestion
        </p>
        <p className="text-[11px] text-ink-300">
          Drop an EDF / BIDS bundle to drive supported figures with real
          recordings. Synthetic data is used otherwise.
        </p>
      </header>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={
          'flex flex-col items-stretch gap-2 rounded border border-dashed p-4 text-[12px] transition-colors ' +
          (dragActive
            ? 'border-accent bg-ink-800 text-ink-50'
            : 'border-ink-600 bg-ink-950 text-ink-200')
        }
      >
        <p className="text-center text-ink-300">
          Drop <code>.edf</code> + optional <code>_channels.tsv</code> /{' '}
          <code>_electrodes.tsv</code> / <code>_eeg.json</code> here
        </p>
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded border border-ink-600 bg-ink-800 px-3 py-1 text-[11px] uppercase tracking-wider text-ink-100 hover:border-ink-500 hover:bg-ink-700"
          >
            Choose files
          </button>
          {status.kind === 'loaded' || status.kind === 'error' ? (
            <button
              type="button"
              onClick={clear}
              className="rounded border border-ink-600 bg-ink-800 px-3 py-1 text-[11px] uppercase tracking-wider text-ink-100 hover:border-ink-500 hover:bg-ink-700"
            >
              Clear
            </button>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".edf,.tsv,.json"
          className="hidden"
          onChange={(e) => onFiles(e.target.files)}
        />
      </div>

      <div className="mt-3 text-[11px]">
        {status.kind === 'idle' ? (
          <p className="text-ink-300">Status: synthetic data (no file loaded).</p>
        ) : null}
        {status.kind === 'loading' ? (
          <p className="text-ink-100">
            Parsing {status.files.length} file
            {status.files.length === 1 ? '' : 's'}…
          </p>
        ) : null}
        {status.kind === 'error' ? (
          <p className="text-rose-400">Error: {status.message}</p>
        ) : null}
        {status.kind === 'loaded' ? (
          <div className="space-y-1 text-ink-100">
            <p>
              Loaded <span className="font-mono">{status.dataset.variant}</span> ·{' '}
              {status.dataset.channels.length} numeric channel
              {status.dataset.channels.length === 1 ? '' : 's'} from{' '}
              {status.dataset.fileNames.join(', ')}
            </p>
            {status.dataset.bidsTask?.taskName ? (
              <p className="text-ink-300">
                Task: {status.dataset.bidsTask.taskName}
              </p>
            ) : null}
            {status.dataset.notes.length > 0 ? (
              <ul className="list-disc pl-5 text-[10px] text-ink-300">
                {status.dataset.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
