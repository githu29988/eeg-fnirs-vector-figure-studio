/**
 * EDF / EDF+ parser (browser-friendly, zero dependencies).
 *
 * Spec: https://www.edfplus.info/specs/edf.html
 *
 * Layout:
 *   - 256-byte fixed ASCII header (version, patient/recording IDs,
 *     start date/time, header size, reserved, ndr, record duration,
 *     ns).
 *   - ns × 256 bytes of per-signal headers (label, transducer,
 *     physical dim/min/max, digital min/max, prefiltering, samples
 *     per record, reserved).
 *   - ndr × Σ(samples_per_record) int16-LE samples, interleaved by
 *     signal (one record at a time).
 *
 * We decode the full file into Float32Array channels using the
 * standard digital→physical linear transform and return one channel
 * per signal. EDF+ annotations (which appear as a `EDF Annotations`
 * pseudo-channel) are skipped from the numeric channel list but the
 * parser does not crash.
 */

export interface EdfSignalHeader {
  /** Channel label (e.g. "Fp1"). */
  label: string;
  transducer: string;
  /** Physical units, e.g. "uV". */
  physicalDim: string;
  physicalMin: number;
  physicalMax: number;
  digitalMin: number;
  digitalMax: number;
  prefiltering: string;
  /** Samples in one data record for this signal. */
  samplesPerRecord: number;
}

export interface EdfChannel extends EdfSignalHeader {
  /** Effective sampling rate (Hz). */
  fs: number;
  /** Decoded physical samples for this channel. */
  samples: Float32Array;
}

export interface EdfFile {
  /** EDF / EDF+C / EDF+D variant string from the reserved field. */
  variant: string;
  patientId: string;
  recordingId: string;
  startDate: string;
  startTime: string;
  /** Number of data records. */
  ndr: number;
  /** Duration of one data record in seconds. */
  recordDuration: number;
  /** Numeric channels (annotation channels filtered out). */
  channels: EdfChannel[];
}

function readAscii(view: Uint8Array, offset: number, length: number): string {
  return new TextDecoder('ascii')
    .decode(view.subarray(offset, offset + length))
    .trim();
}

function readInt(view: Uint8Array, offset: number, length: number): number {
  const v = parseInt(readAscii(view, offset, length), 10);
  return Number.isFinite(v) ? v : 0;
}

function readFloat(view: Uint8Array, offset: number, length: number): number {
  const v = parseFloat(readAscii(view, offset, length));
  return Number.isFinite(v) ? v : 0;
}

