import { Platform } from 'react-native';
import { API_BASE_URL } from '../constants/config';
import { getSessionToken, saveSessionToken } from './storage';

// Every request carries the login token issued at OTP verification, so the
// server can read the caller's number from the token instead of trusting the
// number in the request body. Added in one place on purpose — a call that
// forgot the header would start failing once the server requires it.
async function authHeaders(base: Record<string, string> = {}): Promise<Record<string, string>> {
  try {
    const token = await getSessionToken();
    if (token) return { ...base, Authorization: `Bearer ${token}` };
  } catch { /* no token — behaves exactly as before */ }
  return base;
}

function makeTimeout(ms: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(id) };
}

async function post(path: string, body: object, ms = 15000) {
  const { signal, clear } = makeTimeout(ms);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal,
    });
    return res.json();
  } finally {
    clear();
  }
}

async function get(path: string, headers: Record<string, string> = {}) {
  const { signal, clear } = makeTimeout(15000);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { headers: await authHeaders(headers), signal });
    return res.json();
  } finally {
    clear();
  }
}

async function del(path: string, body: object) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'DELETE',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  return res.json();
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

export async function getOrganiserEventCount(phone: string): Promise<number> {
  const result = await get(`/api/native/organiser/event-count?phone=${encodeURIComponent(phone)}`);
  return result.count ?? 0;
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

// Every event this number belongs to, in any role — organiser, co-admin or
// guest. Identity comes from the session token that `get` attaches, never from
// a number in the request, so there is nothing to pass. Returns 401 when the
// token is missing or expired; callers fall back to the cached list.
export async function listMyEvents() {
  return get('/api/my-events');
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
    return res.status !== 404; // only a real "not found" drops the event; a server error must not
  } catch { return true; } // assume exists on network error — don't delete from cache
}

export async function checkAdminStatus(slug: string, phone: string): Promise<{ isAdmin: boolean; role?: string }> {
  return post(`/api/native/events/${slug}/check-admin`, { phone });
}

// Photo endpoints
export async function getEventPhotos(slug: string, adminPhone?: string, userMobile?: string) {
  const parts: string[] = [];
  if (adminPhone) parts.push(`adminPhone=${encodeURIComponent(adminPhone)}`);
  if (userMobile) parts.push(`userMobile=${encodeURIComponent(userMobile)}`);
  const url = `/api/events/${slug}/photos${parts.length ? `?${parts.join('&')}` : ''}`;
  return get(url);
}

export async function getPhotoUrls(slug: string, ids: string[], adminPhone?: string) {
  return post(`/api/events/${slug}/photo-urls`, { ids, ...(adminPhone ? { adminPhone } : {}) });
}

export async function getUploadUrl(eventSlug: string, filename: string, contentType: string, uploaderMobile?: string) {
  return post('/api/upload-url', { eventSlug, filename, contentType, uploaderMobile });
}

