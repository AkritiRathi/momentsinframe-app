import { API_BASE_URL } from '../constants/config';

async function post(path: string, body: object) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, { headers });
  return res.json();
}

async function del(path: string, body: object) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function postRaw(path: string, body: object): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function joinEvent(joinCode: string) {
  return post('/api/native/events/join', { joinCode });
}

export async function eventAdminLogin(slug: string, password: string) {
  return post(`/api/native/events/${slug}/admin-login`, { password });
}

export async function masterLogin(password: string) {
  return post('/api/native/master/login', { password });
}

export async function verifyMasterPassword(password: string) {
  return post('/api/native/master/verify-password', { password });
}

export async function changeMasterPassword(currentPassword: string, newPassword: string) {
  return post('/api/native/master/change-password', { currentPassword, newPassword });
}

export async function listEvents(masterPassword: string) {
  return get('/api/native/events', { 'x-master-password': masterPassword });
}

export async function createEvent(masterPassword: string, name: string, expiresAt: string) {
  return post('/api/native/events', { masterPassword, name, expiresAt });
}

export async function extendEvent(slug: string, masterPassword: string, newExpiresAt: string) {
  return post(`/api/native/events/${slug}/extend`, { masterPassword, newExpiresAt });
}

export async function changeEventAdminPassword(slug: string, currentPassword: string, newPassword: string) {
  return post(`/api/native/events/${slug}/change-admin-password`, { currentPassword, newPassword });
}

export async function deleteEvent(slug: string, masterPassword: string) {
  return del(`/api/native/events/${slug}`, { masterPassword });
}

export async function joinEventUser(slug: string, name: string, mobile: string, deviceId: string) {
  return post(`/api/native/events/${slug}/join-user`, { name, mobile, deviceId });
}

// Photo endpoints
export async function getEventPhotos(slug: string) {
  return get(`/api/events/${slug}/photos`);
}

export async function getPhotoUrls(slug: string, ids: string[]) {
  return post(`/api/events/${slug}/photo-urls`, { ids });
}

export async function getUploadUrl(eventSlug: string, filename: string, contentType: string) {
  return post('/api/upload-url', { eventSlug, filename, contentType });
}

export async function processUpload(eventSlug: string, stagingKey: string, originalFilename: string, uploaderMobile?: string, uploaderName?: string, eventUserId?: string) {
  return post('/api/upload', { eventSlug, stagingKey, originalFilename, uploaderMobile, uploaderName, eventUserId });
}

export async function deletePhotos(slug: string, photoIds: string[], adminPassword: string, uploaderMobile?: string, eventUserId?: string, deviceId?: string) {
  const body = adminPassword
    ? { photoIds, adminPassword }
    : { photoIds, uploaderMobile, eventUserId, deviceId };
  return del(`/api/native/events/${slug}/photos`, body);
}

export async function downloadZipRaw(slug: string, photoIds: string[]): Promise<Response> {
  return postRaw(`/api/native/events/${slug}/download-zip`, { photoIds });
}

export async function downloadPhotoRaw(photoId: string, adminPassword?: string): Promise<Response> {
  return postRaw('/api/download-photo', { photoId, adminPassword: adminPassword ?? '' });
}

export async function getPhotoDownloadUrl(photoId: string, adminPassword?: string): Promise<{ url: string; filename: string; error?: string }> {
  return post(`/api/native/photos/${photoId}/download-url`, { adminPassword: adminPassword ?? '' });
}

export async function prepareZip(slug: string, photoIds: string[]): Promise<{ zipUrl: string; filename: string; error?: string }> {
  return post(`/api/native/events/${slug}/prepare-zip`, { photoIds });
}
