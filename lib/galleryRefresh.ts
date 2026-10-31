// "This event's photos changed — reload the gallery when you return."
// The event screen stays alive while another screen sits on top of it (the
// root layout is a Stack since 2026-11-01), so it does not rebuild itself on
// return. Screens that change its photos mark the event; the event screen
// checks the mark when it comes back into view and reloads once (it does not
// reload on every return, to keep the "New" badges and scroll position).
// Marked by: the Recycle bin after a Restore (2026-10-30); Guest Uploads after
// a delete and Manage Guests after a block / unblock (2026-11-01).
const changedEvents = new Set<string>();

export function markGalleryChanged(slug: string): void {
  changedEvents.add(slug);
}

/** The Recycle bin's name for the same mark. */
export const markGalleryRestored = markGalleryChanged;

/** True once per mark, then cleared. */
export function consumeGalleryRestored(slug: string): boolean {
  return changedEvents.delete(slug);
}
