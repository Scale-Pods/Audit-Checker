import { auth } from '../firebase';

// The /api endpoints require a Firebase ID token. Reading auth.currentUser at
// call time is not enough: on a hard refresh the session is still being
// restored, which would send an unauthenticated request and get a 401 back.
const resolveUser = () =>
  new Promise(resolve => {
    if (auth.currentUser) return resolve(auth.currentUser);
    let settled = false;
    const finish = user => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(user);
    };
    const unsubscribe = auth.onAuthStateChanged(finish);
    setTimeout(() => finish(auth.currentUser), 5000);
  });

const buildHeaders = async forceRefresh => {
  const user = await resolveUser();
  if (!user) return null;
  try {
    const token = await user.getIdToken(forceRefresh);
    return { Authorization: `Bearer ${token}` };
  } catch (err) {
    console.warn('Could not get auth token:', err);
    return null;
  }
};

export const authorizedFetch = async url => {
  let headers = await buildHeaders(false);

  if (!headers) {
    return fetch(url);
  }

  let res = await fetch(url, { headers });

  if (res.status === 401) {
    const freshHeaders = await buildHeaders(true);
    if (freshHeaders) res = await fetch(url, { headers: freshHeaders });
  }

  return res;
};

export const readErrorMessage = async (res, fallback) => {
  try {
    const body = await res.json();
    if (body?.error) return `${body.error} (HTTP ${res.status})`;
  } catch {
    /* non-JSON error body */
  }
  return `${fallback} (HTTP ${res.status})`;
};
