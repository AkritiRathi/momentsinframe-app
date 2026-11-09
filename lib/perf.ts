// ⏱ TEMPORARY PERFORMANCE TIMER (2026-11-09, the user's "Yes") — ⛔ REMOVE
// BEFORE THE LAUNCH (the user: "We can remove all the timers before be launch
// the app"). The app's download, search, gallery and full-screen photo
// timings, sent to /api/upload-timing (logged as PERF_TIMING). Counts, sizes
// and times only — never a name, phone number or photo id. Fire and forget:
// nothing here is awaited by what it measures, and every failure is ignored.
// Every timer and the removal checklist: memory project_performance_tests.md.
import { AppState, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { reportUploadTiming } from './api';

type Line = Record<string, string | number | null | undefined>;

export function reportPerf(screen: string, line: Line): void {
  try {
    const clean: Record<string, string | number | null> = {};
    for (const [k, val] of Object.entries(line)) clean[k] = val === undefined ? null : val;
    reportUploadTiming({ src: `${Platform.OS}-${screen}`, ...clean });
  } catch { /* never fail */ }
}

// A ZIP that has just arrived on the phone: its size is read from the file.
export function perfZipArrived(screen: string, uri: string, ms: number): void {
  FileSystem.getInfoAsync(uri)
    .then(i => reportPerf(screen, { kind: 'download', op: 'zip-dl', kb: i.exists && 'size' in i ? Math.round((i as { size: number }).size / 1024) : null, ms }))
    .catch(() => reportPerf(screen, { kind: 'download', op: 'zip-dl', ms }));
}

const stat = (a: number[]) => {
  if (!a.length) return { med: null, p90: null, max: null };
  const s = [...a].sort((x, y) => x - y);
  return { med: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1] };
};

// Gallery thumbnails + the full-screen photo, summarised: one line every
// 30 s and when the app goes to the background — never one line per photo.
// ⚠ iPhone warms its thumbnail cache ahead of the grid (lib/usePhotoUrls.ts),
// so iPhone thumbnail times can read near zero; the address requests (urlMs)
// and "first screen shown" (firstMs) are the useful iPhone numbers.
const FIRST_SCREEN = 12;
const v = {
  screen: '', t0: 0, listMs: null as number | null, firstMs: null as number | null, shown: 0,
  thumbs: [] as number[], starts: new Map<string, number>(), full: [] as number[], fullT0: 0,
  urlN: 0, urlMs: 0, started: false,
};

function flush() {
  if (!v.screen) return;
  if (v.thumbs.length || v.urlN || v.listMs !== null) {
    reportPerf(v.screen, { kind: 'view', op: 'gallery', n: v.thumbs.length, ...stat(v.thumbs), firstMs: v.firstMs, listMs: v.listMs, urlN: v.urlN, urlMs: v.urlMs });
  }
  if (v.full.length) reportPerf(v.screen, { kind: 'view', op: 'full', n: v.full.length, ...stat(v.full) });
  v.thumbs = []; v.full = []; v.urlN = 0; v.urlMs = 0; v.listMs = null; v.firstMs = null;
}

export const perfView = {
  open(screen: string) {
    flush();
    v.screen = screen; v.t0 = Date.now(); v.shown = 0; v.starts.clear();
    if (!v.started) {
      v.started = true;
      setInterval(flush, 30000);
      AppState.addEventListener('change', s => { if (s !== 'active') flush(); });
    }
  },
  listLoaded() { if (v.t0) v.listMs = Date.now() - v.t0; },
  urlBatch(n: number, ms: number) { v.urlN += n; v.urlMs += ms; },
  thumbStart(uri: string | null | undefined) {
    if (!uri) return;
    if (v.starts.size > 500) v.starts.clear();
    v.starts.set(uri, Date.now());
  },
  thumbLoaded(uri: string | null | undefined) {
    v.shown++;
    if (v.shown === FIRST_SCREEN && v.t0 && v.firstMs === null) v.firstMs = Date.now() - v.t0;
    const s = uri ? v.starts.get(uri) : undefined;
    if (s) { v.thumbs.push(Date.now() - s); v.starts.delete(uri!); }
  },
  fullLoading(loading: boolean) {
    if (loading) v.fullT0 = Date.now();
    else if (v.fullT0) { v.full.push(Date.now() - v.fullT0); v.fullT0 = 0; }
  },
};
