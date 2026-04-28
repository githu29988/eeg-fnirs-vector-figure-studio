/**
 * Off-main-thread parser for EDF and BIDS sidecar files.
 *
 * The worker accepts a list of dropped File objects (via structured
 * cloning — File is transferable). It detects the kind of each file
 * by extension, parses, and posts back a `ParsedDataset` summary.
 *
 * SNIRF parsing is intentionally not in this PR — it requires
 * h5wasm and a 2 MB+ runtime cost. Tracked as follow-up.
 */
import { parseEdf } from '../lib/edf';
import {
  parseChannelsTsv,
  parseElectrodesTsv,
  parseTaskJson,
  type BidsChannelRow,
  type BidsElectrodeRow,
  type BidsTaskMeta,
} from '../lib/bids';

export interface ParsedChannel {
  label: string;
  fs: number;
  /** Decoded physical samples. Transferred zero-copy to the main thread. */
  samples: Float32Array;
  unit: string;
  type: string;
}

export interface ParsedDataset {
  /** EDF / EDF+ variant string, or "unknown". */
  variant: string;
  /** Numeric channels (annotation pseudo-channels filtered). */
  channels: ParsedChannel[];
  /** Per-channel BIDS sidecar info, keyed by channel name. */
  bidsChannels?: BidsChannelRow[];
  /** Per-electrode BIDS sidecar info, keyed by electrode name. */
  bidsElectrodes?: BidsElectrodeRow[];
  /** Per-recording BIDS task JSON. */
  bidsTask?: BidsTaskMeta;
  /** File names actually consumed. */
  fileNames: string[];
  /** Diagnostic notes (unrecognised files, parse warnings, etc.). */
  notes: string[];
}

interface ParseRequest {
  kind: 'parse';
  files: File[];
}

interface ParseResponse {
  kind: 'parsed';
  dataset: ParsedDataset;
}

interface ErrorResponse {
  kind: 'error';
  message: string;
}

export type WorkerResponse = ParseResponse | ErrorResponse;

self.addEventListener('message', async (event: MessageEvent<ParseRequest>) => {
  if (event.data.kind !== 'parse') return;
  try {
    const dataset = await parseFiles(event.data.files);
    const transferables: ArrayBufferLike[] = dataset.channels.map(
      (c) => c.samples.buffer,
    );
    const response: ParseResponse = { kind: 'parsed', dataset };
    (self as unknown as Worker).postMessage(response, transferables);
  } catch (err) {
    const response: ErrorResponse = {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
});

async function parseFiles(files: File[]): Promise<ParsedDataset> {
  const notes: string[] = [];
  const consumed: string[] = [];

  let edfFile: File | undefined;
  let channelsTsv: File | undefined;
  let electrodesTsv: File | undefined;
  let taskJson: File | undefined;

  for (const f of files) {
    const name = f.name.toLowerCase();
    if (name.endsWith('.edf')) {
      if (edfFile) {
        notes.push(`Multiple EDF files dropped — using ${edfFile.name}, ignoring ${f.name}.`);
      } else {
        edfFile = f;
      }
    } else if (name.endsWith('_channels.tsv') || name === 'channels.tsv') {
      channelsTsv = f;
    } else if (name.endsWith('_electrodes.tsv') || name === 'electrodes.tsv') {
      electrodesTsv = f;
    } else if (name.endsWith('_eeg.json') || name.endsWith('_nirs.json')) {
      taskJson = f;
    } else if (name.endsWith('.snirf')) {
      notes.push(`SNIRF parsing is not yet supported in this build — ${f.name} skipped.`);
    } else {
      notes.push(`Skipping unrecognised file: ${f.name}.`);
    }
  }

  if (!edfFile) {
    throw new Error('No EDF file found in drop. Add a .edf file to load signals.');
  }

  const edfBuffer = await edfFile.arrayBuffer();
  const edf = parseEdf(edfBuffer);
  consumed.push(edfFile.name);

  const channels: ParsedChannel[] = edf.channels.map((c) => ({
    label: c.label,
    fs: c.fs,
    samples: c.samples,
    unit: c.physicalDim,
    type: c.transducer || 'unknown',
  }));

  const dataset: ParsedDataset = {
    variant: edf.variant,
    channels,
    fileNames: consumed,
    notes,
  };

  if (channelsTsv) {
    dataset.bidsChannels = parseChannelsTsv(await channelsTsv.text());
    consumed.push(channelsTsv.name);
  }
  if (electrodesTsv) {
    dataset.bidsElectrodes = parseElectrodesTsv(await electrodesTsv.text());
    consumed.push(electrodesTsv.name);
  }
  if (taskJson) {
    dataset.bidsTask = parseTaskJson(await taskJson.text());
    consumed.push(taskJson.name);
  }
  dataset.fileNames = consumed;
  return dataset;
}
