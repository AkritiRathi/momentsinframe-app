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

// Organiser API
export async function organiserSetup(phone: string, name: string, password: string) {
  return post('/api/native/organiser/setup', { phone, name, password });
}

export async function organiserLogin(phone: string, password: string): Promise<{ success?: boolean; name?: string; error?: string }> {
  return post('/api/native/organiser/login', { phone, password });
}

export async function organiserChangePassword(phone: string, currentPassword: string, newPassword: string) {
  return post('/api/native/organiser/change-password', { phone, currentPassword, newPassword });
}

export async function listEvents(organiserPhone: string, organiserPassword: string) {
  return get('/api/native/events', {
    'x-organiser-phone': organiserPhone,
    'x-organiser-password': organiserPassword,
  });
}

export async function createEvent(organiserPhone: string, organiserPassword: string, name: string, expiresAt: string, isClosed?: boolean) {
  return post('/api/native/events', { organiserPhone, organiserPassword, name, expiresAt, isClosed });
}

export async function extendEvent(slug: string, organiserPhone: string, organiserPassword: string, newExpiresAt: string) {
  return post(`/api/native/events/${slug}/extend`, { organiserPhone, organiserPassword, newExpiresAt });
}

export async function deleteEvent(slug: string, organiserPhone: string, organiserPassword: string) {
  return del(`/api/native/events/${slug}`, { organiserPhone, organiserPassword });
}

export async function joinEventUser(slug: string, name: string, mobile: string, deviceId: string) {
  return post(`/api/native/events/${slug}/join-user`, { name, mobile, deviceId });
}

export async function checkAdminStatus(slug: string, phone: string): Promise<{ isAdmin: boolean; role?: string }> {
  return post(`/api/native/events/${slug}/check-admin`, { phone });
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

export async function deletePhotos(slug: string, photoIds: string[], adminPassword: string, uploaderMobile?: string, eventUserId?: string, deviceId?: string, adminPhone?: string) {
  const body = adminPhone
    ? { photoIds, adminPhone }
    : adminPassword
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
