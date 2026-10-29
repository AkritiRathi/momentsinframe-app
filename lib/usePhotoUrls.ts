// ⛔ IMAGE ADDRESSES, LOADED AS NEEDED (2026-10-29, the user's yes — plan C).
//
// The three grid screens (event, guest uploads, my photos) used to ask the
// server for the image address of EVERY photo the moment a screen opened —
// one request per 20 photos, all fired together — and on iPhone then
// downloaded EVERY thumbnail. At a 3,000-photo event that was ~150 requests
// per guest per open (again after each upload) and ~100 MB of thumbnails
// before anyone scrolled.
//
// Now a screen asks only for what it is about to show (the rows on screen and
// a few screens ahead, the lightbox photo and its neighbours). This one loader
// is shared by all three screens so they cannot drift apart:
//  - only ids not already loaded or on their way are asked for;
//  - 20 per request (the server's own limit), at most 3 requests at a time;
//  - the NEWEST ask goes first, so what is on screen now beats what was
//    scrolled past;
//  - a failed batch is simply asked for again next time it is needed (the old
//    code skipped it for good, leaving a blank tile);
//  - an address is kept until the photo's stored file changes. A replace by a
//    better copy writes a NEW thumbnail path and deletes the old files, so
//    `sync()` drops any address made for an older version.
// Addresses stay valid until the event expires (server: computeSignedUrlExpiry),
// so keeping them is safe.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { getPhotoUrls } from './api';

export type PhotoUrls = {
  thumbUrl: string | null;
  displayUrl: string | null;
  url: string | null;
  originalFilename: string | null;
};

const PER_REQUEST = 20;   // photo-urls answers at most 20 per call
const MAX_IN_FLIGHT = 3;
// Only the newest asks are kept waiting; a long fast scroll drops the oldest,
// which are simply asked for again if the guest scrolls back to them.
const MAX_WAITING = 200;

// A photo as the gallery lists it — the thumbnail path changes on every replace.
type VersionedPhoto = { id: string; thumbnail_path?: string | null };

export function usePhotoUrls(slug: string, getPhone: () => string | undefined) {
  const [urls, setUrls] = useState<Record<string, PhotoUrls>>({});
  const loaded = useRef(new Map<string, string>());     // id → version it was made for
  const inFlight = useRef(new Set<string>());
  const queue = useRef<string[]>([]);
  const running = useRef(0);
  const versions = useRef(new Map<string, string>());   // id → current version
  const alive = useRef(true);
  const phoneRef = useRef(getPhone);
  phoneRef.current = getPhone;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const pump = useCallback(() => {
    while (running.current < MAX_IN_FLIGHT && queue.current.length > 0) {
      const batch: string[] = [];
      while (batch.length < PER_REQUEST && queue.current.length > 0) {
        const id = queue.current.shift()!;
        if (loaded.current.has(id) || inFlight.current.has(id)) continue;
        batch.push(id);
        inFlight.current.add(id);
      }
      if (batch.length === 0) break;
      running.current++;
      const asked = new Map(batch.map(id => [id, versions.current.get(id) ?? '']));
      getPhotoUrls(slug, batch, phoneRef.current())
        .then((result: { urls?: Record<string, PhotoUrls> }) => {
          if (!alive.current || !result?.urls) return;
          // Keep only answers for the photo's CURRENT version: if the gallery
          // reloaded while this was on its way and the photo was replaced, the
          // answer points at deleted files — drop it; it is asked for afresh.
          const got: Record<string, PhotoUrls> = {};
          for (const [id, u] of Object.entries(result.urls)) {
            if ((asked.get(id) ?? '') !== (versions.current.get(id) ?? '')) continue;
            got[id] = u;
            loaded.current.set(id, asked.get(id) ?? '');
          }
          if (Object.keys(got).length === 0) return;
          setUrls(prev => ({ ...prev, ...got }));
          // iPhone: warm the cache for THESE thumbnails only — they are the
          // ones about to be on screen.
          if (Platform.OS === 'ios') {
            const thumbs = Object.values(got).map(u => u.thumbUrl).filter(Boolean) as string[];
            if (thumbs.length > 0) ExpoImage.prefetch(thumbs);
          }
        })
        .catch(() => { /* not marked loaded → asked again when next needed */ })
        .finally(() => {
          batch.forEach(id => inFlight.current.delete(id));
          running.current--;
          if (alive.current) pump();
        });
    }
  }, [slug]);

  // Ask for these ids (most important first). Already loaded or on the way:
  // nothing happens, so screens can call this as often as they like.
  const request = useCallback((ids: string[]) => {
    const fresh = ids.filter(id => id && !loaded.current.has(id) && !inFlight.current.has(id));
    if (fresh.length === 0) return;
    const front = new Set(fresh);
    queue.current = [...fresh, ...queue.current.filter(id => !front.has(id))].slice(0, MAX_WAITING);
    pump();
  }, [pump]);

  // Tell the loader which photos exist now, with their versions. Addresses
  // made for an older version of a photo (it was replaced by a better copy)
  // are dropped, so the next request fetches the new one.
  const sync = useCallback((photos: VersionedPhoto[]) => {
    const stale: string[] = [];
    for (const p of photos) {
      const v = p.thumbnail_path ?? '';
      versions.current.set(p.id, v);
      const had = loaded.current.get(p.id);
      if (had !== undefined && had !== v) stale.push(p.id);
    }
    if (stale.length === 0) return;
    stale.forEach(id => loaded.current.delete(id));
    setUrls(prev => {
      const next = { ...prev };
      stale.forEach(id => { delete next[id]; });
      return next;
    });
  }, []);

  return { urls, request, sync };
}

// For a grid built as rows: the photo ids of the rows from `first` to `last`,
// plus `ahead` rows below and `behind` rows above — in that order of
// importance (on screen first).
export function idsAroundRows<T>(
  rows: T[],
  first: number,
  last: number,
  idsOf: (row: T) => string[],
  ahead = 12,
  behind = 3,
): string[] {
  const out: string[] = [];
  const take = (from: number, to: number) => {
    for (let i = Math.max(0, from); i <= Math.min(rows.length - 1, to); i++) out.push(...idsOf(rows[i]));
  };
  take(first, last);
  take(last + 1, last + ahead);
  take(first - behind, first - 1);
  return out;
}
