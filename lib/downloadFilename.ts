export function buildDownloadFilename(id: string, takenAt: string | null, ext: string): string {
  const date = takenAt ? new Date(takenAt) : new Date();
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const datePart = `${ist.getUTCFullYear()}${pad(ist.getUTCMonth() + 1)}${pad(ist.getUTCDate())}`;
  const timePart = `${pad(ist.getUTCHours())}${pad(ist.getUTCMinutes())}`;
  const idSuffix = id.replace(/-/g, '').slice(0, 6);
  return `${datePart}_${timePart}_${idSuffix}.${ext}`;
}
