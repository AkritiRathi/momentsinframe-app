// ⭐ ALBUM EVENT — the words a person reads (2026-11-11, the user's decisions).
// One place for them, so the New event screen, its password + confirm boxes and
// the Event Settings card always say the same thing. The code and database keep
// the name photographers_photos (nobody sees it).
// Memory: project_photo_order_by_filename.md (the "DECIDED SPEC" + 2026-11-11 lines).

// Renamed "Complete event photos" 2026-11-11 (the user: "Go with “Complete
// event photos”"); was "Album event", before that "Photographer's photos".
export const ALBUM_EVENT_NAME = 'Complete event photos';

// The bullets when an Album event is chosen / on.
const COMMON = [
  'Photos are shown in file-name order.',
  'Only you and your Admins can upload. Only you can delete.',
  'Each guest sees only the photos they are in, found with Find My Photos.',
  'You can show all photos to everyone at any time.',
];
// While creating the event.
export const ALBUM_EVENT_BULLETS_CREATE = [...COMMON, 'This cannot be changed after the event is created.'];
// In Event Settings, once created.
export const ALBUM_EVENT_BULLETS_SETTINGS = [...COMMON, 'Chosen when the event was created. It can\'t be changed.'];

// The line under the switch when it is OFF — the user's own wording.
export const ALBUM_EVENT_OFF_LINE = 'Event settings can be changed from Organiser login → Manage Event → Event Settings.';

// Settings that do not apply in an Album event.
export const ALBUM_EVENT_NOT_USED = 'Not used with Complete event photos.';

// Manage Event → Admins, in a Complete event photos event (2026-11-12, the
// user's "Yes"): Admins upload, only the Organiser deletes, View only is not
// used — so the normal "Admins can delete…" and "Upload even when the event is
// view-only" lines would be wrong here. Normal events keep their own wording.
export const ALBUM_EVENT_ADMIN_PANEL_LINE = 'Admins can upload photos. Only you can delete photos in this event. They join using the event code, just like other guests.';
export const ALBUM_EVENT_ADMIN_POWERS =
  '• Upload photos (only you can delete photos in this event)\n' +
  '• Block a guest from this event\n' +
  "• See guests' names and phone numbers\n\n";