export function parseEdf(buffer: ArrayBuffer): EdfFile {
  const u8 = new Uint8Array(buffer);
  if (u8.length < 256) {
    throw new Error(`EDF too short: ${u8.length} bytes (need ≥ 256).`);
  }

  // Fixed header.
  const variant = readAscii(u8, 192, 44) || 'EDF';
  const patientId = readAscii(u8, 8, 80);
  const recordingId = readAscii(u8, 88, 80);
  const startDate = readAscii(u8, 168, 8);
  const startTime = readAscii(u8, 176, 8);
  const headerBytes = readInt(u8, 184, 8);
  const ndr = readInt(u8, 236, 8);
  const recordDuration = readFloat(u8, 244, 8);
  const ns = readInt(u8, 252, 4);

  if (ns <= 0) throw new Error('EDF header: ns must be positive.');
  if (headerBytes !== 256 + ns * 256) {
    throw new Error(
      `EDF header size mismatch: expected ${256 + ns * 256}, got ${headerBytes}.`,
    );
  }

  // Per-signal headers (each field repeats ns times).
  const labels: string[] = [];
  const transducers: string[] = [];
  const physDims: string[] = [];
  const physMins: number[] = [];
  const physMaxs: number[] = [];
  const digMins: number[] = [];
  const digMaxs: number[] = [];
  const prefilts: string[] = [];
  const samplesPerRec: number[] = [];

  let off = 256;
  for (let i = 0; i < ns; i++) labels.push(readAscii(u8, off + i * 16, 16));
  off += ns * 16;
  for (let i = 0; i < ns; i++) transducers.push(readAscii(u8, off + i * 80, 80));
  off += ns * 80;
  for (let i = 0; i < ns; i++) physDims.push(readAscii(u8, off + i * 8, 8));
  off += ns * 8;
  for (let i = 0; i < ns; i++) physMins.push(readFloat(u8, off + i * 8, 8));
  off += ns * 8;
  for (let i = 0; i < ns; i++) physMaxs.push(readFloat(u8, off + i * 8, 8));
  off += ns * 8;
  for (let i = 0; i < ns; i++) digMins.push(readInt(u8, off + i * 8, 8));
  off += ns * 8;
  for (let i = 0; i < ns; i++) digMaxs.push(readInt(u8, off + i * 8, 8));
  off += ns * 8;
  for (let i = 0; i < ns; i++) prefilts.push(readAscii(u8, off + i * 80, 80));
  off += ns * 80;
  for (let i = 0; i < ns; i++) samplesPerRec.push(readInt(u8, off + i * 8, 8));
  // The trailing 32-byte-per-signal "reserved" block is ignored.

  // Data: int16-LE, interleaved by signal per record.
  const dataStart = headerBytes;
  const recordSampleCount = samplesPerRec.reduce((a, b) => a + b, 0);
  const expectedDataBytes = ndr * recordSampleCount * 2;
  if (u8.length - dataStart < expectedDataBytes) {
    throw new Error(
      `EDF data truncated: header expects ${expectedDataBytes} bytes, file has ${u8.length - dataStart}.`,
    );
  }

  const dv = new DataView(buffer, dataStart, expectedDataBytes);
  // Pre-allocate per-channel typed arrays.
  const decoded: Float32Array[] = samplesPerRec.map(
    (s) => new Float32Array(s * ndr),
  );
  // Per-channel digital→physical scale + offset.
  const scale = samplesPerRec.map((_, i) => {
    const pSpan = physMaxs[i] - physMins[i];
    const dSpan = digMaxs[i] - digMins[i] || 1;
    return pSpan / dSpan;
  });
  const intercept = samplesPerRec.map(
    (_, i) => physMins[i] - digMins[i] * scale[i],
  );

  // Walk records.
  let byteOff = 0;
  const writeIdx = new Array<number>(ns).fill(0);
  for (let r = 0; r < ndr; r++) {
    for (let s = 0; s < ns; s++) {
      const n = samplesPerRec[s];
      const ch = decoded[s];
      let wi = writeIdx[s];
      const sc = scale[s];
      const ic = intercept[s];
      for (let k = 0; k < n; k++) {
        const v = dv.getInt16(byteOff, true);
        byteOff += 2;
        ch[wi++] = v * sc + ic;
      }
      writeIdx[s] = wi;
    }
  }

  // Annotation channels (EDF+) carry timestamped strings rather than
  // numeric data. The convention is to label them "EDF Annotations".
  // Drop them from the numeric channel list.
  const channels: EdfChannel[] = [];
  for (let i = 0; i < ns; i++) {
    if (labels[i].toLowerCase().startsWith('edf annotations')) continue;
    const fs = recordDuration > 0 ? samplesPerRec[i] / recordDuration : 0;
    channels.push({
      label: labels[i],
      transducer: transducers[i],
      physicalDim: physDims[i],
      physicalMin: physMins[i],
      physicalMax: physMaxs[i],
      digitalMin: digMins[i],
      digitalMax: digMaxs[i],
      prefiltering: prefilts[i],
      samplesPerRecord: samplesPerRec[i],
      fs,
      samples: decoded[i],
    });
  }

  return {
    variant,
    patientId,
    recordingId,
    startDate,
    startTime,
    ndr,
    recordDuration,
    channels,
  };
}
