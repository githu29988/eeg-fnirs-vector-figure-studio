/**
 * BIDS sidecar metadata parser.
 *
 * BIDS itself is a directory-layout standard rather than a binary
 * format. Numeric data lives in EDF / SNIRF / NIfTI etc., next to
 * sidecars:
 *
 *   sub-01/eeg/
 *     sub-01_task-rest_eeg.edf
 *     sub-01_task-rest_eeg.json        # task / sampling metadata
 *     sub-01_task-rest_channels.tsv    # per-channel info
 *     sub-01_task-rest_electrodes.tsv  # electrode positions
 *     sub-01_task-rest_coordsystem.json
 *
 * We parse the TSVs and JSONs as plain text — no schema validation
 * (downstream code degrades gracefully if a column is missing).
 */

export interface BidsChannelRow {
  name: string;
  type?: string;
  units?: string;
  status?: string;
  /** All other columns the file ships, keyed by header. */
  extra: Record<string, string>;
}

export interface BidsElectrodeRow {
  name: string;
  x?: number;
  y?: number;
  z?: number;
  type?: string;
  extra: Record<string, string>;
}

export interface BidsTaskMeta {
  /** From `*_eeg.json` / `*_nirs.json`. */
  taskName?: string;
  samplingFrequency?: number;
  powerLineFrequency?: number;
  manufacturer?: string;
  /** All other top-level keys from the JSON. */
  extra: Record<string, unknown>;
}

function parseTsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split('\t').map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = (cols[j] ?? '').trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

function numericOrUndefined(s: string | undefined): number | undefined {
  if (s === undefined || s === '' || s.toLowerCase() === 'n/a') return undefined;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : undefined;
}

export function parseChannelsTsv(text: string): BidsChannelRow[] {
  const { headers, rows } = parseTsv(text);
  return rows.map((row) => {
    const extra: Record<string, string> = {};
    for (const h of headers) {
      if (!['name', 'type', 'units', 'status'].includes(h)) {
        extra[h] = row[h];
      }
    }
    return {
      name: row.name ?? '',
      type: row.type,
      units: row.units,
      status: row.status,
      extra,
    };
  });
}

export function parseElectrodesTsv(text: string): BidsElectrodeRow[] {
  const { headers, rows } = parseTsv(text);
  return rows.map((row) => {
    const extra: Record<string, string> = {};
    for (const h of headers) {
      if (!['name', 'x', 'y', 'z', 'type'].includes(h)) {
        extra[h] = row[h];
      }
    }
    return {
      name: row.name ?? '',
      x: numericOrUndefined(row.x),
      y: numericOrUndefined(row.y),
      z: numericOrUndefined(row.z),
      type: row.type,
      extra,
    };
  });
}

export function parseTaskJson(text: string): BidsTaskMeta {
  const obj = JSON.parse(text) as Record<string, unknown>;
  const num = (k: string): number | undefined => {
    const v = obj[k];
    return typeof v === 'number' ? v : undefined;
  };
  const str = (k: string): string | undefined => {
    const v = obj[k];
    return typeof v === 'string' ? v : undefined;
  };
  return {
    taskName: str('TaskName'),
    samplingFrequency: num('SamplingFrequency'),
    powerLineFrequency: num('PowerLineFrequency'),
    manufacturer: str('Manufacturer'),
    extra: obj,
  };
}
