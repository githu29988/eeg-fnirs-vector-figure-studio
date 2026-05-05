/**
 * Generic auto-save / auto-load helper for chart configurations.
 *
 * Behaviour:
 *   - Every `intervalMs` (default 5 min), the current state is compared
 *     against the last persisted snapshot. If different, a new slot is
 *     created with an auto-generated name like `auto-#3 (2026-04-28 02:02)`
 *     and persisted alongside any user-defined slots.
 *   - On chart mount, if `autoLoadLatest` is enabled and `slots` already
 *     contains entries, the most recently saved slot (auto or manual) is
 *     applied via `applyConfig`.
 *
 * Slots are stored as a `Record<slotName, ConfigT>` in localStorage under
 * `storageKey`. A small companion record `<storageKey>:meta` tracks per-
 * slot timestamps used for "latest" resolution.
 */

import { useEffect, useRef } from 'react';

export interface SlotMeta {
  /** Epoch ms when this slot was last saved or loaded. */
  ts: number;
  /** True when slot was created by the auto-save loop. */
  auto?: boolean;
}

export type SlotMetaMap = Record<string, SlotMeta>;

export interface UseAutoSaveOptions<ConfigT> {
  /** Stable id for this chart, used to namespace metadata. */
  storageKey: string;
  /** Current config snapshot — must be JSON-serialisable. */
  current: ConfigT;
  /** Existing slot map (managed by the chart). */
  slots: Record<string, ConfigT>;
  /** Setter that persists a new slot map (manual + auto entries). */
  onPersistSlots: (next: Record<string, ConfigT>) => void;
  /** Apply a config snapshot to chart state. Used for auto-load. */
  applyConfig: (cfg: ConfigT) => void;
  /** Auto-save interval in ms; default 5 minutes. */
  intervalMs?: number;
  /** Auto-load the latest slot on mount. Default true. */
  autoLoadLatest?: boolean;
  /** Disable the entire hook (handy for tests / SSR). */
  enabled?: boolean;
}

const META_SUFFIX = ':meta';

function readMeta(storageKey: string): SlotMetaMap {
  try {
    const raw = localStorage.getItem(storageKey + META_SUFFIX);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SlotMetaMap;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function writeMeta(storageKey: string, meta: SlotMetaMap) {
  try {
    localStorage.setItem(storageKey + META_SUFFIX, JSON.stringify(meta));
  } catch {
    // quota / unavailable — silent no-op
  }
}

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

function formatTimestamp(d: Date): string {
  const Y = d.getFullYear();
  const M = pad(d.getMonth() + 1);
  const D = pad(d.getDate());
  const h = pad(d.getHours());
  const m = pad(d.getMinutes());
  return `${Y}-${M}-${D} ${h}:${m}`;
}

function nextAutoIndex(slots: Record<string, unknown>): number {
  let maxIdx = 0;
  for (const name of Object.keys(slots)) {
    const m = name.match(/^auto-#(\d+)/);
    if (m) {
      const n = Number(m[1]);
      if (n > maxIdx) maxIdx = n;
    }
  }
  return maxIdx + 1;
}

/** Stable JSON stringify that ignores key order for top-level objects. */
function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ':' +
          stableStringify((obj as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}

/**
 * Find the most recent slot using the meta table. Falls back to the most
 * recently-listed key in `slots` if no metadata exists (for back-compat
 * with charts that pre-date this hook).
 */
export function findLatestSlot<ConfigT>(
  storageKey: string,
  slots: Record<string, ConfigT>,
): string | null {
  const names = Object.keys(slots);
  if (names.length === 0) return null;
  const meta = readMeta(storageKey);
  let bestName: string | null = null;
  let bestTs = -1;
  for (const name of names) {
    const ts = meta[name]?.ts ?? 0;
    if (ts > bestTs) {
      bestTs = ts;
      bestName = name;
    }
  }
  return bestName ?? names[names.length - 1];
}

/** Touch the timestamp on a slot so it counts as "most recent". */
export function touchSlot(
  storageKey: string,
  name: string,
  opts?: { auto?: boolean },
) {
  const meta = readMeta(storageKey);
  meta[name] = { ts: Date.now(), auto: opts?.auto };
  writeMeta(storageKey, meta);
}

export function useAutoSave<ConfigT>(opts: UseAutoSaveOptions<ConfigT>) {
  const {
    storageKey,
    current,
    slots,
    onPersistSlots,
    applyConfig,
    intervalMs = 5 * 60 * 1000,
    autoLoadLatest = true,
    enabled = true,
  } = opts;

  // Refs keep the loop in sync with the latest state without retriggering
  // on every keystroke.
  const currentRef = useRef(current);
  const slotsRef = useRef(slots);
  const onPersistRef = useRef(onPersistSlots);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const didAutoLoadRef = useRef(false);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);
  useEffect(() => {
    onPersistRef.current = onPersistSlots;
  }, [onPersistSlots]);

  // Auto-load latest slot once on mount.
  useEffect(() => {
    if (!enabled || !autoLoadLatest || didAutoLoadRef.current) return;
    didAutoLoadRef.current = true;
    const latest = findLatestSlot(storageKey, slotsRef.current);
    if (latest && slotsRef.current[latest]) {
      applyConfig(slotsRef.current[latest]);
      // Don't bump timestamp here — auto-load shouldn't promote a slot
      // ahead of a slot the user just saved.
      // Snapshot *after* apply settles (next tick) so we don't immediately
      // re-save what we just loaded.
      Promise.resolve().then(() => {
        lastSavedSnapshotRef.current = stableStringify(currentRef.current);
      });
    } else {
      lastSavedSnapshotRef.current = stableStringify(currentRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, autoLoadLatest, storageKey]);

  // Periodic diff-and-save loop.
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const snap = stableStringify(currentRef.current);
      if (snap === lastSavedSnapshotRef.current) return;
      const idx = nextAutoIndex(slotsRef.current);
      const ts = formatTimestamp(new Date());
      const name = `auto-#${idx} (${ts})`;
      const next = { ...slotsRef.current, [name]: currentRef.current };
      onPersistRef.current(next);
      touchSlot(storageKey, name, { auto: true });
      lastSavedSnapshotRef.current = snap;
    };
    const handle = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(handle);
  }, [enabled, intervalMs, storageKey]);
}
