import { authorizedFetch, readErrorMessage } from './auth-client.js';

const readLedger = async (path, fallback) => {
  const res = await authorizedFetch(path);

  if (!res.ok) {
    throw new Error(await readErrorMessage(res, fallback));
  }

  const json = await res.json();
  return Array.isArray(json.data) ? json.data : [];
};

// The two sales ledgers share a column set but not an id sequence, so every
// row is tagged with the table it came from and given a key that is unique
// across both. The raw `id` is left untouched — it is what the decision and
// re-audit webhooks write back against.
const SALES_SOURCE = 'sales';
const QUICK_CHECK_SOURCE = 'sales_qc';

const tagRecords = (records, source) =>
  records.map(record => ({ ...record, __source: source, __uid: `${source}-${record.id}` }));

// A document column only counts as present when it holds a real value — a
// column that exists but is null is the same as no document at all.
export const hasDocData = (record, prefix) =>
  Object.keys(record).some(k => {
    if (!k.startsWith(prefix)) return false;
    const value = record[k];
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    return true;
  });

// Quick entries are read from their own table, so the source tag is the only
// authoritative signal for one.
export const isRecordQuickEntry = (record) => record?.__source === QUICK_CHECK_SOURCE;

// Quick checks written before the split are still sitting in the main sales
// table. They carry no invoice / gate pass / weightslip data, so they are
// neither a full audit nor a quick entry — they are left out of the ledger
// rather than rendered as an empty comparison.
const isRecordLegacyQuickEntry = (record) =>
  record?.__source !== QUICK_CHECK_SOURCE &&
  !hasDocData(record, 'inv_') &&
  !hasDocData(record, 'gp_') &&
  !hasDocData(record, 'ws_');

export const fetchSalesRecords = async () => {
  const sales = await readLedger('/api/sales', 'Failed to load sales data');

  // Quick entries are additive: if that table cannot be read, the main sales
  // ledger must still load rather than blanking the whole page.
  const quickChecks = await readLedger('/api/sales-qc', 'Failed to load sales quick check data')
    .catch(err => {
      console.warn('Sales quick check ledger unavailable:', err.message);
      return [];
    });

  return [
    ...tagRecords(sales, SALES_SOURCE),
    ...tagRecords(quickChecks, QUICK_CHECK_SOURCE),
  ]
    .filter(record => !isRecordLegacyQuickEntry(record))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
};