export async function processUpload(eventSlug: string, stagingKey: string, originalFilename: string, uploaderMobile?: string, uploaderName?: string, eventUserId?: string) {
  return post('/api/upload', { eventSlug, stagingKey, originalFilename, uploaderMobile, uploaderName, eventUserId }, 60000);
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

export async function lookupUsers(phones: string[]): Promise<{ registered: string[]; users: { phone: string; name: string }[] }> {
  return post('/api/native/users/lookup', { phones });
}

export async function registerUser(phone: string, name: string): Promise<void> {
  await post('/api/native/users/register', { phone, name });
}

export async function logoutUser(phone: string): Promise<void> {
  await post('/api/native/users/logout', { phone });
}

export async function sendOtp(phone: string): Promise<void> {
  const data = await post('/api/native/otp/send', { phone });
  if (data?.error) throw new Error(data.error);
}

// A plain label for the user's own device list, e.g. "Samsung SM-G991B".
//
// DO NOT import or require expo-device here until a native build that includes
// it is installed. expo-device calls requireNativeModule('ExpoDevice') as soon
// as it loads, and on a build without that module the app CRASHES — a native
// failure, which a try/catch around the require cannot stop. It crashed iOS
// logins on 2026-09-29, right after OTP verification, for exactly that reason.
//
// The package stays in package.json for the next build. Once that build ships,
// switch this over to expo-device for real names like "iPhone 13 Pro".
function describeThisDevice(): string {
  try {
    if (Platform.OS === 'android') {
      const c = Platform.constants as { Brand?: string; Model?: string };
      const brand = c.Brand ? c.Brand.charAt(0).toUpperCase() + c.Brand.slice(1) : '';
      const model = c.Model ?? '';
      return `${brand} ${model}`.trim() || 'Android phone';
    }
    const kind = Platform.OS === 'ios' ? (Platform.isPad ? 'iPad' : 'iPhone') : 'Phone';
    return `${kind} (iOS ${Platform.Version})`;
  } catch { return 'Phone'; }
}

export async function verifyOtp(phone: string, code: string): Promise<void> {
  const data = await post('/api/native/otp/verify', {
    phone, code, platform: 'Mobile', deviceLabel: describeThisDevice(),
  });
  if (data?.error) throw new Error(data.error);
  // Keep the login token issued with the OTP.
  if (data?.token && data?.expiresAt) {
    await saveSessionToken(data.token, data.expiresAt).catch(() => {});
  }
}

// Allowed guests API
export async function listAllowedGuests(slug: string, organiserPhone: string, organiserPassword: string): Promise<{ guests?: { phone: string; name: string | null; appName: string | null; added_at: string; photo_count: number }[]; error?: string }> {
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

export async function listJoinedGuestsForUser(slug: string, userPhone: string): Promise<{ guests?: { name: string; mobile: string; is_blocked: boolean; photo_count: number; role: 'organiser' | 'coadmin' | 'user' }[]; owner_phone?: string; total_photo_count?: number; error?: string }> {
  return get(`/api/native/events/${slug}/joined-guests`, { 'x-user-phone': userPhone });
}

export async function setGuestBlockedByUser(slug: string, mobile: string, isBlocked: boolean, userPhone: string): Promise<{ success?: boolean; error?: string }> {
  const res = await fetch(`${API_BASE_URL}/api/native/events/${slug}/guests/${mobile}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-user-phone': userPhone },
    body: JSON.stringify({ is_blocked: isBlocked }),
  });
  return res.json();
}

export async function joinEvent(joinCode: string, phone?: string) {
  return post('/api/native/events/join', { joinCode, phone });
}

export async function updateEventSettings(slug: string, organiserPhone: string, organiserPassword: string, settings: { allowGuestDelete?: boolean; isClosed?: boolean; viewOnly?: boolean; findMyPhotosEnabled?: boolean }) {
  const res = await fetch(`${API_BASE_URL}/api/native/events/${slug}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ organiserPhone, organiserPassword, ...settings }),
  });
  return res.json();
}

export async function findMyPhotos(slug: string, selfieBase64: string, adminPhone?: string, userMobile?: string): Promise<{ photos?: { id: string; taken_at: string }[]; otherPhotos?: { id: string; taken_at: string }[]; error?: string }> {
  const res = await fetch(`${API_BASE_URL}/api/native/events/${slug}/find-my-photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selfieBase64, ...(adminPhone ? { adminPhone } : {}), ...(userMobile ? { userMobile } : {}) }),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { error: 'Server returned an unexpected response. Please try again.' }; }
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
  photo_id: string | null;
  photo_ids: string[] | null;
  created_at: string;
  read: boolean;
};

export async function fetchServerNotifications(phone: string, slug: string): Promise<ServerNotification[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/native/notifications?phone=${encodeURIComponent(phone)}&slug=${encodeURIComponent(slug)}`);
    const data = await res.json();
    return data.notifications ?? [];
  } catch {
    return [];
  }
}

export async function markServerNotificationsRead(phone: string, slug: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/native/notifications`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, event_slug: slug }),
    });
  } catch {
    // best-effort
  }
}

export async function deleteServerNotification(phone: string, id: string, slug: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/native/notifications`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, id, event_slug: slug }),
    });
  } catch {
    // best-effort
  }
}

export async function deleteAllServerNotifications(phone: string, slug: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/native/notifications`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, event_slug: slug }),
    });
  } catch {
    // best-effort
  }
}
