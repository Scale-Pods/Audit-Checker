// The /api endpoints require the session token issued by /api/login. The token
// lives in localStorage alongside the rest of the session, so reading it is
// synchronous - no auth-restore wait is needed anymore.
const readSession = () => {
  try {
    const raw = localStorage.getItem('audit_session');
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.token || !session?.exp) return null;
    if (Date.now() >= session.exp) return null;
    return session;
  } catch {
    return null;
  }
};

const buildHeaders = () => {
  const session = readSession();
  if (!session) return null;
  return { Authorization: `Bearer ${session.token}` };
};

const clearExpiredSession = () => {
  try {
    localStorage.removeItem('audit_session');
  } catch {
    /* storage unavailable */
  }
};

export const authorizedFetch = async url => {
  const headers = buildHeaders();

  if (!headers) {
    return fetch(url);
  }

  let res = await fetch(url, { headers });

  if (res.status === 401) {
    // Token is expired or rejected - drop the dead session and go back to login.
    clearExpiredSession();
    window.location.assign('/login');
    return res;
  }

  return res;
};

// Same as authorizedFetch but for methods with a JSON body (POST/PATCH/DELETE).
export const authorizedJson = async (url, { method = 'POST', body } = {}) => {
  const headers = buildHeaders();
  if (!headers) {
    window.location.assign('/login');
    throw new Error('Authentication required');
  }

  const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
  let res = await fetch(url, init);

  if (res.status === 401) {
    clearExpiredSession();
    window.location.assign('/login');
    throw new Error('Your session has expired. Please sign in again.');
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
