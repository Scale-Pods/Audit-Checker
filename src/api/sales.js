import { authorizedFetch, readErrorMessage } from './auth-client.js';

export const fetchSalesRecords = async () => {
  const res = await authorizedFetch('/api/sales');

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, 'Failed to load sales data'));
  }

  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
};
