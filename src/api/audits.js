import { authorizedFetch, readErrorMessage } from './auth-client.js';

export const fetchPurchaseRecords = async () => {
  const res = await authorizedFetch('/api/audits');

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Failed to load audit data'));
  }

  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
};
