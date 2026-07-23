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

export async function organiserExists(phone: string): Promise<{ exists: boolean; error?: string }> {
  return post('/api/native/organiser/exists', { phone });
}

export async function organiserResetPassword(phone: string, newPassword: string) {
  return post('/api/native/organiser/reset-password', { phone, newPassword });
}

export async function checkWhitelist(phone: string): Promise<{ whitelisted: boolean }> {
  return post('/api/native/whitelist/check', { phone });
}

export async function checkUserStatus(phone: string): Promise<{ active: boolean }> {
  return get(`/api/native/users/status?phone=${encodeURIComponent(phone)}`);
}

export async function listWhitelist(phone: string, password: string): Promise<{ phones?: { phone: string; added_at: string }[]; error?: string }> {
  return get('/api/native/whitelist', {
    'x-organiser-phone': phone,
    'x-organiser-password': password,
  });
}

export async function addToWhitelist(callerPhone: string, password: string, newPhone: string): Promise<{ success?: boolean; error?: string }> {
  return post('/api/native/whitelist', { callerPhone, password, newPhone });
}

export async function removeFromWhitelist(callerPhone: string, password: string, targetPhone: string): Promise<{ success?: boolean; error?: string }> {
  return del(`/api/native/whitelist/${targetPhone}`, { callerPhone, password });
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

export async function checkEventExists(slug: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/native/events/${encodeURIComponent(slug)}`);
    return res.ok;
  } catch { return true; } // assume exists on network error — don't delete from cache
}

export async function checkAdminStatus(slug: string, phone: string): Promise<{ isAdmin: boolean; role?: string }> {
  return post(`/api/native/events/${slug}/check-admin`, { phone });
}

// Photo endpoints
export async function getEventPhotos(slug: string, adminPhone?: string) {
  const url = adminPhone
    ? `/api/events/${slug}/photos?adminPhone=${encodeURIComponent(adminPhone)}`
    : `/api/events/${slug}/photos`;
  return get(url);
}

export async function getPhotoUrls(slug: string, ids: string[], adminPhone?: string) {
  return post(`/api/events/${slug}/photo-urls`, { ids, ...(adminPhone ? { adminPhone } : {}) });
}

export async function getUploadUrl(eventSlug: string, filename: string, contentType: string) {
  return post('/api/upload-url', { eventSlug, filename, contentType });
}

export async function processUpload(eventSlug: string, stagingKey: string, originalFilename: string, uploaderMobile?: string, uploaderName?: string, eventUserId?: string) {
  return post('/api/upload', { eventSlug, stagingKey, originalFilename, uploaderMobile, uploaderName, eventUserId });
}

export async function deletePhotos(slug: string, photoIds: string[], uploaderMobile?: string, eventUserId?: string, deviceId?: string, adminPhone?: string) {
  const body = adminPhone
    ? { photoIds, adminPhone }
    : { photoIds, uploaderMobile, eventUserId, deviceId };
  return del(`/api/native/events/${slug}/photos`, body);
}

export async function getPhotoDownloadUrl(photoId: string, adminPhone?: string): Promise<{ url: string; filename: string; error?: string }> {
  return post(`/api/native/photos/${photoId}/download-url`, { ...(adminPhone ? { adminPhone } : {}) });
}

export async function prepareZip(slug: string, photoIds: string[], adminPhone?: string): Promise<{ zipUrl: string; filename: string; error?: string }> {
  return post(`/api/native/events/${slug}/prepare-zip`, { photoIds, ...(adminPhone ? { adminPhone } : {}) });
}

// Co-admin API
export async function listCoadmins(slug: string, organiserPhone: string, organiserPassword: string): Promise<{ coadmins?: { phone: string; name: string | null; added_at: string }[]; error?: string }> {
  return get(`/api/native/events/${slug}/coadmins`, {
    'x-organiser-phone': organiserPhone,
    'x-organiser-password': organiserPassword,
  });
}

export async function addCoadmin(slug: string, organiserPhone: string, organiserPassword: string, phone: string, name?: string) {
  return post(`/api/native/events/${slug}/coadmins`, { organiserPhone, organiserPassword, phone, name });
}

export async function removeCoadmin(slug: string, organiserPhone: string, organiserPassword: string, phone: string) {
  return del(`/api/native/events/${slug}/coadmins`, { organiserPhone, organiserPassword, phone });
}

export async function lookupUsers(phones: string[]): Promise<{ registered: string[] }> {
  return post('/api/native/users/lookup', { phones });
}

export async function registerUser(phone: string, name: string): Promise<void> {
  await post('/api/native/users/register', { phone, name });
}

export async function logoutUser(phone: string): Promise<void> {
  await post('/api/native/users/logout', { phone });
}

// Allowed guests API
export async function listAllowedGuests(slug: string, organiserPhone: string, organiserPassword: string): Promise<{ guests?: { phone: string; name: string | null; appName: string | null; added_at: string }[]; error?: string }> {
  return get(`/api/native/events/${slug}/allowed-guests`, {
    'x-organiser-phone': organiserPhone,
    'x-organiser-password': organiserPassword,
  });
}

export async function addAllowedGuests(slug: string, organiserPhone: string, organiserPassword: string, guests: { phone: string; name?: string }[]) {
  return post(`/api/native/events/${slug}/allowed-guests`, { organiserPhone, organiserPassword, guests });
}

export async function removeAllowedGuest(slug: string, organiserPhone: string, organiserPassword: string, phone: string) {
  return del(`/api/native/events/${slug}/allowed-guests`, { organiserPhone, organiserPassword, phone });
}

export async function clearAllowedGuests(slug: string, organiserPhone: string, organiserPassword: string) {
  return del(`/api/native/events/${slug}/allowed-guests`, { organiserPhone, organiserPassword });
}

export async function clearJoinedGuests(slug: string, organiserPhone: string, organiserPassword: string) {
  return del(`/api/native/events/${slug}/joined-guests`, { organiserPhone, organiserPassword });
}

export async function listJoinedGuests(slug: string, organiserPhone: string, organiserPassword: string): Promise<{ guests?: { name: string; mobile: string; is_blocked: boolean }[]; error?: string }> {
  return get(`/api/native/events/${slug}/joined-guests`, {
    'x-organiser-phone': organiserPhone,
    'x-organiser-password': organiserPassword,
  });
}

export async function setGuestBlocked(slug: string, mobile: string, isBlocked: boolean, organiserPhone: string, organiserPassword: string): Promise<{ success?: boolean; error?: string }> {
  const res = await fetch(`${API_BASE_URL}/api/native/events/${slug}/guests/${mobile}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-organiser-phone': organiserPhone,
      'x-organiser-password': organiserPassword,
    },
    body: JSON.stringify({ is_blocked: isBlocked }),
  });
  return res.json();
}

export async function joinEvent(joinCode: string, phone?: string) {
  return post('/api/native/events/join', { joinCode, phone });
}

export async function updateEventSettings(slug: string, organiserPhone: string, organiserPassword: string, settings: { allowGuestDelete?: boolean; isClosed?: boolean }) {
  const res = await fetch(`${API_BASE_URL}/api/native/events/${slug}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organiserPhone, organiserPassword, ...settings }),
  });
  return res.json();
}

export async function deleteAccount(phone: string): Promise<{ success?: boolean; error?: string }> {
  return del('/api/native/users/delete', { phone });
}

// Notifications API
export type ServerNotification = {
  id: string;
  type: string;
  message: string;
  event_slug: string;
  event_name: string;
  created_at: string;
  read: boolean;
};

export async function fetchServerNotifications(phone: string): Promise<ServerNotification[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/native/notifications?phone=${encodeURIComponent(phone)}`);
    const data = await res.json();
    return data.notifications ?? [];
  } catch {
    return [];
  }
}

export async function markServerNotificationsRead(phone: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/native/notifications`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
  } catch {
    // best-effort
  }
}
