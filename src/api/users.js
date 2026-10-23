import { authorizedFetch, authorizedJson, readErrorMessage } from './auth-client.js';

const parseJson = async (res) => {
  try {
    return await res.json();
  } catch {
    return {};
  }
};

export const fetchUsers = async () => {
  const res = await authorizedFetch('/api/users');
  if (!res.ok) throw new Error(await readErrorMessage(res, 'Failed to load users'));
  const json = await parseJson(res);
  return Array.isArray(json.data) ? json.data : [];
};

export const createUser = async ({ email, pass, access }) => {
  const res = await authorizedJson('/api/users', { method: 'POST', body: { email, pass, access } });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json?.error || 'Failed to create user');
  return json.data;
};

export const updateUser = async ({ id, email, pass, access }) => {
  const payload = { id };
  if (email !== undefined) payload.email = email;
  if (pass !== undefined && pass !== '') payload.pass = pass;
  if (access !== undefined) payload.access = access;
  const res = await authorizedJson('/api/users', { method: 'PATCH', body: payload });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json?.error || 'Failed to update user');
  return json.data;
};

export const deleteUser = async (id) => {
  const res = await authorizedJson('/api/users', { method: 'DELETE', body: { id } });
  const json = await parseJson(res);
  if (!res.ok) throw new Error(json?.error || 'Failed to delete user');
  return json.ok;
};