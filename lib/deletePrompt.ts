import { deletePhotos } from './api';

// ⭐ THE APP'S ONE DELETE QUESTION + ACTION (2026-10-30, the user's yes: "make
// delete universal"). ALL FOUR Delete buttons call this — event screen
// lightbox and select-many, Guest Uploads lightbox and select-many — so the
// choices and wording cannot drift apart. Same code on iPhone and Android;
// the website has its twin (onealbum-trial src/lib/delete-photos-prompt.ts) —
// keep the wording in step. Each screen keeps its own after-delete steps.
//
// The three choices (the user, 2026-10-30), in this order:
//   Move to Recycle bin — main button (first). Restorable for 30 days from
//                         the event's ⋮ menu → Recycle bin.
//   Delete permanently  — red. TODAY'S delete, unchanged.
//   Cancel              — last.

type AlertButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
type ShowAlert = (title: string, message?: string, buttons?: AlertButton[]) => void;

export function askAndDeletePhotos(opts: {
  slug: string;
  photoIds: string[];
  showAlert: ShowAlert;
  /** Runs only after the server confirmed the delete. */
  onDeleted: (mode: 'recycle' | 'permanent') => void | Promise<void>;
  /** Busy on/off while the request runs (optional). */
  setBusy?: (busy: boolean) => void;
}): void {
  const { slug, photoIds, showAlert, onDeleted, setBusy } = opts;
  if (photoIds.length === 0) return;
  const one = photoIds.length === 1;

  const run = async (recycle: boolean) => {
    setBusy?.(true);
    try {
      // One call; the server reads the caller from the login token and
      // decides every permission itself.
      const result = await deletePhotos(slug, photoIds, recycle);
      if (result?.error) { showAlert('Error', result.error); return; }
      await onDeleted(recycle ? 'recycle' : 'permanent');
    } catch {
      showAlert('Something went wrong', 'Please try again.');
    } finally {
      setBusy?.(false);
    }
  };

  showAlert(
    one ? 'Delete this photo?' : `Delete ${photoIds.length} photos?`,
    // Short on purpose (the user, 2026-10-31: "everyone knows what Recycle bin is").
    'Deleting permanently cannot be undone.',
    [
      { text: 'Move to Recycle bin', onPress: () => { void run(true); } },
      // ⛔ ASKS AGAIN before a permanent delete (the user, 2026-10-31: "When I
      // select Delete permanently, the user is not given a choice"). Same
      // question as the Recycle bin page. Move to Recycle bin stays one tap.
      { text: 'Delete permanently', style: 'destructive', onPress: () => {
        showAlert('Delete permanently?', 'This cannot be undone.', [
          { text: 'Delete permanently', style: 'destructive', onPress: () => { void run(false); } },
          { text: 'Cancel', style: 'cancel' },
        ]);
      } },
      { text: 'Cancel', style: 'cancel' },
    ],
  );
}
