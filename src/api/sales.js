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

// Each ledger is a separate table with its own set of columns, so they are
// never read together — the toggle picks one table and only that table.
const LEDGERS = {
  [SALES_SOURCE]: { path: '/api/sales', error: 'Failed to load sales data' },
  [QUICK_CHECK_SOURCE]: { path: '/api/sales-qc', error: 'Failed to load sales quick check data' },
};

// Resolves which single ledger the sales side should be reading.
export const salesLedgerSource = (quickEntryMode) =>
  quickEntryMode ? QUICK_CHECK_SOURCE : SALES_SOURCE;

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

// A row in the main table is a real sales audit when it carries the audit's own
// output — the score, the status, the missing-document list or the workflow's
// Completed marker — or any of the movement documents. Quick checks written
// before the split are SO-and-PO rows with none of that, so they stay out of
// the normal sales ledger rather than being rendered as an empty comparison.
// Rows read from the quick-check table need no such check: the source tag
// already tells the two apart.
const hasAuditResults = (record) =>
  hasDocData(record, 'inv_') ||
  hasDocData(record, 'gp_') ||
  hasDocData(record, 'ws_') ||
  record?.audit_score != null ||
  record?.audit_status != null ||
  (Array.isArray(record?.missing_documents) && record.missing_documents.length > 0) ||
  (typeof record?.Status === 'string' && record.Status.trim() !== '');

const isRecordLegacyQuickEntry = (record) =>
  record?.__source !== QUICK_CHECK_SOURCE &&
  !hasAuditResults(record);

export const fetchSalesRecords = async (source = SALES_SOURCE) => {
  const resolvedSource = source in LEDGERS ? source : SALES_SOURCE;
  const ledger = LEDGERS[resolvedSource];
  const records = await readLedger(ledger.path, ledger.error);

  return tagRecords(records, resolvedSource)
    .filter(record => !isRecordLegacyQuickEntry(record))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
};
