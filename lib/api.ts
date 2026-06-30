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

export async function joinEvent(joinCode: string) {
  return post('/api/native/events/join', { joinCode });
}

export async function eventAdminLogin(slug: string, password: string) {
  return post(`/api/native/events/${slug}/admin-login`, { password });
}

export async function masterLogin(password: string) {
  return post('/api/native/master/login', { password });
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
