import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText, CheckCircle, AlertTriangle, Eye, Download, Loader2, Truck, Hash, X, Info, IndianRupee, Activity, ChevronLeft, ChevronRight, ChevronDown, Check, Shield, TrendingUp, UploadCloud, FileUp, Mail, FileSpreadsheet, ShoppingCart, ClipboardList, Scale, Filter, ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react'
import { fetchSalesRecords, hasDocData as hasDocPrefixData, isRecordQuickEntry, salesLedgerSource } from '../../api/sales.js'
import { fetchPurchaseRecords } from '../../api/audits.js'
import { useSyncRefresh } from '../../context/SyncContext'
import { SquareWaveLoader } from '@/components/ui/square-wave-loader'
import { PebbleSelect } from '@/components/ui/pebble-select'
import { PlaceholdersAndVanishInput } from '@/components/ui/placeholders-and-vanish-input'
import './AuditHistory.css'
import '@/components/ui/pebble-select.css'


const AUDITS_WEBHOOK_URL = import.meta.env.VITE_AUDITS_HISTORY_URL || 'https://n8n.srv1010832.hstgr.cloud/webhook/40a6351a-d510-492f-918b-7ec9bae2bd2a'
const SALES_WEBHOOK_URL = 'https://n8n.srv1010832.hstgr.cloud/webhook/10916618-e795-416f-9d0a-6646da9aba06'
const SALES_DECISION_WEBHOOK_URL = 'https://n8n.srv1010832.hstgr.cloud/webhook/0c5dfbd4-db17-4d71-87ab-96fa2fb7369e'
// One decision workflow serves both sales ledgers; the action code tells it
// which table the approval belongs to.
const SALES_DECISION_ACTIONS = { sales: 'SS', sales_qc: 'QC' };
const PENDING_DOCS_UPLOAD_WEBHOOK = 'https://n8n.srv1010832.hstgr.cloud/webhook/9f099219-ec9c-465d-83f4-6a048fa7dc85'

// The n8n workflow that re-audits a ledger once its pending documents arrive is
// not built yet, so the upload entry points stay hidden until it goes live.
// Flip this to true once the workflow is deployed.
const PENDING_DOCS_UPLOAD_ENABLED = false
const LEDGERS_PER_PAGE = 15

// Optional documents in the cross-document ledger. The webhook often returns
// no LR / GRN / E-Way upload for a record, and a column of em-dashes reads as
// missing data rather than a document that was never collected — so these are
// rendered only when the record actually carries values for them.
// Order matches the purchase comparison matrix: Invoice, LR, E-Way, GRN.
const LEDGER_DOC_COLUMNS = [
  { key: 'LR Copy', label: 'LR' },
  { key: 'E-Way Bill', label: 'E-Way' },
  { key: 'GRN', label: 'GRN' },
];

const getPageItems = (currentPage, totalPages) => {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)

  const items = []
  for (let page = 1; page <= totalPages; page += 1) {
    const isEdge = page === 1 || page === totalPages
    const isNearCurrent = page >= currentPage - 1 && page <= currentPage + 1
    if (isEdge || isNearCurrent) {
      items.push(page)
    } else if (items[items.length - 1] !== 'ellipsis') {
      items.push('ellipsis')
    }
  }
  return items
}

const LedgerPagination = ({ totalItems, currentPage, onPageChange, itemLabel }) => {
  const totalPages = Math.max(1, Math.ceil(totalItems / LEDGERS_PER_PAGE))
  const page = Math.min(Math.max(currentPage, 1), totalPages)
  const startItem = totalItems === 0 ? 0 : (page - 1) * LEDGERS_PER_PAGE + 1
  const endItem = Math.min(page * LEDGERS_PER_PAGE, totalItems)
  const pageItems = getPageItems(page, totalPages)

  return (
    <div className="pagination ledger-pagination">
      <span>
        {totalItems === 0 ? `No ${itemLabel}` : `${startItem}–${endItem} of ${totalItems} ${itemLabel}`}
      </span>
      {totalItems > 0 && (
        <div className="pagination-controls">
          <button
            type="button"
            className="btn btn-outline btn-sm pagination-nav-btn"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
          >
            <ChevronLeft size={15} />
            <span className="hide-mobile">Prev</span>
          </button>
          <div className="pagination-pages">
            {pageItems.map((pageItem, index) => pageItem === 'ellipsis' ? (
              <span key={`ellipsis-${index}`} className="pagination-ellipsis" aria-hidden="true">…</span>
            ) : (
              <button
                key={pageItem}
                type="button"
                className={`btn btn-sm pagination-page-btn ${pageItem === page ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => onPageChange(pageItem)}
                aria-label={`Go to page ${pageItem}`}
                aria-current={pageItem === page ? 'page' : undefined}
              >
                {pageItem}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm pagination-nav-btn"
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages}
            aria-label="Next page"
          >
            <span className="hide-mobile">Next</span>
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   Purchase field mapping

   Every row of the reconciliation table is declared in PURCHASE_FIELD_SPEC
   below, against the exact ledger column it reads. Nothing is inferred from a
   column name any more.

   The previous implementation guessed a label by stripping a document suffix
   off the column name, which collapsed unrelated columns onto shared labels:
   Batch_Code_Invoice, batch_number_grn and Coil_Number_LR all became
   "Batch / Coil Number", and gross_weight_invoice, net_weight_lr and
   tare_weight_lr all became "Weight". Those rows were then compared against
   each other, so the UI reported mismatches between fields that were never
   supposed to meet. A column is now only ever read where it is written down.

   level: 'document' fields identify the whole document, 'item' fields belong
   to an invoice line. The two are never compared against one another.
   ══════════════════════════════════════════════════════════════════ */

const PURCHASE_DOC_KEYS = ['Invoice', 'E-Way Bill', 'LR Copy', 'GRN'];

/* The E-Way vehicle number has been written both `Vehicle_No_Eway` and
   `Vehicle_No_EWay` in this ledger. Both are accepted so a row extracted either
   way still shows its vehicle, instead of reading as an empty cell. */
const PURCHASE_COLUMN_ALIASES = {
  Vehicle_No_Eway: ['Vehicle_No_EWay', 'Vehicle No (EWay)'],
  Vehicle_No_LR: ['Vehicle No (LR)'],
};

const readPurchaseColumn = (row, column) => {
  if (!row || !column) return null;
  if (hasSourceValue(row[column])) return row[column];
  const aliases = PURCHASE_COLUMN_ALIASES[column] || [];
  const found = aliases.find(name => hasSourceValue(row[name]));
  return found ? row[found] : row[column];
};

const PURCHASE_FIELD_SPEC = [
  { id: 'invoice_number', label: 'Invoice Number', level: 'document', kind: 'identifier',
    sources: { 'Invoice': 'Invoice_Number_Invoice', 'LR Copy': 'Invoice_Number_LR', 'E-Way Bill': 'Invoice_Number_EWay', 'GRN': 'supplier_invoice_no_grn' } },
  { id: 'invoice_date', label: 'Invoice Date', level: 'document', kind: 'date',
    sources: { 'Invoice': 'Invoice_Date_Invoice', 'E-Way Bill': 'invoice_date_eway', 'GRN': 'supplier_invoice_date_grn' } },
  { id: 'supplier', label: 'Supplier Name', level: 'document', kind: 'party',
    sources: { 'Invoice': 'Supplier_Name_Invoice', 'LR Copy': 'Consigner_name_LR', 'E-Way Bill': 'Supplier_Name_EWay', 'GRN': 'supplier_name_grn' } },
  /* E-Way carries the supplier's GSTIN on the E-Way bill itself, and the
     buyer's on the bill-to party — they are different parties, so the two live
     in separate rows rather than being folded into one GSTIN row. */
  { id: 'supplier_gstin', label: 'Supplier GSTIN', level: 'document', kind: 'gstin',
    sources: { 'Invoice': 'Invoice_SupplierGSTIn_(Invoice)', 'LR Copy': 'consignor_gstin_lr', 'E-Way Bill': 'EWB_GSTIn_(EWay)', 'GRN': 'supplier_gstin_grn' } },
  { id: 'buyer', label: 'Buyer / Bill To', level: 'document', kind: 'address',
    sources: { 'Invoice': 'Bill_To_Invoice', 'LR Copy': 'billed_to_lr', 'E-Way Bill': 'Bill_To_EWay', 'GRN': 'buyer_name_grn' } },
  { id: 'buyer_gstin', label: 'Buyer GSTIN', level: 'document', kind: 'gstin',
    sources: { 'Invoice': 'Invoice_BillToGSTIn_(Invoice)', 'LR Copy': 'billed_to_gstin_lr', 'E-Way Bill': 'bill_to_gstin_eway', 'GRN': 'buyer_gstin_grn' } },
  { id: 'ship_to', label: 'Ship To', level: 'document', kind: 'address',
    sources: { 'Invoice': 'Ship_To_Invoice', 'LR Copy': 'Consignee_name_LR', 'E-Way Bill': 'Ship_To_EWay', 'GRN': 'ship_to_grn' } },
  { id: 'vehicle_no', label: 'Vehicle Number', level: 'document', kind: 'identifier',
    sources: { 'Invoice': 'vehicle_no_invoice', 'LR Copy': 'Vehicle_No_LR', 'E-Way Bill': 'Vehicle_No_Eway' } },
  { id: 'hsn', label: 'HSN', level: 'item', kind: 'hsn',
    sources: { 'Invoice': 'hsn_invoice', 'E-Way Bill': 'hsn_eway', 'GRN': 'hsn_grn' } },
  { id: 'description', label: 'Description', level: 'item', kind: 'description',
    sources: { 'Invoice': 'description_invoice', 'LR Copy': 'material_description_lr', 'E-Way Bill': 'description_eway', 'GRN': 'description_grn' } },
  { id: 'quantity', label: 'Quantity', level: 'item', kind: 'qty',
    sources: { 'Invoice': 'quantity_invoice', 'E-Way Bill': 'quantity_eway', 'GRN': 'quantity_grn' } },
  { id: 'uom', label: 'UOM', level: 'item', kind: 'text',
    sources: { 'Invoice': 'uom_invoice', 'E-Way Bill': 'uom_eway', 'GRN': 'uom_grn' } },
  /* Total Amount reads the LR's invoice_value_lr. On a consolidated LR that is the
     value of the whole consignment rather than of this one invoice, so it is
     flagged: shown unchanged on every invoice row and never divided between them. */
  { id: 'total_amount', label: 'Total Amount', level: 'document', kind: 'amount', consolidatedDocs: ['LR Copy'],
    sources: { 'Invoice': 'Total_Amount_Invoice', 'LR Copy': 'invoice_value_lr', 'E-Way Bill': 'Total_Amount_EWay', 'GRN': 'total_amount_grn' } },
  { id: 'taxable_amount', label: 'Taxable Amount', level: 'item', kind: 'amount',
    sources: { 'Invoice': 'taxable_amount_invoice', 'E-Way Bill': 'taxable_amount_eway', 'GRN': 'taxable_amount_grn' } },
  { id: 'tax_amount', label: 'Tax Amount', level: 'document', kind: 'amount',
    sources: { 'Invoice': 'tax_amount_invoice', 'E-Way Bill': 'tax_amount_eway', 'GRN': 'tax_amount_grn' } },
  { id: 'po_number', label: 'PO Number', level: 'document', kind: 'identifier',
    sources: { 'Invoice': 'po_number_invoice', 'LR Copy': 'po_number_lr' } },
  { id: 'do_number', label: 'DO Number', level: 'document', kind: 'identifier',
    sources: { 'Invoice': 'do_number_invoice', 'LR Copy': 'do_number_lr' } },
  { id: 'transporter', label: 'Transporter', level: 'document', kind: 'party',
    sources: { 'Invoice': 'transporter_name_invoice', 'LR Copy': 'transporter_name_lr', 'E-Way Bill': 'transporter_name_eway' } },
  { id: 'ewb_number', label: 'E-Way Number', level: 'document', kind: 'ewb',
    sources: { 'Invoice': 'ewb_number_invoice', 'LR Copy': 'EWB_Number_LR', 'E-Way Bill': 'EWB_Number_EWay' } },
  { id: 'lr_number', label: 'LR Number', level: 'document', kind: 'identifier',
    sources: { 'Invoice': 'lr_number_invoice', 'LR Copy': 'LR_Number_LR' } },
];

// The six outcomes, and nothing else. MISSING and NOT CHECKED are explicitly not
// failures — they are how the UI says "this document does not carry that field".
const FIELD_STATUS = {
  MATCH: 'MATCH',
  PARTIAL: 'PARTIAL',
  MISMATCH: 'MISMATCH',
  MISSING: 'MISSING',
  INVALID: 'INVALID',
  NOT_CHECKED: 'NOT CHECKED',
};

/* ── Comparison-only normalisation ───────────────────────────────────
   None of this touches a displayed value. The raw extracted string is always
   what the table shows; these are used only to decide a status. */

// Case, punctuation and whitespace out. The floor every other rule sits on.
const normAlnumUpper = (v) => String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
const normKey = (v) => String(v).toLowerCase().replace(/[^a-z0-9]/g, '');

/* Legal-form folding for party names, per the audit rule that "Limited" and
   "Ltd." are the same company. Deliberately narrow: the old helper also stripped
   city names and words like "works" and "plant", which made genuinely different
   vendors compare equal. Only case, spacing, punctuation and legal form go. */
const PARTY_LEGAL_FORMS = [
  [/\blimited\b/g, 'ltd'],
  [/\bprivate\b/g, 'pvt'],
  [/\bcorp(?:oration)?\b/g, 'corp'],
  [/\bcompany\b/g, 'co'],
  [/\bincorporated\b/g, 'inc'],
];
const normPartyName = (v) => {
  let s = String(v).toLowerCase().replace(/&/g, ' and ');
  PARTY_LEGAL_FORMS.forEach(([pattern, form]) => { s = s.replace(pattern, form); });
  return s.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
};

/* The tokens that PARTY_LEGAL_FORMS has already collapsed onto one another.
   Dropping them leaves the trading name, so a supplier billed as "Z V Steels" on
   one document and "Z V Steels Pvt Ltd" on another compares equal. "llp" and
   friends are deliberately NOT here - a LLP and a private limited company are
   separate legal entities, and folding them together would invent matches. */
const PARTY_FORM_TOKENS = new Set(['ltd', 'pvt', 'corp', 'co', 'inc']);
const partyCore = (name) => name.split(' ').filter(w => !PARTY_FORM_TOKENS.has(w)).join(' ');

// Digit strings, leading zeros dropped, so 00123 and 123 are the same number.
const normNumericText = (v) => String(v).replace(/\D/g, '').replace(/^0+(?=\d)/, '');

// 1 - Levenshtein/maxLength. Used only to separate OCR drift from a real
// difference in a short identifier; it is deliberately not used on free text.
const editSimilarity = (a, b) => {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
};

// Word-overlap between two free-text values, for descriptions that describe the
// same thing in different words. Scored 0-1; the boolean word-pair helper that
// the sales side uses lives elsewhere in this file.
const tokenOverlap = (a, b) => {
  const ta = new Set(normKey(a).split(' ').filter(Boolean));
  const tb = new Set(normKey(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  const shared = [...ta].filter(t => tb.has(t)).length;
  return shared / new Set([...ta, ...tb]).size;
};

// A GSTIN is 15 characters: 2 state digits, 5 letters, 4 digits, 1 letter,
// 1 entity digit, 3 characters.
const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z][0-9A-Z]{2}$/i;

// An E-Way Bill number is 12 digits. Anything else was not fully extracted.
const EWB_DIGITS = 12;

// What "invalid" means per kind, and whether a value can fail that check.
const PURCHASE_KIND_VALIDATOR = {
  gstin: (v) => GSTIN_PATTERN.test(normAlnumUpper(v).slice(0, 15)),
  ewb: (v) => normNumericText(v).length === EWB_DIGITS,
};

// ── Intelligent Comparison Utilities ─────────────────────────
const normalizeText = (text) => {
  if (!text || text === '—' || text === 'N/A') return '';
  return text.toString().toLowerCase().replace(/[^a-z0-9]/g, '').trim();
};

const normalizeDate = (text) => {
  if (!text || text === '—') return '';
  // Normalize dot path date formats by replacing dots with dashes
  const s = text.toString().trim().replace(/\./g, '-');
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const mmmMatch = s.match(/^(\d{1,2})[-\/](\w{3})[-\/](\d{2,4})$/);
  if (mmmMatch) {
    const day = mmmMatch[1].padStart(2, '0');
    const monthIdx = months.indexOf(mmmMatch[2].toLowerCase().substring(0, 3));
    if (monthIdx !== -1) {
      let year = mmmMatch[3];
      if (year.length === 2) year = '20' + year;
      return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${day}`;
    }
  }
  const numMatch = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{2,4})$/);
  if (numMatch) {
    const day = numMatch[1].padStart(2, '0');
    const month = numMatch[2].padStart(2, '0');
    let year = numMatch[3];
    if (year.length === 2) year = '20' + year;
    return `${year}-${month}-${day}`;
  }
  const ymdMatch = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[3].padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return normalizeText(s);
};

const extractNumericValue = (text) => {
  if (!text || text === '—') return null;
  const cleaned = text.toString().replace(/,/g, '').replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
};

const toKG = (value, text) => {
  if (value === null) return null;
  if (!text) return value;
  const lower = text.toString().toLowerCase();
  if (lower.includes('mt') || lower.includes('ton')) return value * 1000;
  return value;
};

/* ── Status engine ───────────────────────────────────────────────
   One field, one status, decided in a fixed order — the first rule that can
   decide the row does:

     1. fewer than two documents carry this field at all  → NOT CHECKED
     2. nothing was extracted for it                      → NOT CHECKED
     3. two or more carry it but only one has a value     → MISSING
     4. a supplied value fails its own format check        → INVALID
     5. otherwise compare the supplied values by kind      → MATCH / PARTIAL / MISMATCH

   MISSING and NOT CHECKED are never failures, and INVALID is kept apart from
   MISMATCH on purpose: an E-Way number the extractor only half-read is an
   extraction problem, not two documents disagreeing. */

const MATCH_REL_TOLERANCE = 0.001;   // 0.1% on money, weight and quantity
const PARTIAL_REL_TOLERANCE = 0.05;  // 5% before it becomes a real difference
const OCR_SIMILARITY_FLOOR = 0.85;   // for short identifiers only
const HSN_SECTION = 4;               // HSN: chapter shares its first 4 digits

/* Fuzzy floors, applied to every kind. OCR, spacing and unit wording all move a
   value without moving its meaning, so a high-similarity pair is PARTIAL rather
   than a red mismatch. Only a pair that fails both of these is a real conflict. */
const FUZZY_MATCH_FLOOR = 0.9;    // effectively the same value
const FUZZY_PARTIAL_FLOOR = 0.6;  // same value, captured differently

const PURCHASE_UNCHECKED_TEXT = 'No comparison';

const joinDocs = (docs) => (docs.length > 1 ? `${docs.slice(0, -1).join(', ')} and ${docs[docs.length - 1]}` : docs[0]);

/* One fuzzy verdict for a set of values, whichever kind they belong to.
   Word overlap catches reordering and extra or missing words; character-level
   similarity catches a mistyped or mis-OCRed digit. Both must be satisfied by
   the weakest pair in the set, so one outlier cannot be averaged away. */
const fuzzyVerdict = (present, values, kind) => {
  let weakest = 1;
  for (let i = 0; i < present.length; i += 1) {
    for (let j = i + 1; j < present.length; j += 1) {
      const a = values[present[i]];
      const b = values[present[j]];
      const ka = normKey(a);
      const kb = normKey(b);
      const blend = Math.max(tokenOverlap(ka, kb), editSimilarity(ka, kb));
      weakest = Math.min(weakest, blend);
    }
  }
  if (weakest >= FUZZY_MATCH_FLOOR) {
    return { status: FIELD_STATUS.MATCH, reason: 'Same value once spacing and punctuation are ignored' };
  }
  if (weakest >= FUZZY_PARTIAL_FLOOR) {
    return { status: FIELD_STATUS.PARTIAL, reason: kind === 'identifier' || kind === 'batch'
      ? 'Near-identical codes — likely OCR variation'
      : 'Values are close — likely the same value captured differently' };
  }
  return null;
};

/* Last gate before a row is allowed to call itself a mismatch. Every kind falls
   through here, so no field can report red on values that fuzzy reading says
   are the same. */
const mismatchUnlessFuzzy = (present, values, kind, reason) =>
  fuzzyVerdict(present, values, kind) || { status: FIELD_STATUS.MISMATCH, reason };

// Which of two candidate readings of the same numbers should be trusted:
// as extracted, or after converting tonnes to kilograms. A document that spells
// out its unit and one that omits it still mean the same quantity.
const bestNumericSet = (points, convertUnits) => {
  const raw = points.map(p => p.n);
  const converted = points.map(p => toKG(p.n, p.u));
  const spread = ns => Math.max(...ns) - Math.min(...ns);
  return spread(converted) < spread(raw) && convertUnits ? converted : raw;
};

const compareNumericField = (kind, present, values) => {
  const points = present
    .map(doc => ({ doc, n: extractNumericValue(values[doc]), u: values[doc] }))
    .filter(p => p.n !== null);
  if (points.length < 2) return { status: FIELD_STATUS.NOT_CHECKED, reason: PURCHASE_UNCHECKED_TEXT };

  const convertUnits = kind === 'weight' || kind === 'qty';
  const ns = bestNumericSet(points, convertUnits);
  const spread = Math.max(...ns) - Math.min(...ns);
  const scale = Math.max(...ns.map(Math.abs), 1);
  const unit = kind === 'amount' || kind === 'rate' ? '₹' : '';
  const show = v => `${unit}${v.toFixed(kind === 'amount' || kind === 'rate' ? 2 : 3)}`;

  if (spread <= Math.max(0.01, scale * MATCH_REL_TOLERANCE)) {
    return { status: FIELD_STATUS.MATCH, reason: `Values agree across ${points.length} documents` };
  }
  if (spread <= Math.max(1, scale * PARTIAL_REL_TOLERANCE)) {
    return { status: FIELD_STATUS.PARTIAL, reason: `Differs by ${show(spread)} — within rounding tolerance` };
  }
  // Different numbers can still be the same number written badly, so the fuzzy
  // reading gets a say before this row turns red.
  return mismatchUnlessFuzzy(
    present,
    values,
    kind,
    `${joinDocs(points.map(p => p.doc))} disagree by ${show(spread)}`
  );
};

const compareTextField = (kind, present, values) => {
  if (kind === 'party') {
    const norms = present.map(doc => normPartyName(values[doc]));
    if (new Set(norms).size === 1) return { status: FIELD_STATUS.MATCH, reason: 'Same party once legal form is folded' };
    /* Compare the trading name with the legal-form tokens removed, so a supplier
       billed as "Z V Steels" on one document and "Z V Steels Pvt Ltd" on another
       is the same company rather than a partial match. The tokens removed are
       only ones PARTY_LEGAL_FORMS already treats as synonyms, so this folds
       spelling differences without folding genuinely distinct entities. */
    const cores = norms.map(partyCore);
    if (cores.every(c => c && c === cores[0])) {
      return { status: FIELD_STATUS.MATCH, reason: 'Same company, legal form stated on some documents only' };
    }
    // Group companies legitimately differ, but only when they share a name stem.
    const stems = new Set(norms.map(n => n.split(' ').slice(0, 2).join(' ')));
    const words = new Set(norms.flatMap(n => n.split(' ')));
    if (stems.size === 1 && words.size > 0) {
      return { status: FIELD_STATUS.PARTIAL, reason: 'Same company name, different legal entity' };
    }
    return mismatchUnlessFuzzy(present, values, kind, `${joinDocs(present)} name different parties`);
  }

  if (kind === 'address') {
    const keys = present.map(doc => normKey(values[doc]));
    if (new Set(keys).size === 1) return { status: FIELD_STATUS.MATCH, reason: 'Addresses match' };
    let worst = 1;
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        worst = Math.min(worst, tokenOverlap(keys[i], keys[j]));
      }
    }
    if (worst >= 0.6) return { status: FIELD_STATUS.PARTIAL, reason: 'Address wording differs' };
    return mismatchUnlessFuzzy(present, values, kind, `${joinDocs(present)} point to different addresses`);
  }

  if (kind === 'description') {
    let worst = 1;
    for (let i = 0; i < present.length; i += 1) {
      for (let j = i + 1; j < present.length; j += 1) {
        worst = Math.min(worst, tokenOverlap(values[present[i]], values[present[j]]));
      }
    }
    if (worst >= 0.8) return { status: FIELD_STATUS.MATCH, reason: 'Descriptions agree' };
    if (worst >= 0.35) return { status: FIELD_STATUS.PARTIAL, reason: 'Same material described differently' };
    return mismatchUnlessFuzzy(present, values, kind, 'Descriptions describe different material');
  }

  if (kind === 'date') {
    const norms = present.map(doc => normalizeDate(values[doc]));
    if (new Set(norms).size === 1) return { status: FIELD_STATUS.MATCH, reason: 'Dates agree' };
    return mismatchUnlessFuzzy(present, values, kind, `${joinDocs(present)} carry different dates`);
  }

  // hsn / batch / identifier / plain text
  const norms = present.map(doc => normAlnumUpper(values[doc]));
  const unique = new Set(norms);
  if (unique.size === 1) return { status: FIELD_STATUS.MATCH, reason: 'Values match across documents' };

  if (kind === 'hsn') {
    if (new Set(norms.map(n => n.slice(0, HSN_SECTION))).size === 1) {
      return { status: FIELD_STATUS.PARTIAL, reason: 'Same HSN chapter, different sub-classification' };
    }
    return mismatchUnlessFuzzy(present, values, kind, 'HSN codes are in different chapters');
  }

  if (kind === 'identifier' || kind === 'batch') {
    let worst = 1;
    for (let i = 0; i < norms.length; i += 1) {
      for (let j = i + 1; j < norms.length; j += 1) {
        worst = Math.min(worst, editSimilarity(norms[i], norms[j]));
      }
    }
    if (worst >= OCR_SIMILARITY_FLOOR) {
      return { status: FIELD_STATUS.PARTIAL, reason: 'Near-identical codes — likely OCR variation' };
    }
  }

  return mismatchUnlessFuzzy(present, values, kind, `${joinDocs(present)} carry different values`);
};

/**
 * Decide one field row.
 * @param spec entry from PURCHASE_FIELD_SPEC
 * @param values map of document key to the raw extracted string
 * @returns {{status: string, reason: string}}
 */
const evaluatePurchaseField = (spec, values) => {
  const applicable = PURCHASE_DOC_KEYS.filter(doc => spec.sources[doc]);
  const present = applicable.filter(doc => hasSourceValue(values[doc]));

  if (applicable.length < 2 || present.length === 0) {
    return { status: FIELD_STATUS.NOT_CHECKED, reason: PURCHASE_UNCHECKED_TEXT };
  }
  if (present.length === 1) {
    const blank = applicable.filter(doc => !hasSourceValue(values[doc]));
    return { status: FIELD_STATUS.MISSING, reason: `Absent on ${joinDocs(blank)}` };
  }

  const validator = PURCHASE_KIND_VALIDATOR[spec.kind];
  if (validator) {
    const bad = present.filter(doc => !validator(values[doc]));
    if (bad.length > 0) {
      return {
        status: FIELD_STATUS.INVALID,
        reason: `${spec.label} on ${joinDocs(bad)} failed its format check`,
      };
    }
  }

  switch (spec.kind) {
    case 'amount':
    case 'rate':
    case 'qty':
    case 'weight':
    case 'number':
      return compareNumericField(spec.kind, present, values);
    case 'party':
    case 'address':
    case 'description':
    case 'date':
    case 'hsn':
    case 'identifier':
    case 'batch':
      return compareTextField(spec.kind, present, values);
    default:
      return compareTextField('text', present, values);
  }
};

// ── Purchase verdict schema ─────────────────────────────────────
// The purchase workflow records its conclusions as flat top-level columns
// instead of the nested report the older rows carry: a score/status pair, a set
// of YES / NO / PARTIAL match columns, and three newline-delimited finding
// lists. Only the columns a row actually populates are rendered, so a record
// that has not been through the current pipeline shows no invented verdicts.
const PURCHASE_MATCH_CHECKS = [
  { label: 'Supplier',       key: 'supplier_match' },
  { label: 'Bill To',        key: 'bill_to_match' },
  { label: 'Ship To',        key: 'ship_to_match' },
  { label: 'Supplier GSTIN', key: 'supplier_gstin_match' },
  { label: 'Ship To GSTIN',  key: 'ship_to_gstin_match' },
  { label: 'HSN',            key: 'hsn_match' },
  { label: 'Invoice Number', key: 'invoice_number_match' },
  { label: 'Invoice Date',   key: 'invoice_date_match' },
  { label: 'Description',    key: 'description_match' },
  { label: 'Batch / Coil',   key: 'batch_match' },
  { label: 'Quantity',       key: 'quantity_match' },
  { label: 'Rate',           key: 'rate_match' },
  { label: 'Amount',         key: 'amount_match' },
  { label: 'E-Way Bill',     key: 'ewb_match' },
  { label: 'Vehicle',        key: 'vehicle_match' },
  { label: 'Weight',         key: 'weight_match' },
];

// The approval written back to the `Result` column, in every casing the two
// purchase pipelines have used.
const normalizePurchaseDecision = (value) => {
  const raw = hasSourceValue(value) ? String(value).trim().toUpperCase() : '';
  if (raw === 'APPROVE' || raw === 'APPROVED' || raw === 'YES') return 'Approve';
  if (raw === 'REJECT' || raw === 'REJECTED' || raw === 'NO') return 'Reject';
  return null;
};

// A purchase audit reconciles four documents. Presence is judged by any
// populated column in that document's family rather than one anchor field,
// because GRN has no document-number column at all — only detail fields.
const PURCHASE_DOC_FAMILIES = [
  { key: 'invoice', label: 'Invoice',    match: k => /(?:_Invoice|\(Invoice\))$/i.test(k) },
  { key: 'eway',    label: 'E-Way Bill', match: k => /(?:_EWay|\(EWay\))$/i.test(k) },
  { key: 'lr',      label: 'LR',         match: k => /(?:_LR|\(LR\))$/i.test(k) },
  { key: 'grn',     label: 'GRN',        match: k => /(?:_grn|\(GRN\))$/i.test(k) },
];

const getPurchaseDocumentPresence = (record) => {
  const entries = Object.entries(record || {});
  const present = {};
  PURCHASE_DOC_FAMILIES.forEach(fam => {
    present[fam.key] = entries.some(([k, val]) => fam.match(k) && hasSourceValue(val));
  });
  return present;
};

/* One purchase audit is split across several ledger rows — one per reconciled
   document — and the history card groups them by invoice number. `records` is
   that group and the modal steps through it; the card passes the whole group so
   every row stays reachable. `audit` alone still works, so a single-row group
   needs no special case. */
const UnifiedAuditModal = ({ audit: initialAudit, records, onClose, onDecision, processingId }) => {
  const [view] = useState('universal');
  const [currentIndex, setCurrentIndex] = useState(0);
  // The control-check list is supporting detail behind the comparison matrix,
  // so a freshly opened record leads with the matrix alone; the counts in the
  // header still show what the pipeline concluded.
  const [checksOpen, setChecksOpen] = useState(false);
  // Material cards repeat what the matrix already shows, one document at a time.
  // Open by default because it is the view people actually ask for.
  const [materialOpen, setMaterialOpen] = useState(true);

  const groupRecords = records && records.length > 0 ? records : (initialAudit ? [initialAudit] : []);

  if (groupRecords.length === 0) return null;

  const totalRecords = groupRecords.length;
  // Clamped rather than trusted: a refetch can shrink the group under an open
  // modal, and the footer has to stay on a row that still exists.
  const safeIndex = Math.min(currentIndex, totalRecords - 1);
  const audit = groupRecords[safeIndex];
  // The decision is written per row, so only the row currently on screen can be
  // the one being written — not whichever row the group happens to open on.
  const isProcessing = processingId === audit.id;

  const parseAuditResult = (resultStr) => {
    if (!resultStr) return null;
    try {
      const parsed = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;
      const extracted = Array.isArray(parsed) ? parsed[0] : parsed;
      return normalizeAuditResult(extracted);
    } catch {
      return null;
    }
  }

  const result = parseAuditResult(audit.Audit_Result);

  // ── Field rows, built only from the declared spec ──
  // Nothing here guesses a label from a column name. Each row reads exactly the
  // columns PURCHASE_FIELD_SPEC gives it, so a field only ever appears because it
  // was written down, and the values in it can only come from documents it is
  // meant to be compared against.
  const fieldResults = PURCHASE_FIELD_SPEC.map((spec) => {
    const values = {};
    PURCHASE_DOC_KEYS.forEach((doc) => {
      const column = spec.sources[doc];
      values[doc] = column ? readPurchaseColumn(audit, column) : null;
    });
    // Which documents actually carried a value. A cell only gets tinted when at
    // least two did, because that is the only time there is something to
    // compare the value against.
    const comparableDocs = PURCHASE_DOC_KEYS.filter(doc => spec.sources[doc] && hasSourceValue(values[doc]));
    return { spec, values, comparableDocs, ...evaluatePurchaseField(spec, values) };
  });

  // Keep only the documents this record actually carries data for. Invoice is
  // the anchor document and is always shown, so a single-document audit still
  // has a column.
  const activeDocColumns = LEDGER_DOC_COLUMNS.filter(({ key }) =>
    fieldResults.some(({ spec, values }) => spec.sources[key] && hasSourceValue(values[key]))
  );

  /* A row where no document carries a value says nothing at all - it is an
     em-dash in every column, which reads as "this field failed" rather than "this
     document never had the field". Drop those rows so the matrix only shows what
     was actually extracted. A row that is populated in some documents but not
     others is kept, with the absent documents shown as "—", because that gap is
     the comparison. */
  const populatedFieldResults = fieldResults.filter(({ comparableDocs }) => comparableDocs.length > 0);

  // Counts what the table actually draws, so the header never claims more fields
  // than the auditor can see.
  const totalFields = populatedFieldResults.length;

  // The matrix rows, in spec order. A grouped audit repeats one invoice date
  // across all of its rows, so the date row is drawn on the first row of the
  // group only — on rows 2+ it would just re-print the same value.
  const visibleFieldResults = safeIndex === 0
    ? populatedFieldResults
    : populatedFieldResults.filter(({ spec }) => spec.id !== 'invoice_date');

  // ── Flat verdict columns written by the purchase workflow ──
  // Only the checks this row actually recorded are shown, so an un-audited or
  // partially-audited purchase never displays a verdict that was never made.
  const verdicts = PURCHASE_MATCH_CHECKS.filter(c => hasSourceValue(audit[c.key]));
  const hasVerdicts = verdicts.length > 0;
  const verdictSummary = verdicts.reduce((acc, c) => {
    const tone = matchTone(audit[c.key]);
    if (tone === 'positive') acc.match += 1;
    else if (tone === 'negative') acc.issue += 1;
    else if (tone === 'warning') acc.partial += 1;
    return acc;
  }, { match: 0, issue: 0, partial: 0 });

  // The workflow's own score is authoritative when present; older rows only
  // carry it inside the embedded JSON report. It is never derived locally —
  // a row the pipeline has not scored renders as "not recorded" rather than
  // inventing a percentage from the field-by-field comparison. The pipeline
  // writes it to `match_score` or `audit_score` depending on the run.
  const ledgerScore = pickScore(audit, result);
  const purchaseStatus = [audit.match_status, audit.audit_status].find(hasSourceValue) ?? null;

  /* The run's own conclusion, in prose. Newer pipelines write it to
     `audit_summary`; older rows only carry the embedded report string. Kept
     verbatim - this is the pipeline speaking, not something to reword. */
  const purchaseSummary = [
    audit.audit_summary,
    hasSourceValue(audit.Audit_Result) && !result ? audit.Audit_Result : null,
  ].find(hasSourceValue) ?? '';

  /* One card per document, built from PURCHASE_FIELD_SPEC rather than a second
     hand-written list. The matrix and these cards therefore cannot disagree
     about which column a value came from - there is only one mapping.

     A card lists every field that document declares, gaps included, because the
     empty ones are the point: they show which columns the extractor missed. Only
     a document that carries at least one real value gets a card at all. */
  const materialCards = PURCHASE_DOC_CARDS
    .map(({ doc, kind }) => ({
      doc,
      kind,
      title: DOC_ACCENTS[kind].label,
      rows: PURCHASE_FIELD_SPEC
        .filter(spec => spec.sources[doc])
        .map(spec => ({
          label: spec.label,
          value: showText(readPurchaseColumn(audit, spec.sources[doc])),
        })),
    }))
    .filter(card => card.rows.some(row => row.value !== '—'));
  const decision = normalizePurchaseDecision(audit.Result);

  /* Row tint, matching the sales matrix: red for a real conflict, amber for a
     near-match, flat when the row agrees. MISSING, INVALID and NOT CHECKED stay
     flat — none of them is a disagreement between documents. */
  const rowTint = (status) => {
    if (status === FIELD_STATUS.MISMATCH) return 'rgba(239,68,68,0.03)';
    if (status === FIELD_STATUS.PARTIAL || status === FIELD_STATUS.INVALID) return 'rgba(245,158,11,0.03)';
    return 'transparent';
  };

  /* Value colour inside a cell. Only a genuine conflict or an unreadable value
     is coloured; everything else is left as ordinary text. */
  const valueColor = (status, filled) => {
    if (!filled) return '#94a3b8';
    if (status === FIELD_STATUS.MISMATCH) return '#ef4444';
    if (status === FIELD_STATUS.PARTIAL || status === FIELD_STATUS.INVALID) return '#d97706';
    return 'var(--text)';
  };

  /* Cell wash, matching the sales matrix's per-document shading. */
  const cellWash = (status, filled, applicable, comparable) => {
    if (!filled || !applicable || !comparable) return 'transparent';
    if (status === FIELD_STATUS.MISMATCH) return 'rgba(239,68,68,0.10)';
    if (status === FIELD_STATUS.PARTIAL || status === FIELD_STATUS.INVALID) return 'rgba(245,158,11,0.10)';
    return 'rgba(16,185,129,0.10)';
  };

  /* One cell = one document's value for one spec row.
     A document that this field does not apply to gets an em dash, not "N/A" —
     absence of a field is not a finding. */
  const renderCell = (spec, docType, value, result) => {
    const applies = Boolean(spec.sources[docType]);
    const filled = applies && hasSourceValue(value);
    // With fewer than two documents carrying a value there is nothing to
    // compare, so the cell is not tinted either way.
    const comparable = result.comparableDocs.length >= 2;

    return (
      <td
        key={docType}
        data-label={docType}
        title={filled ? result.reason : ''}
        style={{
          ...purchaseTdStyle,
          minWidth: PURCHASE_VALUE_MIN_WIDTH,
          textAlign: 'center',
          background: cellWash(result.status, filled, applies, comparable),
        }}
      >
        <span style={{
          display: 'block', fontSize: '0.82rem', fontWeight: 600, fontFamily: 'monospace',
          color: valueColor(result.status, filled), lineHeight: 1.6,
          overflowWrap: 'anywhere',
        }}>
          {filled ? String(value).trim() : '—'}
        </span>
        {filled && spec.consolidatedDocs?.includes(docType) && (
          <span className="consolidated-badge" title="Repeated on every row of a consolidated LR. Not split, allocated or summed across rows.">
            CONSOLIDATED LR
          </span>
        )}
      </td>
    );
  };

  /* One row of the purchase comparison matrix, in the order the spec declares.
     The matrix is a fixed reading order, so grouping rows into sections would
     move fields away from where they belong. */
  const renderRow = (result) => {
    const { spec } = result;
    return (
      <tr style={{ borderBottom: '1px solid var(--border)', background: rowTint(result.status) }}>
        <td style={{
          ...purchaseTdStyle,
          minWidth: 150,
          fontWeight: 700,
          fontSize: '0.82rem',
          color: 'var(--text)',
          whiteSpace: 'nowrap',
        }}>
          {spec.label}
        </td>
        {renderCell(spec, 'Invoice', result.values.Invoice, result)}
        {activeDocColumns.map(({ key }) => renderCell(spec, key, result.values[key], result))}
      </tr>
    );
  };

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal-content animate-slide-up universal-modal ledger-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="header-text-group">
            <h2 className="modal-title">
              <Info className="text-primary" size={24} /> 
              Universal Document Ledger
            </h2>
            <p className="modal-subtitle">Ref: {audit.Invoice_Number_Invoice || audit.id}</p>
            {totalRecords > 1 && (
              <RecordStepper
                noun="Material"
                current={safeIndex}
                total={totalRecords}
                onSelect={setCurrentIndex}
              />
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
              {ledgerScore !== null ? (
                /* Uses the shared cap class rather than a one-off inline style,
                   so it aligns on the centre line like every other capsule
                   instead of on a baseline. The percent is its own element
                   because monospace draws % at full cap height, which towers
                   over the digits beside it. */
                <span className="cap cap-num" style={{
                  fontSize: '0.8rem',
                  background: SCORE_COLOR(ledgerScore).bg,
                  color: SCORE_COLOR(ledgerScore).text,
                  borderColor: SCORE_COLOR(ledgerScore).border,
                }}>
                  {ledgerScore}<span className="cap-pct">%</span>
                </span>
              ) : (
                /* No dial and no gauge anywhere in this modal any more: the
                   score reads as a flat chip beside the invoice reference, the
                   same way every other figure in the header does. Unscored rows
                   say so explicitly so a blank slot is never read as 0%. */
                <span className="audit-score-missing">
                  <Info size={12} />
                  <span>Not scored</span>
                </span>
              )}
              {hasSourceValue(purchaseStatus) && <AuditStatusBadge value={purchaseStatus} />}
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                padding: '0.2rem 0.6rem', borderRadius: '999px',
                fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase',
                letterSpacing: '0.05em', background: 'rgba(0,0,0,0.03)',
                color: 'var(--text-muted)', border: '1px solid var(--border)'
              }}>{activeDocColumns.length + 1} Documents</span>
              {decision && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                  padding: '0.2rem 0.65rem', borderRadius: '999px',
                  fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  background: decision === 'Approve' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                  color: decision === 'Approve' ? '#10b981' : '#ef4444',
                  border: `1px solid ${decision === 'Approve' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`
                }}>
                  {decision === 'Approve' ? <CheckCircle size={11} /> : <X size={11} />}
                  {decision === 'Approve' ? 'Approved' : 'Rejected'}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="close-btn" onClick={onClose}><X size={20} /></button>
          </div>
        </div>

        <div className="modal-body">
          {view === 'intelligence' ? (
            !result ? (
              <div className="empty-state">
                <AlertTriangle size={40} className="empty-icon" />
                <p>No granular intelligence packet available.</p>
              </div>
            ) : (
              <div className="intelligence-grid animate-fade-in premium">
                <div className="intelligence-main">
                  <div className="integrity-card glass">
                    <div className="integrity-viz">
                      <div className="viz-circle" style={{ 
                        borderColor: parseInt(result.overall?.final_score) > 80 ? 'var(--success)' : (parseInt(result.overall?.final_score) > 40 ? 'var(--warning)' : 'var(--error)')
                      }}>
                        <span className="viz-value">{result.overall?.final_score || '0%'}</span>
                        <span className="viz-label">COMPLIANCE</span>
                      </div>
                    </div>
                    <div className="integrity-info">
                      <div className={`status-badge-premium ${result.overall?.status?.toLowerCase().replace(/_/g, '')}`}>
                        {result.overall?.status?.replace(/_/g, ' ') || 'UNVERIFIED'}
                      </div>
                      <p className="integrity-desc">Aggregate document lifecycle analysis & discrepancy mapping.</p>
                    </div>
                  </div>

                  <div className="issues-list-minimal">
                    <h4 className="section-label">Intelligence Observations</h4>
                    <div className="issues-stack-minimal">
                      {result.issues?.length > 0 ? (
                        result.issues.map((issue, idx) => (
                          <div key={idx} className="issue-item-minimal">
                            <AlertTriangle size={14} />
                            <span>{issue.replace(/_/g, ' ')}</span>
                          </div>
                        ))
                      ) : (
                        <div className="issue-item-minimal success">
                          <CheckCircle size={14} />
                          <span>Zero discrepancies found. Integrity verified.</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="intelligence-metrics">
                  <h4 className="section-label">Verification Verticals</h4>
                  <div className="metric-group-premium">
                    <div className="metric-row-premium">
                      <div className="metric-meta"><FileText size={16} /><span>Invoice Identity</span></div>
                      <span className={`metric-status ${result.invoice_number_match?.invoice_vs_eway === 'MATCH' ? 'pass' : 'fail'}`}>
                        {result.invoice_number_match?.invoice_vs_eway || 'N/A'}
                      </span>
                    </div>
                    <div className="metric-row-premium has-tooltip">
                      <div className="metric-meta"><Truck size={16} /><span>Vehicle Positioning</span></div>
                      <span className={`metric-status ${parseInt(result.vehicle_match?.score) > 80 ? 'pass' : 'fail'}`}>
                        {result.vehicle_match?.score || 'Pending'}
                      </span>
                      <div className="tooltip-mini">
                        <div className="tooltip-row"><span>EWB No:</span> <strong>{readPurchaseColumn(audit, 'Vehicle_No_EWay') || '—'}</strong></div>
                        <div className="tooltip-row"><span>LR No:</span> <strong>{readPurchaseColumn(audit, 'Vehicle_No_LR') || '—'}</strong></div>
                      </div>
                    </div>
                    <div className="metric-row-premium has-tooltip">
                      <div className="metric-meta"><IndianRupee size={16} /><span>Financial Value</span></div>
                      <span className={`metric-status ${parseInt(result.amount_match?.score) === 100 ? 'pass' : 'fail'}`}>
                        {result.amount_match?.score || '—'}
                      </span>
                      <div className="tooltip-mini">
                        <div className="tooltip-row"><span>INV AMT:</span> <strong>₹{parseFloat((audit.Total_Amount_Invoice || '0').toString().replace(/[^0-9.-]/g, ''))?.toLocaleString('en-IN') || '0'}</strong></div>
                        <div className="tooltip-row"><span>EWB AMT:</span> <strong>₹{parseFloat((audit.Total_Amount_EWay || '0').toString().replace(/[^0-9.-]/g, ''))?.toLocaleString('en-IN') || '0'}</strong></div>
                        <div className="tooltip-divider"></div>
                        <div className="tooltip-row"><span>DIFF:</span> <strong>₹{Math.abs(parseFloat(result.amount_match?.difference || 0)).toLocaleString('en-IN')}</strong></div>
                      </div>
                    </div>
                    <div className="metric-row-premium has-tooltip">
                      <div className="metric-meta"><Activity size={16} /><span>Weight Verification</span></div>
                      <span className={`metric-status ${result.weight_match?.score === 'MATCH' || parseInt(result.weight_match?.score) > 80 ? 'pass' : 'fail'}`}>
                        {result.weight_match?.score || '—'}
                      </span>
                      <div className="tooltip-mini">
                        <div className="tooltip-row"><span>INV Weight:</span> <strong>{audit['Invoice_Weight_(Invoice)'] || audit.Invoice_Weight_Invoice || '—'} MT</strong></div>
                        <div className="tooltip-row"><span>EWB Weight:</span> <strong>{audit['EWB_Weight_(EWay)'] || audit.EWB_Weight_EWay || '—'} MT</strong></div>
                        <div className="tooltip-row"><span>LR Weight:</span> <strong>{audit.Weight_LR || '—'} MT</strong></div>
                      </div>
                    </div>
                  </div>
                  {result.invoice_number_match?.remarks && (
                    <div className="technical-summary-minimal" style={{ marginTop: '3.3rem' }}>
                      <Info size={12} /><span>{result.invoice_number_match.remarks}</span>
                    </div>
                  )}
                  {parseInt(result.overall?.final_score) < 100 && (
                     <div className="metric-row-premium" style={{ background: 'rgba(239, 68, 68, 0.05)', borderColor: 'rgba(239, 68, 68, 0.1)', marginTop: '0.75rem' }}>
                        <span className="section-label" style={{ margin: 0, color: '#ef4444' }}>Integrity Deduction</span>
                        <span style={{ color: '#ef4444', fontWeight: 950, fontSize: '0.8rem' }}>-{100 - parseInt(result.overall?.final_score)}% Impact</span>
                     </div>
                  )}
                </div>
              </div>
            )
          ) : (
            <>
              <div className="universal-table-wrapper animate-fade-in">
                <table style={{
                  width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem',
                  border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden'
                }}>
                  <thead>
                    <tr style={{ background: 'rgba(0,0,0,0.03)' }}>
                      <th style={purchaseThStyle}>Field</th>
                      <th style={{ ...purchaseThStyle, textAlign: 'center' }}>Invoice</th>
                      {activeDocColumns.map(({ key, label }) => (
                        <th key={key} style={{ ...purchaseThStyle, textAlign: 'center' }}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleFieldResults.map(renderRow)}
                  </tbody>
                </table>
              </div>

              {/* ── Control Checks ─────────────────────────────────────────
                  The audit workflow's own YES / NO / PARTIAL verdicts, kept
                  deliberately separate from the comparison matrix above. The
                  matrix is computed in this browser from the raw document
                  columns; these are what the pipeline recorded for the same
                  row, and they cover controls the matrix does not carry
                  (batch, weight, rate). The two can disagree, so an auditor
                  has to be able to read both.

                  Collapsed when the record opens: the matrix is the reason this
                  modal exists, and the three count cards stay on screen so the
                  pipeline's headline verdict is never more than one click away. */}
              {hasVerdicts && (
                <section className="audit-block animate-fade-in">
                  <button
                    type="button"
                    className="audit-block-head audit-block-toggle"
                    onClick={() => setChecksOpen(o => !o)}
                    aria-expanded={checksOpen}
                  >
                    <h4 className="audit-block-title">
                      <Shield size={13} />
                      Control Checks
                    </h4>
                    <div className={`verdict-summary${checksOpen ? ' is-expanded' : ''}`}>
                      {verdictSummary.match > 0 && (
                        <span className="stat-chip match-chip"><Check size={11} /> {verdictSummary.match} Match</span>
                      )}
                      {verdictSummary.partial > 0 && (
                        <span className="stat-chip partial-chip"><AlertTriangle size={11} /> {verdictSummary.partial} Partial</span>
                      )}
                      {verdictSummary.issue > 0 && (
                        <span className="stat-chip mismatch-chip"><X size={11} /> {verdictSummary.issue} Issue{verdictSummary.issue !== 1 ? 's' : ''}</span>
                      )}
                      <ChevronDown
                        size={15}
                        className={`audit-toggle-caret${checksOpen ? ' is-open' : ''}`}
                      />
                    </div>
                  </button>

                  {checksOpen && (
                    <div className="audit-check-grid">
                      {verdicts.map(c => <CheckRow key={c.key} label={c.label} value={audit[c.key]} />)}
                    </div>
                  )}
                </section>
              )}

              {/* The same per-document view the sales modal calls Material Information. It
                  restates the matrix one card at a time, which is easier to read
                  when you are checking a single document rather than scanning
                  across columns. */}
              {materialCards.length > 0 && (
                <section className="audit-block animate-fade-in">
                  <button
                    type="button"
                    className="audit-block-head audit-block-toggle"
                    onClick={() => setMaterialOpen(o => !o)}
                    aria-expanded={materialOpen}
                  >
                    <h4 className="audit-block-title">
                      <ClipboardList size={13} />
                      Material Information
                    </h4>
                    <div className={`verdict-summary${materialOpen ? ' is-expanded' : ''}`}>
                      <span className="cap">
                        {materialCards.length} Document{materialCards.length !== 1 ? 's' : ''}
                      </span>
                      <ChevronDown
                        size={15}
                        className={`audit-toggle-caret${materialOpen ? ' is-open' : ''}`}
                      />
                    </div>
                  </button>

                  {materialOpen && (
                    <div className="audit-doc-grid">
                      {materialCards.map(card => (
                        <DocPanel key={card.kind} kind={card.kind} title={card.title} rows={card.rows} />
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* The workflow's own written conclusion, shown on its own. The
                  findings lists it was generated alongside were dropped, but the
                  summary is the part an auditor actually reads to decide. */}
              <SummaryBlock summary={purchaseSummary} />
            </>
          )}
        </div>

<div className="modal-footer">
            {/* Page position is deliberately not repeated here. The capsule in
                the header already states it, and two counters for one value is
                how they drift out of step. */}
            <p className="footer-hint">
              {activeDocColumns.length + 1}-way cross-document validation — {totalFields} fields analyzed
            </p>
            <div className="flex footer-actions">
                <button className="btn btn-outline" onClick={onClose}>Close</button>
                {decision ? (
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                    padding: '0.5rem 1rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 700,
                    background: decision === 'Approve' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                    color: decision === 'Approve' ? '#10b981' : '#ef4444',
                    border: `1px solid ${decision === 'Approve' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`
                  }}>
                    {decision === 'Approve' ? <CheckCircle size={14} /> : <X size={14} />}
                    {decision === 'Approve' ? 'Approved' : 'Rejected'}
                  </span>
                ) : (
                <div className="flex action-group">
                  <button
                    className="btn btn-reject"
                    onClick={() => onDecision(audit.id, 'Reject')}
                    disabled={isProcessing}
                  >
                    Reject Match
                  </button>
                  <button
                    className="btn btn-approve"
                    onClick={() => onDecision(audit.id, 'Approve')}
                    disabled={isProcessing}
                  >
                    Approve Match
                  </button>
                </div>
                )}
            </div>
        </div>
      </div>
    </div>
  )
}

// ── Sales field comparison map ─────────────────────────────────
const SALES_COMPARE_FIELDS = [
  { label: 'Order Number',       invoice: 'inv_order_number',        so: 'so_number',            po: null,                    gp: 'gp_so_number',         ws: null,                       type: 'text', nowrap: true },
  { label: 'PO Number',          invoice: 'inv_party_order_number',  so: 'so_po_number',         po: 'po_number',             gp: 'gp_po_number',          ws: null,                       type: 'text', nowrap: true },
  { label: 'Customer / Party',   invoice: 'inv_bill_to_name',        so: 'so_customer_name',     po: 'po_customer_name',      gp: 'gp_party_name',        ws: 'ws_party_name',            type: 'name' },
  { label: 'Supplier',           invoice: null,                      so: null,                   po: 'po_supplier_name',      gp: null,                    ws: null,                       type: 'text', conditional: 'po' },
  { label: 'Broker',             invoice: 'inv_broker_name',         so: 'so_broker_name',       po: null,                    gp: null,                    ws: null,                       type: 'broker' },
  { label: 'Rate',               invoice: 'inv_rate',                so: 'so_rate',              po: 'po_rate',              gp: null,                    ws: null,                       type: 'numeric' },
  { label: 'Quantity',           invoice: 'inv_quantity',            so: 'so_quantity',          po: 'po_quantity',          gp: 'gp_quantity',          ws: 'ws_net_weight',            type: 'quantity' },
  { label: 'Unit',               invoice: 'inv_unit',                so: 'so_unit',              po: 'po_unit',              gp: 'gp_unit',               ws: null,                       type: 'text' },
  { label: 'Weight',             invoice: null,                      so: null,                   po: null,                    gp: 'gp_weight',             ws: 'ws_gross_weight',         wsExtra: 'ws_net_weight', wsLabel: 'Gross', wsExtraLabel: 'Net', type: 'quantity' },
  { label: 'Payment Terms',      invoice: 'inv_payment_terms',       so: 'so_payment_terms',     po: 'po_payment_terms',     gp: null,                    ws: null,                       type: 'text' },
  { label: 'Delivery Terms',     invoice: null,                      so: 'so_delivery_terms',    po: 'po_delivery_terms',    gp: null,                    ws: null,                       type: 'text' },
  { label: 'Thickness',          invoice: 'inv_thickness',           so: 'so_thickness',         po: 'po_thickness',          gp: 'gp_thickness',          ws: null,                       type: 'numeric' },
  { label: 'Width',              invoice: 'inv_width',               so: 'so_width',              po: 'po_width',              gp: 'gp_width',              ws: null,                       type: 'numeric' },
  { label: 'Length',             invoice: 'inv_length',              so: 'so_length',             po: 'po_length',             gp: 'gp_length',              ws: null,                       type: 'numeric' },
  { label: 'Vehicle Number',     invoice: 'inv_vehicle_number',      so: null,                   po: null,                    gp: 'gp_vehicle_number',    ws: 'ws_vehicle_number',        type: 'text', nowrap: true },
  { label: 'Material',           invoice: 'inv_notes',                so: 'so_product',           po: 'po_material_grade',     gp: 'gp_product',            ws: 'ws_material_description',  type: 'text', invoiceFallback: 'inv_product', poFallback: 'po_material_description' },
  { label: 'Coil Number',        invoice: null,                      so: 'so_coil_number',       po: null,                    gp: 'gp_coil_number',        ws: null,                       type: 'text', nowrap: true },
  { label: 'GSTIN',              invoice: 'inv_gstin',               so: null,                   po: 'po_gstin',              gp: null,                    ws: null,                       type: 'text' },
];

// Group sales records by the main order number (so_number OR so_po_number)
const getSalesGroupKey = (record) =>
  record.so_number || record.so_po_number || record['so_number'] || 'Unknown';

/* Group purchase records by invoice number. One purchase audit writes a row per
   reconciled document, so several rows share an invoice number and belong to the
   same audit on screen.

   The fallbacks are the alternate spellings the purchase pipeline has written the
   same value under. Rows with no invoice number at all are NOT bucketed together
   the way the sales side buckets 'Unknown' — they have nothing in common, so each
   falls back to its own row id and stays a card of its own. */
const getPurchaseGroupKey = (record) => {
  const candidates = [
    record.Invoice_Number_Invoice,
    record.invoice_number,
    record.inv_number,
    record.tax_invoice_number,
  ];
  const invoiceNo = candidates.find(hasSourceValue);
  if (invoiceNo) return String(invoiceNo).trim().toUpperCase();
  return record.id !== undefined && record.id !== null ? `row-${record.id}` : null;
};

// Common abbreviation normalizer for name fuzzy matching
const normalizeNameTokens = (str) => {
  const ABBR = { 'ltd': 'limited', 'pvt': 'private', 'co': 'company', 'corp': 'corporation', 'intl': 'international', 'ind': 'industries', 'mfg': 'manufacturing' };
  return str
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')    // strip punctuation
    .split(/\s+/)
    .filter(Boolean)
    .map(t => ABBR[t] || t);        // expand abbreviations
};

// Simple Levenshtein distance for spelling mistakes
const levenshtein = (a, b) => {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
  }
  return matrix[b.length][a.length];
};

// Honorifics/terms-of-address (e.g. "Bhai" = brother) that should not count toward the actual name
const NAME_HONORIFICS = new Set([
  'bhai', 'bhaya', 'bhay', 'bhaiji', 'ji', 'sahab', 'sahib',
  'shri', 'shree', 'sri', 'smt', 'mr', 'mrs', 'ms', 'miss', 'dr',
  'brother', 'bro', 'sir', 'm/s', 'm/s.'
]);

const stripHonorifics = (tokens) => {
  const filtered = tokens.filter(t => !NAME_HONORIFICS.has(t));
  return filtered.length ? filtered : tokens;
};

// Two name words are the same word when they are identical, one contains the
// other, or they sit within a small typo budget that scales with word length
// (1 typo for 3-5 letter words like "jay"/"jai", 2 typos for 6+ letter words).
const tokenSimilarity = (a, b) => {
  if (a === b) return true;
  if (a.length > 3 && b.includes(a)) return true;
  if (b.length > 3 && a.includes(b)) return true;
  const longest = Math.max(a.length, b.length);
  if (longest < 3) return false;
  return levenshtein(a, b) <= Math.max(1, Math.round(longest / 4));
};

const normalizeAuditResult = (result) => {
  if (!result || !result.output?.overall_summary) return result;
  const o = result.output;
  const di = o.detailed_issues?.[0] || {};
  const fi = o.field_issues || {};
  const isMatch = (arr) => !arr?.length;
  return {
    overall: {
      final_score: (o.overall_summary.average_score || '0').replace('%', ''),
      status: o.overall_summary.overall_status || 'UNVERIFIED'
    },
    issues: di.key_issues || [],
    invoice_number_match: {
      invoice_vs_eway: isMatch(fi.invoice_number_lr_mismatch) && isMatch(fi.invoice_number_grn_mismatch) ? 'MATCH' : 'MISMATCH'
    },
    vehicle_match: { score: isMatch(fi.vehicle_mismatch) ? 'MATCH' : 'MISMATCH' },
    amount_match: { score: isMatch(fi.amount_mismatch) ? 'MATCH' : 'MISMATCH' },
    weight_match: { score: isMatch(fi.weight_mismatch) ? 'MATCH' : 'MISMATCH' },
  };
};

const fuzzyNameMatch = (a, b) => {
  const ta = stripHonorifics(normalizeNameTokens(a));
  const tb = stripHonorifics(normalizeNameTokens(b));
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer  = ta.length <= tb.length ? tb : ta;
  // Each word of the shorter name must appear in the longer one (order is ignored)
  const matched = shorter.filter(st => longer.some(lt => tokenSimilarity(st, lt)));
  return matched.length / shorter.length >= 0.7;
};

// Broker names often carry an honorific suffix (e.g. "Namdev Bhai" where Bhai = brother).
// Match on the stripped-down name — "JAY BHAI USA" and "Jai Bhai USA" are the same broker.
const brokerNameMatch = (a, b) => {
  if (!a || !b) return false;
  const ta = stripHonorifics(normalizeNameTokens(a));
  const tb = stripHonorifics(normalizeNameTokens(b));
  if (ta.length === 0 || tb.length === 0) return false;

  const firstA = ta[0];
  const firstB = tb[0];
  if (tokenSimilarity(firstA, firstB)) return true;

  // Fall back to matching the whole stripped name regardless of word order,
  // so "USA Jai Bhai" still resolves to "Jai Bhai USA".
  return fuzzyNameMatch(a, b);
};

const salesValuesMatch = (a, b, type = 'text') => {
  if (!a && !b) return true;
  if (!a || !b) return false;

  const clean = v => v.toString().replace(/,/g, '').trim();

  if (type === 'name') return fuzzyNameMatch(a, b);
  if (type === 'broker') return brokerNameMatch(a, b);

  // For numeric/quantity, extract just the numbers if there's text attached (e.g. '150 DAYS' -> 150)
  const extractNum = (v) => {
     const match = v.toString().match(/-?\d+(\.\d+)?/);
     return match ? parseFloat(match[0]) : NaN;
  };

  const na = extractNum(clean(a));
  const nb = extractNum(clean(b));

  if (type === 'quantity') {
    // 1 MT = 1000 kgs. Tolerance is 250 kgs (0.25 MT).
    if (!isNaN(na) && !isNaN(nb)) return (Math.abs(na - nb) * 1000) <= 250;
  }

  if (type === 'numeric') {
    if (!isNaN(na) && !isNaN(nb)) {
      if (Math.abs(na - nb) < 0.01) return true;
      // Handle rate scale differences (e.g. 68.5 per KG vs 68500 per MT)
      const raKg = na > 500 ? na / 1000 : na;
      const rbKg = nb > 500 ? nb / 1000 : nb;
      if (Math.abs(raKg - rbKg) < 0.5) return true;
    }
  }

  // Canonicalize payment-term style values: "30D"/"30 D"/"30 d" -> "30 days"
  const normalizeTerms = (v) => {
    const m = v.toString().trim().toLowerCase().match(/^(\d+)\s*d$/);
    return m ? `${m[1]} days` : v;
  };

  const ca = normalizeTerms(clean(a).toLowerCase());
  const cb = normalizeTerms(clean(b).toLowerCase());
  if (ca === cb) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;

  // Steel material grade acronyms & form terms recognition
  const keySteelAcronyms = new Set([
    'hrpo', 'hr', 'cr', 'crca', 'gi', 'gp', 'gl', 'gpsp', 'ppgl', 'ppgi',
    'tmt', 'wr', 'is2062', 'e250', 'e350', 'e34', 'e410', 'ys350', 'sailhard',
    'st52', 'c45', 'en8', 'ss304', 'ss316'
  ]);

  // Grade labels that denote the same material under different trade names.
  // e.g. "CRCA 1" and "CR1" are both cold-rolled close annealed.
  // Extend this map as further equivalences come in.
  const gradeAliases = { cr: 'crca', cr1: 'crca', crca: 'crca', crc: 'crca' };
  const canonicalGrade = (token) => gradeAliases[token] || token;

  // Spelled-out grade names resolve to the same token as their acronym, so
  // "Cold Rolled Plates 2 mm" carries the same grade as "CRCA".
  const gradePhrases = [
    [/\bcold[\s-]*rolled\b/g, 'crca'],
    [/\bhot[\s-]*rolled\b/g, 'hrpo'],
    [/\bgalvani[sz]ed\b/g, 'gi'],
    [/\bpre[\s-]*galvani[sz]ed\b/g, 'gp'],
  ];
  const applyGradePhrases = (str) =>
    gradePhrases.reduce((acc, [pattern, token]) => acc.replace(pattern, token), str);

  const formTerms = new Set(['slit', 'coil', 'sheet', 'plate', 'patta', 'strip', 'cut', 'pkt', 'bundle',
    'slits', 'coils', 'sheets', 'plates', 'pattas', 'strips', 'bundles']);

  // Token overlap matching for material descriptions, products, and text
  const stopWords = new Set(['x', 'mm', 'tolerance', 'to', 'and', 'the', 'of', 'for', 'with', 'in', 'min', 'mpa', 'uts', 'ys',
    'pcs', 'nos', 'qty', 'no']);
  // Dimension expressions such as "2x1250" or "00x1250x2500" are compared in their
  // own rows, so they must not let two different grades match on a shared size.
  const isDimensionToken = (t) => /^\d+(?:\.\d+)?x\d/i.test(t);
  const getTokens = (str) =>
    applyGradePhrases(str)
       .replace(/[^a-z0-9\s]/g, ' ')
       .split(/\s+/)
       .filter(t => t.length >= 2 && !stopWords.has(t) && !/^\d+(\.\d+)?$/.test(t) && !isDimensionToken(t))
       .map(canonicalGrade);

  const ta = getTokens(ca);
  const tb = getTokens(cb);
  if (ta.length > 0 && tb.length > 0) {
    // 1. Direct steel grade acronym match (e.g., 'hrpo' in both "HRPO SLIT" and "E34 HRPO 1.6mm")
    const steelMatch = ta.some(t => keySteelAcronyms.has(t) && tb.includes(t));
    if (steelMatch) return true;

    // 2. Token overlap ignoring form factor terms (e.g., 'slit', 'coil')
    const taGrade = ta.filter(t => !formTerms.has(t));
    const tbGrade = tb.filter(t => !formTerms.has(t));
    const shorter = (taGrade.length > 0 && taGrade.length <= tbGrade.length) ? taGrade : (tbGrade.length > 0 ? tbGrade : ta);
    const longer  = (taGrade.length > 0 && taGrade.length <= tbGrade.length) ? tbGrade : ta;

    const matches = shorter.filter(st => longer.some(lt => lt === st || lt.includes(st) || st.includes(lt)));
    if (matches.length > 0 && (matches.length / shorter.length >= 0.5)) return true;
  }

  return false;
};

const INTELLIGENCE_KEYS = new Set([
  'audit_score', 'audit_status', 'audit_summary',
  'customer_match', 'po_match', 'so_match', 'vehicle_match',
  'weight_slip_match', 'quantity_match', 'material_match',
  'date_match', 'gst_match', 'amount_match',
  'dimension_match', 'rate_match', 'payment_terms_match',
  'delivery_terms_match', 'weight_match', 'coil_match',
  'grade_match', 'packing_match',
  'critical_mismatches', 'warnings', 'missing_documents'
]);

const SCORE_COLOR = (score) => {
  if (score === null || score === undefined) return { bg: 'rgba(100,116,139,0.1)', text: '#64748b', border: 'rgba(100,116,139,0.2)' };
  const s = Number(score);
  if (s >= 90) return { bg: 'rgba(16,185,129,0.12)', text: '#10b981', border: 'rgba(16,185,129,0.25)' };
  if (s >= 75) return { bg: 'rgba(245,158,11,0.12)', text: '#eab308', border: 'rgba(245,158,11,0.25)' };
  return { bg: 'rgba(239,68,68,0.12)', text: '#ef4444', border: 'rgba(239,68,68,0.25)' };
};

// Match statuses are normalised to a single visual language so an auditor reads
// every check the same way: MATCH/YES = verified, MISMATCH/NO = failed,
// PARTIAL = needs review, missing (null) = never evaluated.
// ── Sales detail value formatters ───────────────────────────────
// Source columns arrive from the database as raw strings/numbers, so every
// formatter here is strictly a presentation layer: it never derives a value
// that is not present in the record, and it never renders a missing value as
// literal text — missing data is always shown as a dash.
const MISSING_TEXT = new Set(['', 'null', 'undefined', 'nan']);

const hasSourceValue = (val) => {
  if (val === null || val === undefined) return false;
  if (typeof val === 'number') return !Number.isNaN(val);
  if (typeof val === 'string') return !MISSING_TEXT.has(val.trim().toLowerCase());
  return true;
};

const showText = (val) => (hasSourceValue(val) ? String(val).trim() : '—');

const parseAmount = (val) => {
  if (!hasSourceValue(val)) return null;
  const match = String(val).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = parseFloat(match[0]);
  return Number.isNaN(n) ? null : n;
};

const showMoney = (val) => {
  if (!hasSourceValue(val)) return '—';
  const n = parseAmount(val);
  if (n === null) return String(val).trim();
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const showRate = (val) => {
  if (!hasSourceValue(val)) return '—';
  const n = parseAmount(val);
  if (n === null) return String(val).trim();
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

// Quantities always carry the unit of the document they came from
// (e.g. "3.02 MT", "3000 KG", "292 PCS"); no unit is assumed when absent.
const showQuantity = (val, unit) => {
  if (!hasSourceValue(val)) return '—';
  const text = String(val).trim();
  return hasSourceValue(unit) ? `${text} ${String(unit).trim()}` : text;
};

// Dimensions render as Thickness × Width × Length, skipping only the
// dimensions the source did not record.
const showDimensions = (...parts) => {
  const dims = parts.filter(hasSourceValue).map(part => String(part).trim());
  return dims.length ? dims.join(' × ') : '—';
};

// Findings may arrive as plain sentences or as structured objects; both are
// rendered without inventing content.
const findingText = (item) => {
  if (!hasSourceValue(item)) return null;
  if (typeof item !== 'object') return String(item).trim();
  const parts = Object.entries(item)
    .filter(([, val]) => hasSourceValue(val))
    .map(([key, val]) => `${key.replace(/_/g, ' ')}: ${showText(val)}`);
  return parts.length ? parts.join(' · ') : null;
};

const toList = (items) => {
  if (!Array.isArray(items)) return [];
  return items.map(findingText).filter(Boolean);
};

// Match statuses are normalised to a single visual language so an auditor reads
// every check the same way: MATCH/YES = verified, MISMATCH/NO = failed,
// PARTIAL = needs review, missing (null) = never evaluated.
const MATCH_TONES = {
  positive: { bg: 'rgba(16,185,129,0.12)', text: '#10b981', border: 'rgba(16,185,129,0.25)' },
  negative: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444', border: 'rgba(239,68,68,0.25)' },
  warning:  { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.25)' },
  neutral:  { bg: 'rgba(100,116,139,0.08)', text: '#94a3b8', border: 'rgba(100,116,139,0.2)' },
};

const matchTone = (val) => {
  if (!hasSourceValue(val)) return 'neutral';
  const raw = String(val).trim().toUpperCase().replace(/\s+/g, '_');
  if (raw.includes('MISMATCH')) return 'negative';
  if (raw.includes('PARTIAL')) return 'warning';
  if (raw.startsWith('NOT') || raw === 'N/A' || raw === 'NA' || raw === 'PENDING' || raw.includes('UNVERIFIED') || raw.includes('UNKNOWN') || raw.includes('SKIPPED')) return 'neutral';
  if (raw.startsWith('NO') || raw.includes('FAIL') || raw.includes('REJECT') || raw.includes('FALSE')) return 'negative';
  if (raw.includes('MATCH') || raw.includes('YES') || raw.includes('PASS') || raw.includes('TRUE') || raw.includes('VERIFIED') || raw === 'OK' || raw === 'GOOD') return 'positive';
  return 'neutral';
};

const MATCH_STATUS_BADGE = (val) => {
  const tone = matchTone(val);
  const label = { positive: 'MATCH', negative: 'MISMATCH', warning: 'PARTIAL', neutral: 'NOT CHECKED' }[tone];
  return { label, tone, ...MATCH_TONES[tone] };
};

const AUDIT_STATUS_BADGE = (val) => {
  const tone = matchTone(val);
  return {
    label: hasSourceValue(val) ? String(val).trim().replace(/_/g, ' ').toUpperCase() : 'NOT RECORDED',
    tone,
    ...MATCH_TONES[tone],
  };
};

const fmt = (v) => (v !== null && v !== undefined && v !== '') ? v.toString() : null;

// ── Sales detail building blocks ────────────────────────────────
const DOC_ACCENTS = {
  so:      { icon: FileSpreadsheet, label: 'Sales Order',   color: '#10b981', bg: 'rgba(16,185,129,0.10)' },
  po:      { icon: ShoppingCart,    label: 'Purchase Order', color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
  invoice: { icon: FileText,        label: 'Invoice',       color: '#3b82f6', bg: 'rgba(37,99,235,0.10)' },
  gp:      { icon: ClipboardList,   label: 'Gate Pass',     color: '#06b6d4', bg: 'rgba(6,182,212,0.10)' },
  ws:      { icon: Scale,           label: 'Weight Slip',   color: '#f43f5e', bg: 'rgba(244,63,94,0.10)' },
  lr:      { icon: Truck,           label: 'LR Copy',       color: '#8b5cf6', bg: 'rgba(139,92,246,0.10)' },
  eway:    { icon: Truck,           label: 'E-Way Bill',    color: '#0ea5e9', bg: 'rgba(14,165,233,0.10)' },
  grn:     { icon: ClipboardList,   label: 'GRN',           color: '#d97706', bg: 'rgba(217,119,6,0.10)' },
};

// The purchase documents a material card can be built for, in the same order as
// the matrix columns so the two read left to right together.
const PURCHASE_DOC_CARDS = [
  { doc: 'Invoice',    kind: 'invoice' },
  { doc: 'LR Copy',    kind: 'lr' },
  { doc: 'E-Way Bill', kind: 'eway' },
  { doc: 'GRN',        kind: 'grn' },
];

/* Which dot slots to render, given a live index and a total.

   Below the cap every record gets a dot. Above it, a long ledger would produce
   a meaningless wall of identical dots, so the first and last are pinned and the
   live record gets a run of neighbours between them. Gaps between runs are
   marked with an ellipsis rather than quietly closed up, because a dot row that
   silently hides the ends is worse than one that admits it trimmed them. */
/* One record switcher, shared by both ledger modals.
   They were built separately and had drifted apart: purchase had a capsule
   stepper, sales had bare "Item 1 of 3" text flanked by two separate buttons
   and a row of 8px dots. Same job, two different looks.

   Position is stated as a page number. Morphing dots were tried here and read as
   decoration: at this size, sitting under a title in a modal, nobody could tell
   they were the slider. A number is unambiguous and states the total, which is
   the part a dot row of any length cannot tell you. */
const RecordStepper = ({ noun, current, total, onSelect }) => {
  const shellRef = useRef(null);
  const wheelLock = useRef(0);

  // React registers wheel as a passive listener at the root, so an onWheel
  // handler cannot call preventDefault and would silently let the modal scroll
  // as well as paging. The listener has to be attached natively.
  useEffect(() => {
    const el = shellRef.current;
    if (!el) return undefined;

    const onWheel = (e) => {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;

      // Trackpad momentum fires dozens of events per flick, which would fling
      // through every record at once. One page per flick is the useful rate.
      const now = Date.now();
      if (now - wheelLock.current < 200) { e.preventDefault(); return; }
      if (Math.abs(e.deltaY) < 10) return;

      const next = Math.max(0, Math.min(total - 1, current + Math.sign(e.deltaY)));
      // At either end the scroll is left alone, so hovering the capsule can
      // never trap you - the modal still scrolls when there is nothing to page.
      if (next === current) return;

      e.preventDefault();
      wheelLock.current = now;
      onSelect(next);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [current, total, onSelect]);

  if (total <= 1) return null;
  const go = (next) => onSelect(Math.max(0, Math.min(total - 1, next)));
  const lower = noun.toLowerCase();

  return (
    <div className="record-stepper" ref={shellRef} title={`${noun} ${current + 1} of ${total} — scroll to change`}>
      <button
        type="button"
        className="stepper-btn"
        onClick={() => go(current - 1)}
        disabled={current === 0}
        aria-label={`Previous ${lower}`}
      >
        <ChevronLeft size={17} />
      </button>

      {/* Announces the change to assistive tech, which the dots did not. */}
      <span className="stepper-label" aria-live="polite">
        <span className="stepper-word">{noun}</span>
        <span className="stepper-current">{current + 1}</span>
        <span className="stepper-sep" aria-hidden="true">/</span>
        <span className="stepper-total">{total}</span>
      </span>

      <button
        type="button"
        className="stepper-btn"
        onClick={() => go(current + 1)}
        disabled={current === total - 1}
        aria-label={`Next ${lower}`}
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
};
const MatchBadge = ({ value }) => {
  const b = MATCH_STATUS_BADGE(value);
  const ToneIcon = { positive: CheckCircle, negative: X, warning: AlertTriangle, neutral: Info }[b.tone];
  return (
    <span className="cap" style={{
      backgroundColor: b.bg, color: b.text, borderColor: b.border,
    }}>
      <ToneIcon size={10} />
      {b.label}
    </span>
  );
};

const AuditStatusBadge = ({ value }) => {
  const b = AUDIT_STATUS_BADGE(value);
  const ToneIcon = { positive: CheckCircle, negative: AlertTriangle, warning: AlertTriangle, neutral: Info }[b.tone];
  return (
    <span className="cap cap-lg" style={{
      backgroundColor: b.bg, color: b.text, borderColor: b.border,
    }}>
      <ToneIcon size={12} />
      {b.label}
    </span>
  );
};

const ScoreBadge = ({ value }) => {
  const n = parseAmount(value);
  if (n === null) return <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#94a3b8', fontFamily: 'monospace' }}>—</span>;
  const c = SCORE_COLOR(n);
  return (
    <span className="cap cap-lg cap-num" style={{
      fontSize: '1rem',
      backgroundColor: c.bg, color: c.text, borderColor: c.border,
    }}>
      {Number.isInteger(n) ? n : n.toFixed(1)}
    </span>
  );
};

const StatCard = ({ label, value }) => {
  const display = showText(value);
  const isEmpty = display === '—';
  return (
    <div style={{
      padding: '0.6rem 0.75rem', borderRadius: '12px',
      border: '1px solid var(--border)', background: 'rgba(0,0,0,0.015)'
    }}>
      <div style={{
        fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '0.3rem'
      }}>{label}</div>
      <div style={{
        fontSize: '0.92rem', fontWeight: 800, fontFamily: 'monospace',
        color: isEmpty ? '#94a3b8' : 'var(--text)', wordBreak: 'break-word', lineHeight: 1.3
      }}>{display}</div>
    </div>
  );
};

const DetailRow = ({ label, value }) => {
  const display = showText(value);
  const isEmpty = display === '—';
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.75rem',
      padding: '0.3rem 0', borderBottom: '1px solid rgba(0,0,0,0.04)', fontSize: '0.78rem'
    }}>
      <span style={{ fontWeight: 600, color: 'var(--text-muted)', flexShrink: 0 }}>{label}</span>
      <span style={{
        fontWeight: 700, color: isEmpty ? '#94a3b8' : 'var(--text)', textAlign: 'right',
        wordBreak: 'break-word', fontFamily: 'monospace', fontSize: '0.75rem', lineHeight: 1.35
      }}>{display}</span>
    </div>
  );
};

// A per-document block. Values are never merged across documents so the
// auditor always knows whether a figure came from the SO, PO, Invoice,
// Gate Pass or Weight Slip.
const DocPanel = ({ kind, title, rows }) => {
  const accent = DOC_ACCENTS[kind] || DOC_ACCENTS.invoice;
  const PanelIcon = accent.icon;
  const filled = rows.filter(row => showText(row.value) !== '—').length;

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: '12px',
      background: 'rgba(0,0,0,0.015)', overflow: 'hidden'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.45rem',
        padding: '0.45rem 0.7rem', background: 'rgba(0,0,0,0.02)',
        borderBottom: '1px solid var(--border)'
      }}>
        <span style={{
          display: 'inline-flex', padding: '0.22rem', borderRadius: '999px',
          background: accent.bg, color: accent.color
        }}>
          <PanelIcon size={12} />
        </span>
        <span style={{
          fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: accent.color
        }}>{title || accent.label}</span>
        <span style={{
          marginLeft: 'auto', fontSize: '0.6rem', fontWeight: 700,
          fontFamily: 'monospace', color: 'var(--text-muted)'
        }}>{filled}/{rows.length}</span>
      </div>
      <div style={{ padding: '0.4rem 0.7rem 0.5rem' }}>
        {rows.map((row, index) => (
          <DetailRow key={`${row.label}-${index}`} label={row.label} value={row.value} />
        ))}
      </div>
    </div>
  );
};

const SectionLabel = ({ children, action }) => (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
    marginBottom: '0.5rem'
  }}>
    <span style={{
      fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase',
      letterSpacing: '0.1em', color: 'var(--text-muted)'
    }}>{children}</span>
    {action}
  </div>
);

const MatchStrip = ({ title, items }) => (
  <div style={{
    marginTop: '0.8rem', padding: '0.6rem 0.75rem', borderRadius: '12px',
    border: '1px solid var(--border)', background: 'rgba(0,0,0,0.015)'
  }}>
    <SectionLabel>{title}</SectionLabel>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
      {items.map(item => (
        <div key={item.label} style={{
          display: 'flex', alignItems: 'center', gap: '0.45rem',
          padding: '0.28rem 0.6rem', borderRadius: '999px',
          border: '1px solid var(--border)', background: 'var(--surface)'
        }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)' }}>{item.label}</span>
          <MatchBadge value={item.value} />
        </div>
      ))}
    </div>
  </div>
);

const CHECK_ROW_ICONS = { positive: CheckCircle, negative: X, warning: AlertTriangle, neutral: Info };

// One verdict as a tone-coded row: an icon, the check name, and the recorded
// outcome. The colour lives on a left rail so a long list can be scanned
// down the edge instead of read row by row.
const CheckRow = ({ label, value }) => {
  const b = MATCH_STATUS_BADGE(value);
  const ToneIcon = CHECK_ROW_ICONS[b.tone];
  return (
    <div className={`verdict-row tone-${b.tone}`}>
      <span className="verdict-row-icon"><ToneIcon size={13} /></span>
      <span className="verdict-row-label">{label}</span>
      <span className="verdict-row-value">{b.label}</span>
    </div>
  );
};

const FINDING_TONES = {
  critical: '#ef4444',
  warning:  '#f59e0b',
  missing:  '#94a3b8',
};

// Findings stay grouped by severity so the header count is the only thing an
// auditor has to read to size the problem before opening the list.
const FindingList = ({ tone, title, items, emptyText, icon }) => {
  const color = FINDING_TONES[tone] || FINDING_TONES.missing;
  const ToneIcon = icon || AlertTriangle;
  const entries = toList(items);

  return (
    <section className={`finding-group tone-${tone}`} style={{ '--finding-color': color }}>
      <header className="finding-group-head">
        <span className="finding-group-icon"><ToneIcon size={13} /></span>
        <h4 className="finding-group-title">{title}</h4>
        <span className="finding-count">{entries.length}</span>
      </header>

      {entries.length ? (
        <ul className="finding-list">
          {entries.map((entry, index) => (
            <li key={index} className="finding-item">
              <span className="finding-item-dot" />
              <span>{entry}</span>
            </li>
          ))}
        </ul>
      ) : (
        emptyText && (
          <div className="finding-empty">
            <ToneIcon size={13} />
            <span>{emptyText}</span>
          </div>
        )
      )}
    </section>
  );
};

const SummaryBlock = ({ summary }) => {
  if (!hasSourceValue(summary)) return null;
  const text = typeof summary === 'string' ? summary.trim() : findingText(summary);
  if (!text) return null;

  return (
    <section className="audit-summary-card">
      <header className="audit-summary-head">
        <Info size={13} />
        <span>Audit Summary</span>
      </header>
      <p className="audit-summary-text">{text}</p>
    </section>
  );
};

// Audit score / status pair reused at the top of the match and findings sections.
const AuditStatusStrip = ({ score, status }) => (
  <div style={{
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1.5rem',
    padding: '0.6rem 0.85rem', borderRadius: '12px',
    border: '1px solid var(--border)', background: 'rgba(0,0,0,0.02)'
  }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <span style={{
        fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: '0.1em', color: 'var(--text-muted)'
      }}>Audit Score</span>
      <ScoreBadge value={score} />
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', paddingLeft: '1.5rem', borderLeft: '1px solid var(--border)' }}>
      <span style={{
        fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase',
        letterSpacing: '0.1em', color: 'var(--text-muted)'
      }}>Audit Status</span>
      <AuditStatusBadge value={status} />
    </div>
  </div>
);

const transformSalesRecord = (record) => {
  const intelligence = {};
  const rest = {};
  Object.entries(record).forEach(([key, value]) => {
    if (INTELLIGENCE_KEYS.has(key)) {
      intelligence[key] = value;
    } else {
      rest[key] = value;
    }
  });
  rest.intelligence = intelligence;
  return rest;
};

// The sales audit document set, in the order they are collected on the ledger.
const DOC_PRESENCE = [
  { key: 'po',         label: 'PO',         prefix: 'po_',  field: 'PurchaseOrder' },
  { key: 'invoice',    label: 'Invoice',    prefix: 'inv_', field: 'Invoice' },
  { key: 'gatepass',   label: 'Gate Pass',  prefix: 'gp_',  field: 'Gatepass' },
  { key: 'weightslip', label: 'Weightslip', prefix: 'ws_',  field: 'Weightslip' },
];

// A quick entry is an SO-vs-PO check, and it only ever carries PO data, so it
// is never chased for invoice / gate pass / weightslip. Both the predicate and
// the pre-split rows it excludes live in the sales API layer.
const getRecordMissingDocs = (record) => {
  const missing = {};
  DOC_PRESENCE.forEach(d => { missing[d.key] = !hasDocPrefixData(record, d.prefix); });
  if (isRecordQuickEntry(record)) {
    return { po: missing.po, invoice: false, gatepass: false, weightslip: false };
  }
  return missing;
};

// Detect records that are still missing one or more uploaded documents.
const isRecordPendingDocuments = (record) => {
  const missing = getRecordMissingDocs(record);
  const missingLabels = DOC_PRESENCE.filter(d => missing[d.key]).map(d => d.label);
  return { pending: missingLabels.length > 0, missing, missingLabels };
};

// ── Single File Picker for Pending Docs Modal ────────────────────
const SingleFilePicker = ({ label, file, onSelectFile, isPending }) => {
  const inputRef = React.useRef(null);

  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
          {label} Document
        </span>
        {isPending && (
          <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: '999px' }}>
            Pending Upload
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        style={{ display: 'none' }}
        onChange={onSelectFile}
      />

      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            onSelectFile({ target: { files: e.dataTransfer.files } });
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justify: 'space-between',
          padding: '0.9rem 1.2rem',
          borderRadius: '12px',
          border: `2px dashed ${file ? 'var(--success)' : isPending ? 'rgba(245,158,11,0.5)' : 'var(--border)'}`,
          background: file ? 'rgba(16,185,129,0.04)' : isPending ? 'rgba(245,158,11,0.03)' : 'rgba(0,0,0,0.02)',
          cursor: 'pointer',
          transition: 'all 0.2s ease-in-out'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflow: 'hidden' }}>
          <div style={{
            padding: '0.5rem',
            borderRadius: '12px',
            background: file ? 'rgba(16,185,129,0.12)' : 'rgba(37,99,235,0.1)',
            color: file ? 'var(--success)' : 'var(--primary)',
            display: 'flex'
          }}>
            {file ? <CheckCircle size={20} /> : <UploadCloud size={20} />}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: file ? 'var(--success)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {file ? file.name : `Choose or drop ${label} file...`}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {file ? `${(file.size / 1024).toFixed(1)} KB` : 'Supports PNG, JPG, JPEG, PDF'}
            </span>
          </div>
        </div>

        {file ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelectFile({ target: { files: [] } });
            }}
            style={{
              background: 'rgba(239,68,68,0.1)',
              border: 'none',
              borderRadius: '999px',
              color: '#ef4444',
              cursor: 'pointer',
              padding: '4px 8px',
              fontSize: '0.72rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <X size={14} /> Clear
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
            style={{
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '999px',
              padding: '0.4rem 0.85rem',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            Browse
          </button>
        )}
      </div>
    </div>
  );
};

// ── Pending Documents Upload Modal ──────────────────────────────
const PendingDocsUploadModal = ({ group, onClose, onUploadSuccess }) => {
  const record = group.records[0];
  const pendingInfo = isRecordPendingDocuments(record);
  // Only the documents this ledger is actually missing are offered for upload.
  const missingDocs = DOC_PRESENCE.filter(d => pendingInfo.missing[d.key]);
  const [files, setFiles] = useState({});
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  const setDocFile = (key, file) => setFiles(prev => ({ ...prev, [key]: file }));

  const convertPdfToImg = async (file) => {
    const pdfjsLib = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    page.cleanup();
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    return new File([blob], file.name.replace(/\.pdf$/i, '.png'), { type: 'image/png' });
  };

  const handleFile = async (e, key) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type === 'application/pdf') {
      try {
        setDocFile(key, await convertPdfToImg(file));
      } catch { setDocFile(key, file); }
    } else {
      setDocFile(key, file);
    }
  };

  const handleSubmit = async () => {
    const chosen = missingDocs.filter(d => files[d.key]);
    if (chosen.length === 0) {
      setUploadError(`Please select at least one file (${missingDocs.map(d => d.label).join(', ')}).`);
      return;
    }
    setIsUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      // The ledger identity travels with every upload so the audit can be re-linked.
      const soNum = record.so_number || record.so_po_number || record.inv_order_number
        || record.order_number || record['Invoice Number'] || group.invoiceNumber || '';
      formData.append('so_number', soNum);
      formData.append('so_no', soNum);
      formData.append('SO Number', soNum);
      formData.append('po_number', record.po_number || record.so_po_number || '');
      formData.append('gp_number', record.gp_number || '');
      formData.append('record_id', record.id?.toString() || '');
      formData.append('record_source', record.__source || 'sales');
      chosen.forEach(d => {
        const file = files[d.key];
        const ext = file.name.includes('.') ? file.name.split('.').pop() : 'png';
        const fileName = `${d.field}.${ext}`;
        const renamed = new File([file], fileName, { type: file.type });
        formData.append(d.field, renamed, fileName);
        formData.append(`${d.field}Name`, file.name);
      });
      const res = await fetch(PENDING_DOCS_UPLOAD_WEBHOOK, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setUploadSuccess(true);
      setTimeout(() => { onUploadSuccess?.(); onClose(); }, 3500);
    } catch (err) {
      setUploadError(err.message || 'Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="modal-overlay animate-fade-in" style={{ zIndex: 9998 }} onClick={onClose}>
      <div className="modal-content animate-slide-up" onClick={e => e.stopPropagation()}
        style={{ maxWidth: '540px', width: '95%', borderRadius: '16px', padding: 0, overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)',
          background: 'linear-gradient(135deg, rgba(245,158,11,0.06) 0%, transparent 100%)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ padding: '0.6rem', borderRadius: '12px', background: 'rgba(245,158,11,0.12)', color: '#f59e0b', display: 'flex' }}>
                <FileUp size={18} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text)' }}>Upload Pending Documents</h3>
                <p style={{ margin: '0.15rem 0 0', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  SO: {record.so_number || group.invoiceNumber || '—'}
                  {hasDocPrefixData(record, 'po_') ? ` · PO: ${record.po_number || '—'}` : ''}
                  {hasDocPrefixData(record, 'gp_') ? ` · GP: ${record.gp_number || '—'}` : ''}
                </p>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '4px' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Document status badges */}
        <div style={{ padding: '1rem 1.5rem 0' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {DOC_PRESENCE.map(d => {
              const isMissing = pendingInfo.missing[d.key];
              return (
                <span key={d.key} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                  padding: '0.3rem 0.75rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700,
                  background: isMissing ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
                  color: isMissing ? '#ef4444' : '#10b981',
                  border: `1px solid ${isMissing ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`
                }}>
                  {isMissing ? <AlertTriangle size={11} /> : <CheckCircle size={11} />}
                  {d.label} {isMissing ? '— Pending' : '— Present'}
                </span>
              );
            })}
          </div>
        </div>

        {/* Upload form — one picker per missing document */}
        <div style={{ padding: '0 1.5rem 1.5rem' }}>
          {missingDocs.map(d => (
            <SingleFilePicker
              key={d.key}
              label={d.label}
              file={files[d.key] || null}
              isPending
              onSelectFile={(e) => handleFile(e, d.key)}
            />
          ))}

          {uploadError && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem',
              borderRadius: '12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              color: '#ef4444', fontSize: '0.8rem', fontWeight: 600, marginBottom: '1rem'
            }}>
              <AlertTriangle size={14} />
              {uploadError}
            </div>
          )}

          {uploadSuccess && (
            <div className="all-done-stage animate-fade-in" style={{ marginBottom: '1rem' }}>
              <div className="all-done-card" style={{ padding: '2rem 1.75rem', maxWidth: '100%' }}>
                <div className="all-done-icon" style={{ width: '56px', height: '56px' }}><Mail size={24} /></div>
                <p className="all-done-title" style={{ fontSize: '1.15rem' }}>Success! Documents are under process</p>
                <p className="all-done-sub" style={{ fontSize: '0.85rem' }}>Check your email shortly for the audit results.</p>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button className="btn btn-outline" onClick={onClose} style={{ fontSize: '0.8rem', padding: '0.55rem 1.25rem' }}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={isUploading || uploadSuccess}
              style={{ fontSize: '0.8rem', padding: '0.55rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {isUploading ? <><Loader2 size={14} className="spin-icon" /> Uploading...</> : <><UploadCloud size={14} /> Upload Data</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Sales Record Detail Modal (redesigned audit dashboard) ──
const SalesRecordModal = ({ records, onClose, invoiceNumber, onDecision, isProcessing, hasDecision, decisionStatus }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [expandedSections, setExpandedSections] = useState({});

  if (!records || records.length === 0) return null;

  const totalItems = records.length;
  const hasMultiple = totalItems > 1;
  const record = records[currentIndex];
  const I = record?.intelligence || {};

  // A section the user has never touched falls back to its own default, so the
  // comparison table starts open for quick entries too — its title differs from
  // a full audit's, and keying the open state off one literal string left every
  // quick entry collapsed until it was clicked open by hand.
  const isSectionOpen = (key, defaultOpen = false) =>
    expandedSections[key] === undefined ? defaultOpen : expandedSections[key];

  const toggleSection = (key, defaultOpen = false) =>
    setExpandedSections(prev => ({ ...prev, [key]: !isSectionOpen(key, defaultOpen) }));

  const v = (key) => fmt(record[key]);

  // Match/audit fields live under `intelligence`, but a record can also carry
  // them at the top level — read both so no check silently reads as unchecked.
  const check = (key) => (I[key] !== undefined && I[key] !== null && I[key] !== '' ? I[key] : record[key]);

  // A document column is only worth showing when the record actually carries
  // data for it — quick entries have no gp_/ws_/inv_ values at all.
  const hasDocData = (prefix) =>
    Object.keys(record).some(k => {
      if (!k.startsWith(prefix)) return false;
      const val = record[k];
      if (val === null || val === undefined) return false;
      if (typeof val === 'string') return val.trim() !== '';
      return true;
    });

  const hasInvoiceData = hasDocData('inv_');
  const hasGPData = hasDocData('gp_');
  const hasWSData = hasDocData('ws_');
  // A ledger where no PO was uploaded would otherwise render an entirely
  // blank PO column, so every PO block is hidden instead.
  const hasPOData = hasDocData('po_');
  // Which ledger this record came from is the authoritative signal — the two
  // sales tables are read one at a time, so a normal sales row is never
  // mistaken for a quick check just because its invoice is still empty.
  const isQuickEntry = isRecordQuickEntry(record);

  const SectionHeader = ({ title, defaultOpen = true }) => (
    <div
      onClick={() => toggleSection(title, defaultOpen)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.85rem 1.25rem', cursor: 'pointer', userSelect: 'none',
        borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.02)'
      }}
    >
<h3 className="cap audit-section-pill">{title}</h3>
      <ChevronRight size={16} style={{ transform: isSectionOpen(title, defaultOpen) ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', color: 'var(--text-muted)' }} />
    </div>
  );

  const Badge = ({ value, green, yellow, red }) => {
    const score = value !== null && value !== undefined && value !== '' ? Number(value) : null;
    if (score === null) return <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>-</span>;
    let colors;
    if (green && score >= green) colors = { bg: 'rgba(16,185,129,0.12)', text: '#10b981' };
    else if (yellow && score >= yellow) colors = { bg: 'rgba(245,158,11,0.12)', text: '#eab308' };
    else if (red) colors = { bg: 'rgba(239,68,68,0.12)', text: '#ef4444' };
    else colors = { bg: 'rgba(100,116,139,0.08)', text: '#64748b' };
    return <span className="cap cap-num" style={{ fontSize: '0.85rem', backgroundColor: colors.bg, color: colors.text }}>{score}</span>;
  };

  const CollapseSection = ({ title, children, defaultOpen = false }) => (
    <div style={{ border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', marginBottom: '1rem', background: 'var(--surface)' }}>
      <SectionHeader title={title} defaultOpen={defaultOpen} />
      {isSectionOpen(title, defaultOpen) && <div className="audit-section-body">{children}</div>}
    </div>
  );

  const getCellVal = (field, doc) => {
    if (doc === 'ws' && field.label === 'Unit') return v('po_unit') || 'KG';

    // Gate Pass values are authoritative per the gate pass field mapping:
    // a Gate Pass cell may only ever read a gp_* column, never so_/po_/inv_.
    let key = field[doc];
    if (doc === 'gp' && key && !key.startsWith('gp_')) {
      console.warn(`[sales] Gate Pass row "${field.label}" points at non-gp column "${key}" — ignored.`);
      key = null;
    }

    if (key) {
      const primary = v(key);
      if (primary !== null && primary !== undefined && primary !== '') return primary;
    }

    if (doc === 'po') {
      if (field.label === 'Material') {
        const poMatKeys = ['po_material_grade', 'po_product', 'po_material', 'po_material_description'];
        for (const k of poMatKeys) {
          const val = v(k);
          if (val !== null && val !== undefined && val !== '') return val;
        }
      }
    }
    const fallbackKey = field[`${doc}Fallback`];
    if (fallbackKey) {
      const fallback = v(fallbackKey);
      if (fallback !== null && fallback !== undefined && fallback !== '') return fallback;
    }
    return null;
  };

  // Comparison matrix columns, in display order. The original index is kept
  // because unit normalisation lookups (inv_unit, so_unit, po_unit, gp_unit,
  // po_unit) are positional and must stay aligned with the value arrays.
  const matrixDocs = [
    { doc: 'invoice', idx: 0, label: 'Invoice', show: hasInvoiceData },
    { doc: 'so', idx: 1, label: 'SO', show: true },
    { doc: 'po', idx: 2, label: 'PO', show: hasPOData },
    { doc: 'gp', idx: 3, label: 'Gate Pass', show: hasGPData },
    { doc: 'ws', idx: 4, label: 'Weight Slip', show: hasWSData },
  ].filter(d => d.show);

  // A comparison row is only worth rendering when at least one visible document
  // actually carries a value for it — a quick check has no vehicle or weight, so
  // those rows would otherwise appear as an empty stripe.
  const activeCompareFields = SALES_COMPARE_FIELDS
    .filter(f => !f.conditional || getCellVal(f, f.conditional))
    .filter(f => matrixDocs.some(d => hasSourceValue(getCellVal(f, d.doc))));

  // True when the Document Comparison Matrix finds an actual field conflict
  // (mirrors the per-row mismatch detection used in Section 1).
  const hasMatrixMismatch = activeCompareFields
    .some((field) => {
      const { label, type } = field;
      const docKeys = ['invoice', 'so', 'po', 'gp', 'ws'];
      const docVals = docKeys.map(d => getCellVal(field, d));
      const allVals = docVals.filter(Boolean);

      let compareVals;
      if (type === 'quantity' || label === 'Rate') {
        const unitKeys = ['inv_unit', 'so_unit', 'po_unit', 'gp_unit', 'po_unit'];
        const unitMap = unitKeys.map(k => k ? v(k) : null);
        const num = (val, unit, isRate) => {
          if (val == null) return null;
          const u = (unit || '').toString().toLowerCase().trim();
          const n = parseFloat(val.toString().replace(/,/g, ''));
          if (isNaN(n)) return null;
          if (type === 'quantity') {
            if (u.includes('mt') || u.includes('ton')) return n * 1000;
            if (u.includes('kg')) return n;
            return n < 500 ? n * 1000 : n;
          }
          if (u.includes('kg')) return n;
          if (u.includes('mt') || u.includes('ton')) return n <= 500 ? n : n / 1000;
          return n > 500 ? n / 1000 : n;
        };
        compareVals = docVals.map((val, i) => num(val, unitMap[i], label === 'Rate')).filter(v => v != null);
      } else {
        compareVals = allVals;
      }

      if (compareVals.length < 2) return false;
      if (type === 'quantity') return compareVals.some(x => Math.abs(x - compareVals[0]) > 250);
      if (label === 'Rate') return compareVals.some(x => Math.abs(x - compareVals[0]) > 0.5);
      return compareVals.some(x => !salesValuesMatch(x, compareVals[0], type));
    });

  const formatDocVal = (field, doc, val) => {
    if (val === null || val === undefined || val === '') return null;

    let docUnit = null;
    if (doc === 'invoice') docUnit = v('inv_unit');
    else if (doc === 'so') docUnit = v('so_unit') || 'MT';
    else if (doc === 'po') docUnit = v('po_unit');
    else if (doc === 'gp') docUnit = v('gp_unit');
    else if (doc === 'ws') docUnit = v('po_unit') || 'KG';

    const u = (docUnit || '').toString().toLowerCase().trim();
    const isKgs = u.includes('kg');
    const isMt = u.includes('mt') || u.includes('ton');

    if (field.label === 'Quantity') {
      const num = parseFloat(val.toString().replace(/,/g, ''));
      if (!isNaN(num)) {
        if (isKgs || num >= 500) {
          const mtVal = num / 1000;
          return `${mtVal} MT (${num.toLocaleString('en-IN')} KGS)`;
        } else if (isMt || num < 500) {
          const kgVal = num * 1000;
          return `${num} MT (${kgVal.toLocaleString('en-IN')} KGS)`;
        }
      }
    }

    if (field.label === 'Rate') {
      const num = parseFloat(val.toString().replace(/,/g, ''));
      if (!isNaN(num)) {
        if (isKgs || num <= 500) {
          const perMt = num * 1000;
          return `₹${perMt.toLocaleString('en-IN')}/MT (₹${num}/KG)`;
        } else {
          const perKg = num / 1000;
          return `₹${num.toLocaleString('en-IN')}/MT (₹${perKg}/KG)`;
        }
      }
    }

    if (field.label === 'Unit') {
      if (isKgs) return `MT (${val})`;
      if (isMt) return `MT`;
    }

    if (field.label === 'Payment Terms') {
      const m = val.toString().trim().match(/^(\d+)\s*D$/i);
      if (m) return `${m[1]} DAYS`;
    }

    return val;
  };

  // Weight Slip cells can carry more than one value (e.g. gross + net weight).
  // Conflict detection still uses only the primary `ws` value; this is display only.
  const formatWsCell = (field, val) => {
    const parts = [];
    const primary = formatDocVal(field, 'ws', val);
    if (primary !== null && primary !== undefined) {
      parts.push(field.wsLabel ? `${field.wsLabel} ${primary}` : primary);
    }
    if (field.wsExtra) {
      const extra = formatDocVal(field, 'ws', v(field.wsExtra));
      if (extra !== null && extra !== undefined) {
        parts.push(field.wsExtraLabel ? `${field.wsExtraLabel} ${extra}` : extra);
      }
    }
    return parts.length ? parts.join(' · ') : null;
  };

  const DocBadge = ({ val, nowrap, align = 'center', color }) => {
    const display = val ?? '—';
    const isEmpty = display === '—';
    return (
      <span style={{
        display: 'block', fontSize: '0.78rem', fontWeight: 600, fontFamily: 'monospace',
        color: isEmpty ? '#94a3b8' : (color || 'var(--text)'),
        padding: '0.25rem 0', lineHeight: 1.4,
        textAlign: align,
        whiteSpace: nowrap ? 'nowrap' : undefined,
        overflow: nowrap ? 'hidden' : undefined,
        textOverflow: nowrap ? 'ellipsis' : undefined
      }}>
        {display}
      </span>
    );
  };

// Every comparison the sales audit reports on, in auditor reading order:
// ordered documents first, then the commercial terms, then the money.
const MATCH_RESULT_CHECKS = [
  { label: 'Customer',        key: 'customer_match' },
  { label: 'PO',              key: 'po_match',       hideWithout: 'po' },
  { label: 'SO',              key: 'so_match' },
  { label: 'Vehicle',         key: 'vehicle_match' },
  { label: 'Weight Slip',     key: 'weight_slip_match' },
  { label: 'Quantity',        key: 'quantity_match' },
  { label: 'Material',        key: 'material_match' },
  { label: 'Dimension',       key: 'dimension_match' },
  { label: 'Grade',           key: 'grade_match' },
  { label: 'Packing',         key: 'packing_match' },
  { label: 'Coil',            key: 'coil_match' },
  { label: 'Rate',            key: 'rate_match' },
  { label: 'Payment Terms',   key: 'payment_terms_match' },
  { label: 'Delivery Terms',  key: 'delivery_terms_match' },
  { label: 'Weight',          key: 'weight_match' },
  { label: 'GST',             key: 'gst_match' },
  { label: 'Amount',          key: 'amount_match' },
  { label: 'Date',            key: 'date_match' },
];

// A quick check only ever compares the Sales Order against the Purchase Order,
// and its workflow reports only these seven match columns. The transport and
// weighbridge checks are left out entirely rather than rendering as "not
// checked" for documents that do not exist. Dimension / grade / packing
// differences surface through the comparison matrix and the warnings list.
const QUICK_ENTRY_CHECKS = [
  { label: 'Customer',       key: 'customer_match' },
  { label: 'PO',             key: 'po_match' },
  { label: 'SO',             key: 'so_match' },
  { label: 'Material',       key: 'material_match' },
  { label: 'Quantity',       key: 'quantity_match' },
  { label: 'GSTIN',          key: 'gst_match' },
  { label: 'Amount',         key: 'amount_match' },
];

  const score = I.audit_score !== undefined ? Number(I.audit_score) : null;

  const sc = SCORE_COLOR(score);

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal-content animate-slide-up" onClick={e => e.stopPropagation()}
        style={{ maxWidth: '1100px', width: '95%', borderRadius: '16px', padding: 0, overflow: 'hidden' }}
      >
        {/* ── Header ── */}
        <div className="sales-modal-head">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={20} style={{ color: 'var(--primary)' }} />
                {isQuickEntry ? 'Quick Check Ledger' : 'Sales Comparison Ledger'}
                {isQuickEntry && (
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase',
                    letterSpacing: '0.08em', padding: '0.2rem 0.6rem', borderRadius: '999px',
                    background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
                    border: '1px solid rgba(245,158,11,0.25)', verticalAlign: 'middle'
                  }}>
                    Quick Entry
                  </span>
                )}
              </h2>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              {hasMultiple && (
                <RecordStepper
                  noun="Item"
                  current={currentIndex}
                  total={totalItems}
                  onSelect={setCurrentIndex}
                />
              )}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.15rem' }}>Audit Score</div>
                <Badge value={score} green={90} yellow={75} red={0} />
              </div>
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem', color: 'var(--text-muted)', display: 'flex' }}>
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Document Number Strip */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '1.25rem', marginTop: '0.75rem',
            padding: '0.65rem 0.85rem', background: 'rgba(0,0,0,0.02)', borderRadius: '12px',
            fontSize: '0.75rem', alignItems: 'center'
          }}>
            {(isQuickEntry ? [
              { label: 'SO #', value: v('so_number') },
              { label: 'PO #', value: v('po_number') },
              { label: 'Customer', value: v('so_customer_name') },
              { label: 'Supplier', value: v('po_supplier_name') },
              { label: 'Check', value: 'SO vs PO' },
            ] : [
              { label: 'Invoice #', value: invoiceNumber || v('inv_order_number') },
              { label: 'SO #', value: v('so_number') },
              { label: 'PO #', value: v('po_number'), show: hasPOData },
              { label: 'GP #', value: v('gp_number'), show: hasGPData },
              { label: 'WS #', value: v('ws_number'), show: hasWSData },
            ]).filter(item => item.show !== false).map((item, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '0.68rem', letterSpacing: '0.05em' }}>{item.label}</span>
                <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.8rem' }}>{item.value || '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Scrollable Body ── */}
        <div className="sales-modal-scroll">
          
          {/* ─── Section 1: Document Comparison Matrix ─── */}
          <CollapseSection title={isQuickEntry ? 'SO vs PO Comparison' : 'Document Comparison Matrix'} defaultOpen>
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem',
                border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden'
              }}>
                <thead>
                  <tr style={{ background: 'rgba(0,0,0,0.03)' }}>
                    <th style={thStyle}>Field</th>
                    {matrixDocs.map(d => (
                      <th key={d.doc} style={{ ...thStyle, textAlign: 'center' }}>{d.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeCompareFields.map((field) => {
                    const { label, type, nowrap } = field;
                    const iv = getCellVal(field, 'invoice');
                    const sv = getCellVal(field, 'so');
                    const pv = getCellVal(field, 'po');
                    const gv = getCellVal(field, 'gp');
                    const wv = getCellVal(field, 'ws');
                    const rawVals = [iv, sv, pv, gv, wv];
                    const allVals = rawVals.filter(Boolean);
                    const rawByDoc = { invoice: iv, so: sv, po: pv, gp: gv, ws: wv };

                    // For rate & quantity, normalize units for conflict comparison
                    let compareValsForConflict;
                    if (type === 'quantity') {
                      const unitKeys = ['inv_unit', 'so_unit', 'po_unit', 'gp_unit', 'po_unit'];
                      const unitMap = unitKeys.map(k => k ? v(k) : null);
                      const toKg = (val, unit) => {
                        if (val == null) return null;
                        const u = (unit || '').toString().toLowerCase().trim();
                        const num = parseFloat(val.toString().replace(/,/g, ''));
                        if (isNaN(num)) return null;
                        if (u.includes('mt') || u.includes('ton')) return num * 1000;
                        if (u.includes('kg')) return num;
                        return num < 500 ? num * 1000 : num;
                      };
                      compareValsForConflict = rawVals.map((val, i) => toKg(val, unitMap[i])).filter(v => v != null);
                    } else if (label === 'Rate') {
                      const unitKeys = ['inv_unit', 'so_unit', 'po_unit', 'gp_unit', 'po_unit'];
                      const unitMap = unitKeys.map(k => k ? v(k) : null);
                      const toRateKg = (val, unit) => {
                        if (val == null) return null;
                        const u = (unit || '').toString().toLowerCase().trim();
                        const num = parseFloat(val.toString().replace(/,/g, ''));
                        if (isNaN(num)) return null;
                        if (u.includes('kg')) return num;
                        // Small numbers are per-KG values even if unit says MT (matches display logic)
                        if (u.includes('mt') || u.includes('ton')) return num <= 500 ? num : num / 1000;
                        return num > 500 ? num / 1000 : num;
                      };
                      compareValsForConflict = rawVals.map((val, i) => toRateKg(val, unitMap[i])).filter(v => v != null);
                    } else {
                      compareValsForConflict = allVals;
                    }

                    const hasConflict = compareValsForConflict.length >= 2 && !compareValsForConflict.every(x => {
                      if (type === 'quantity') return Math.abs(x - compareValsForConflict[0]) <= 250;
                      if (label === 'Rate') return Math.abs(x - compareValsForConflict[0]) <= 0.5;
                      return salesValuesMatch(x, compareValsForConflict[0], type);
                    });
                    const hasPartial = compareValsForConflict.length >= 2 && !hasConflict && compareValsForConflict.some(x =>
                      compareValsForConflict.some(y => x !== y && (
                        type === 'quantity' ? Math.abs(x - y) > 250 :
                        label === 'Rate' ? Math.abs(x - y) > 0.5 :
                        !salesValuesMatch(x, y, type)
                      ))
                    );
                    // Determine per-cell status for individual green/red coloring
                    const getCompareVal = (rawVal, docIdx) => {
                      if (rawVal == null) return null;
                      if (type === 'quantity') {
                        const unitKeys = ['inv_unit', 'so_unit', 'po_unit', 'gp_unit', 'po_unit'];
                        const unit = unitKeys[docIdx] ? v(unitKeys[docIdx]) : null;
                        const u = (unit || '').toLowerCase();
                        const num = parseFloat(rawVal.toString().replace(/,/g, ''));
                        if (isNaN(num)) return null;
                        if (u.includes('mt') || u.includes('ton')) return num * 1000;
                        if (u.includes('kg')) return num;
                        return num < 500 ? num * 1000 : num;
                      } else if (label === 'Rate') {
                        const unitKeys = ['inv_unit', 'so_unit', 'po_unit', 'gp_unit', 'po_unit'];
                        const unit = unitKeys[docIdx] ? v(unitKeys[docIdx]) : null;
                        const u = (unit || '').toLowerCase();
                        const num = parseFloat(rawVal.toString().replace(/,/g, ''));
                        if (isNaN(num)) return null;
                        if (u.includes('kg')) return num;
                        if (u.includes('mt') || u.includes('ton')) return num <= 500 ? num : num / 1000;
                        return num > 500 ? num / 1000 : num;
                      }
                      return rawVal;
                    };
                    const consensus = compareValsForConflict.length > 0 ? compareValsForConflict[0] : null;
                    const getCellBg = (rawVal, docIdx) => {
                      if (!rawVal) return 'transparent';
                      if (compareValsForConflict.length < 2) return 'transparent';
                      const cval = getCompareVal(rawVal, docIdx);
                      if (cval == null) return 'transparent';
                      let matches;
                      if (type === 'quantity') matches = Math.abs(cval - consensus) <= 250;
                      else if (label === 'Rate') matches = Math.abs(cval - consensus) <= 0.5;
                      else matches = salesValuesMatch(cval, consensus, type);
                      if (matches) return 'rgba(16,185,129,0.10)';
                      return 'rgba(239,68,68,0.10)';
                    };
                    const getCellColor = (rawVal, docIdx) => {
                      if (!rawVal) return 'var(--text)';
                      if (compareValsForConflict.length < 2) return 'var(--text)';
                      const cval = getCompareVal(rawVal, docIdx);
                      if (cval == null) return 'var(--text)';
                      let matches;
                      if (type === 'quantity') matches = Math.abs(cval - consensus) <= 250;
                      else if (label === 'Rate') matches = Math.abs(cval - consensus) <= 0.5;
                      else matches = salesValuesMatch(cval, consensus, type);
                      return matches ? '#10b981' : '#ef4444';
                    };
                    return (
                      <tr key={label} style={{
                        borderBottom: '1px solid var(--border)',
                        background: hasConflict ? 'rgba(239,68,68,0.03)' : hasPartial ? 'rgba(245,158,11,0.03)' : 'transparent'
                      }}>
                        <td style={{ ...tdStyle, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{label}</td>
                        {matrixDocs.map(d => {
                          const raw = rawByDoc[d.doc];
                          return (
                            <td key={d.doc} style={{ ...tdStyle, textAlign: 'center', background: getCellBg(raw, d.idx) }}>
                              <DocBadge
                                val={d.doc === 'ws' ? formatWsCell(field, raw) : formatDocVal(field, d.doc, raw)}
                                nowrap={nowrap}
                                align="center"
                                color={getCellColor(raw, d.idx)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CollapseSection>

          {/* ─── Section 2: Estimated Amount / Order Commercials ─── */}
          <CollapseSection title={isQuickEntry ? 'Order Commercials' : 'Estimated Amount'}>
            {isQuickEntry ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                <div>
                  <SectionLabel action={<MatchBadge value={check('rate_match')} />}>Rate Comparison</SectionLabel>
                  <div className="audit-rate-grid">
                    <StatCard label="SO Rate" value={showRate(record.so_rate)} />
                    {hasPOData && <StatCard label="PO Rate" value={showRate(record.po_rate)} />}
                  </div>
                </div>

                <div>
                  <SectionLabel>Order Value</SectionLabel>
                  <div className="audit-stat-grid">
                    <StatCard label="SO Quantity" value={showQuantity(record.so_quantity, record.so_unit)} />
                    {hasPOData && <StatCard label="PO Quantity" value={showQuantity(record.po_quantity, record.po_unit)} />}
                    {hasPOData && <StatCard label="PO Total Amount" value={showMoney(record.po_total_amount)} />}
                  </div>
                </div>

                <div>
                  <SectionLabel action={<MatchBadge value={check('amount_match')} />}>Terms Comparison</SectionLabel>
                  <div className="audit-doc-grid">
                    <DocPanel
                      kind="so"
                      title="SO Terms"
                      rows={[
                        { label: 'Payment Terms', value: showText(record.so_payment_terms) },
                        { label: 'Delivery Terms', value: showText(record.so_delivery_terms) },
                      ]}
                    />
                    {hasPOData && (
                      <DocPanel
                        kind="po"
                        title="PO Terms"
                        rows={[
                          { label: 'Payment Terms', value: showText(record.po_payment_terms) },
                          { label: 'Delivery Terms', value: showText(record.po_delivery_terms) },
                        ]}
                      />
                    )}
                  </div>
                </div>
              </div>
            ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem 1.25rem',
                padding: '0.5rem 0.75rem', borderRadius: '12px',
                border: '1px solid var(--border)', background: 'rgba(0,0,0,0.02)'
              }}>
                <span style={{
                  fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase',
                  letterSpacing: '0.1em', color: 'var(--text-muted)'
                }}>Invoice Number</span>
                <span style={{
                  fontFamily: 'monospace', fontSize: '0.88rem', fontWeight: 800,
                  color: showText(record.inv_number) === '—' ? '#94a3b8' : 'var(--text)'
                }}>{showText(record.inv_number)}</span>
              </div>

              <div>
                <SectionLabel>Amounts on Record</SectionLabel>
                <div className="audit-stat-grid">
                  <StatCard label="Taxable Amount" value={showMoney(record.inv_taxable_value)} />
                  <StatCard label="Final Invoice Amount" value={showMoney(record.inv_final_amount)} />
                  {hasPOData && <StatCard label="PO Amount" value={showMoney(record.po_total_amount)} />}
                </div>
              </div>

              <div>
                <SectionLabel action={<MatchBadge value={check('rate_match')} />}>Rate Comparison</SectionLabel>
                <div className="audit-rate-grid">
                  <StatCard label="SO Rate" value={showRate(record.so_rate)} />
                  {hasPOData && <StatCard label="PO Rate" value={showRate(record.po_rate)} />}
                  <StatCard label="Invoice Rate" value={showRate(record.inv_rate)} />
                </div>
              </div>
            </div>
            )}
          </CollapseSection>

          {/* ─── Section 3: Financial Summary — invoice-only, so quick checks skip it ─── */}
          {!isQuickEntry && (
          <CollapseSection title="Financial Summary">
            <div className="audit-stat-grid">
              <StatCard label="Invoice Taxable Value" value={showMoney(record.inv_taxable_value)} />
              <StatCard label="Invoice Final Amount" value={showMoney(record.inv_final_amount)} />
              <StatCard label="Invoice CGST" value={showMoney(record.inv_cgst_amount)} />
              <StatCard label="Invoice SGST" value={showMoney(record.inv_sgst_amount)} />
              <StatCard label="Invoice IGST" value={showMoney(record.inv_igst_amount)} />
              {hasPOData && <StatCard label="PO Rate" value={showRate(record.po_rate)} />}
              <StatCard label="Invoice Rate" value={showRate(record.inv_rate)} />
              <StatCard label="SO Rate" value={showRate(record.so_rate)} />
              {hasPOData && <StatCard label="PO Total Amount" value={showMoney(record.po_total_amount)} />}
              <StatCard label="SO Payment Terms" value={showText(record.so_payment_terms)} />
              <StatCard label="Invoice Payment Terms" value={showText(record.inv_payment_terms)} />
            </div>

            <MatchStrip
              title="Financial Match Status"
              items={[
                { label: 'Rate Match', value: check('rate_match') },
                { label: 'Amount Match', value: check('amount_match') },
                { label: 'Payment Terms Match', value: check('payment_terms_match') },
              ]}
            />
          </CollapseSection>
          )}

          {/* ─── Section 4: Material Information ─── */}
          <CollapseSection title="Material Information">
            <div className="audit-doc-grid">
              <DocPanel
                kind="so"
                title="Sales Order"
                rows={[
                  { label: 'Product', value: showText(record.so_product) },
                  { label: 'Production Type', value: showText(record.so_production_type) },
                  { label: 'Dimensions (T × W × L)', value: showDimensions(record.so_thickness, record.so_width, record.so_length) },
                  { label: 'Quantity', value: showQuantity(record.so_quantity, record.so_unit) },
                  { label: 'Packing', value: showText(record.so_packing) },
                  { label: 'Coil Number', value: showText(record.so_coil_number) },
                ]}
              />
              {hasPOData && (
                <DocPanel
                  kind="po"
                  title="Purchase Order"
                  rows={[
                    { label: 'Material Description', value: showText(record.po_material_description) },
                    { label: 'Material Grade', value: showText(record.po_material_grade) },
                    { label: 'HSN Code', value: showText(record.po_hsn_code) },
                    { label: 'Dimensions (T × W × L)', value: showDimensions(record.po_thickness, record.po_width, record.po_length) },
                    { label: 'Quantity', value: showQuantity(record.po_quantity, record.po_unit) },
                    { label: 'Unit', value: showText(record.po_unit) },
                  ]}
                />
              )}
              {hasInvoiceData && (
              <DocPanel
                kind="invoice"
                title="Invoice"
                rows={[
                  { label: 'Description', value: showText(record.inv_notes) },
                  { label: 'Dimensions (T × W × L)', value: showDimensions(record.inv_thickness, record.inv_width, record.inv_length) },
                  { label: 'Quantity', value: showQuantity(record.inv_quantity, record.inv_unit) },
                ]}
              />
              )}
              {hasGPData && (
              <DocPanel
                kind="gp"
                title="Gate Pass"
                rows={[
                  { label: 'Product', value: showText(record.gp_product) },
                  { label: 'Material Description', value: showText(record.gp_material_description) },
                  { label: 'Grade', value: showText(record.gp_grade) },
                  { label: 'Dimensions (T × W × L)', value: showDimensions(record.gp_thickness, record.gp_width, record.gp_length) },
                  { label: 'Quantity', value: showQuantity(record.gp_quantity, record.gp_unit) },
                  { label: 'Unit', value: showText(record.gp_unit) },
                  { label: 'Packing', value: showText(record.gp_packing) },
                  { label: 'Coil Number', value: showText(record.gp_coil_number) },
                ]}
              />
              )}
              {hasWSData && (
              <DocPanel
                kind="ws"
                title="Weight Slip"
                rows={[
                  { label: 'Material Description', value: showText(record.ws_material_description) },
                  { label: 'Gross Weight', value: showText(record.ws_gross_weight) },
                  { label: 'Tare Weight', value: showText(record.ws_tare_weight) },
                  { label: 'Net Weight', value: showText(record.ws_net_weight) },
                ]}
              />
              )}
            </div>

            <MatchStrip
              title="Material Match Status"
              items={[
                { label: 'Material', value: check('material_match') },
                { label: 'Dimension', value: check('dimension_match') },
                { label: 'Grade', value: check('grade_match') },
                { label: 'Packing', value: check('packing_match') },
                { label: 'Coil', value: check('coil_match') },
                { label: 'Quantity', value: check('quantity_match') },
              ]}
            />
          </CollapseSection>

          {/* ─── Section 5: Logistics — movement documents, which a quick check never has ─── */}
          {!isQuickEntry && (
          <CollapseSection title="Logistics">
            <div className="audit-doc-grid">
              {hasInvoiceData && (
              <DocPanel
                kind="invoice"
                title="Invoice · Dispatch"
                rows={[
                  { label: 'Vehicle', value: showText(record.inv_vehicle_number) },
                  { label: 'Weight Slip Number', value: showText(record.inv_weight_slip_number) },
                  { label: 'Consignee', value: showText(record.inv_consignee_name) },
                ]}
              />
              )}
              {hasGPData && (
              <DocPanel
                kind="gp"
                title="Gate Pass · Movement"
                rows={[
                  { label: 'Gate Pass Number', value: showText(record.gp_number) },
                  { label: 'Gate Pass Date', value: showText(record.gp_date) },
                  { label: 'Vehicle', value: showText(record.gp_vehicle_number) },
                  { label: 'Customer / Party', value: showText(record.gp_party_name) },
                  { label: 'SO Number', value: showText(record.gp_so_number) },
                  { label: 'PO Number', value: showText(record.gp_po_number) },
                  { label: 'Driver', value: showText(record.gp_driver_name) },
                  { label: 'Weight', value: showQuantity(record.gp_weight, record.gp_unit) },
                ]}
              />
              )}
              {hasWSData && (
              <DocPanel
                kind="ws"
                title="Weight Slip · Weighment"
                rows={[
                  { label: 'Weight Slip Number', value: showText(record.ws_number) },
                  { label: 'Date', value: showText(record.ws_date) },
                  { label: 'Time', value: showText(record.ws_time) },
                  { label: 'Vehicle', value: showText(record.ws_vehicle_number) },
                  { label: 'Party', value: showText(record.ws_party_name) },
                  { label: 'Gross Weight', value: showText(record.ws_gross_weight) },
                  { label: 'Tare Weight', value: showText(record.ws_tare_weight) },
                  { label: 'Net Weight', value: showText(record.ws_net_weight) },
                ]}
              />
              )}
            </div>

            <MatchStrip
              title="Logistics Match Status"
              items={[
                { label: 'Vehicle', value: check('vehicle_match') },
                { label: 'Weight', value: check('weight_match') },
                { label: 'Weight Slip', value: check('weight_slip_match') },
              ]}
            />
          </CollapseSection>
          )}

          {/* ─── Section 6: Match Results ─── */}
          <CollapseSection title={isQuickEntry ? 'SO vs PO Check Results' : 'Match Results'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <AuditStatusStrip score={check('audit_score')} status={check('audit_status')} />
              <div className="audit-check-grid">
                {(isQuickEntry ? QUICK_ENTRY_CHECKS : MATCH_RESULT_CHECKS)
                  .filter(item => !item.hideWithout || hasPOData)
                  .map(item => (
                    <CheckRow key={item.key} label={item.label} value={check(item.key)} />
                  ))}
              </div>
            </div>
          </CollapseSection>

          {/* ─── Section 7: Audit Findings ─── */}
          <CollapseSection title="Audit Findings">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              <AuditStatusStrip score={check('audit_score')} status={check('audit_status')} />

              <FindingList
                tone="critical"
                title="Critical Mismatches"
                items={I.critical_mismatches}
                emptyText="No critical mismatches recorded."
              />

              <FindingList
                tone="warning"
                title="Warnings"
                items={I.warnings}
                emptyText="No warnings recorded."
              />

              <FindingList
                tone="missing"
                title="Missing Documents"
                items={I.missing_documents}
                emptyText={isQuickEntry ? 'Both the Sales Order and Purchase Order are available.' : 'All expected documents are available.'}
                icon={Info}
              />

              <SummaryBlock summary={I.audit_summary} />

              {hasMatrixMismatch && !toList(I.critical_mismatches).length && !toList(I.warnings).length && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.7rem 0.85rem',
                  borderRadius: '12px', backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
                  color: '#ef4444', fontSize: '0.82rem', fontWeight: 600
                }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                  <span>Field mismatch detected in the document comparison matrix.</span>
                </div>
              )}

              {!hasMatrixMismatch && !toList(I.critical_mismatches).length && !toList(I.warnings).length && !toList(I.missing_documents).length && !hasSourceValue(I.audit_summary) && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 0.85rem',
                  borderRadius: '12px', backgroundColor: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)',
                  color: '#10b981', fontSize: '0.82rem', fontWeight: 600
                }}>
                  <CheckCircle size={15} />
                  No issues found. All checks passed.
                </div>
              )}
            </div>
          </CollapseSection>


        </div>

        {/* ── Footer ── */}
        <div className="sales-modal-foot">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Overall Score</span>
            <Badge value={score} green={90} yellow={75} red={0} />
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            <button className="btn btn-outline" onClick={onClose} style={{ fontSize: '0.8rem', padding: '0.5rem 1.25rem' }}>Close</button>
            {hasDecision ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '0.5rem 1rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 700,
                background: decisionStatus === 'Approve' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                color: decisionStatus === 'Approve' ? '#10b981' : '#ef4444',
                border: `1px solid ${decisionStatus === 'Approve' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`
              }}>
                {decisionStatus === 'Approve' ? <CheckCircle size={14} /> : <X size={14} />}
                {decisionStatus === 'Approve' ? 'Approved' : 'Rejected'}
              </span>
            ) : onDecision && (
              <>
                <button className="btn btn-reject" onClick={() => onDecision(record.__uid || record.id, 'Reject')} disabled={isProcessing}
                  style={{ fontSize: '0.8rem', padding: '0.5rem 1.25rem' }}>
                  Reject Match
                </button>
                <button className="btn btn-approve" onClick={() => onDecision(record.__uid || record.id, 'Approve')} disabled={isProcessing}
                  style={{ fontSize: '0.8rem', padding: '0.5rem 1.25rem' }}>
                  Approve Match
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const thStyle = {
  padding: '0.6rem 0.75rem', textAlign: 'left', fontWeight: 700, fontSize: '0.7rem',
  textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)',
  borderBottom: '2px solid var(--border)', position: 'sticky', top: 0, background: 'rgba(0,0,0,0.03)',
  whiteSpace: 'nowrap'
};

const tdStyle = {
  padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)', verticalAlign: 'top'
};

/* The purchase matrix has to hold GSTINs, coil descriptions and six-figure
   amounts across up to four document columns at once, so it reads as cramped at
   the sales matrix's density. These layer more air on top of thStyle/tdStyle
   rather than changing the shared pair, which would reflow the sales table too. */
const purchaseThStyle = {
  ...thStyle,
  padding: '0.9rem 1rem',
  fontSize: '0.74rem',
};

const purchaseTdStyle = {
  ...tdStyle,
  padding: '0.85rem 1rem',
};

// Stops a column collapsing to nothing when a long description lands in one
// document and the others are short.
const PURCHASE_VALUE_MIN_WIDTH = 165;

const DATE_FILTERS = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'thisWeek', label: 'This Week' },
  { value: 'past30', label: 'Past 30 Days' },
  { value: 'past3m', label: 'Past 3 Months' },
  { value: 'past6m', label: 'Past 6 Months' },
  { value: 'thisYear', label: 'This Year' },
  { value: 'custom', label: 'Custom Range' },
];

// Score tiers for the purchase dropdown. Labels state the band so the number is
// not a guess: the boundaries are the ones getScoreTier uses.
const SCORE_FILTERS = [
  { value: 'all', label: 'Score: All' },
  { value: 'high', label: 'Score: High (>75)' },
  { value: 'medium', label: 'Score: Medium (50-75)' },
  { value: 'low', label: 'Score: Low (<50)' },
];

const getDateCutoff = (filter) => {
  const now = new Date();
  const start = new Date(now);
  switch (filter) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      return start.getTime();
    case 'thisWeek': {
      const day = (now.getDay() + 6) % 7;
      start.setDate(now.getDate() - day);
      start.setHours(0, 0, 0, 0);
      return start.getTime();
    }
    case 'past30':
      return now.getTime() - 30 * 24 * 60 * 60 * 1000;
    case 'past3m':
      start.setMonth(now.getMonth() - 3);
      return start.getTime();
    case 'past6m':
      start.setMonth(now.getMonth() - 6);
      return start.getTime();
    case 'thisYear':
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      return start.getTime();
    default:
      return null;
  }
};

// ── Purchase Ledger Presentation Helpers ───────────────────────
// The webhook sends amounts as strings that may carry currency symbols or
// separators, so strip them before parsing.
const parseLedgerAmount = (value) => {
  if (value === null || value === undefined) return null;
  const parsed = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isNaN(parsed) ? null : parsed;
};

// Auto-scaling money, mirroring Dashboard's formatCurrency: Cr → L → plain ₹.
const formatLedgerAmount = (value) => {
  const amount = parseLedgerAmount(value);
  if (amount === null) return '—';
  if (Math.abs(amount) >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (Math.abs(amount) >= 100000) return `₹${(amount / 100000).toFixed(2)} L`;
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

// The audit report can sit in any of these JSON fields (same set the Dashboard
// checks) and may arrive array-wrapped, so unwrap once before scoring.
const parseLedgerAuditResult = (record) => {
  const fields = ['inv_audit_result', 'inv_result', 'Audit_Result', 'Audit_Intelligence', 'audit_result'];
  for (const key of fields) {
    const raw = record?.[key];
    if (raw === null || raw === undefined) continue;
    let parsed = typeof raw === 'string' ? null : raw;
    if (typeof raw === 'string') {
      try { parsed = JSON.parse(raw); } catch { continue; }
    }
    if (Array.isArray(parsed)) {
      const flat = parsed.find(e => e && typeof e === 'object' && !Array.isArray(e));
      parsed = flat || null;
    }
    if (parsed && typeof parsed === 'object') return parsed;
  }
  return null;
};

// Scores arrive as 87, '87%', '87.5' or a textual 'N/A'; any of those that do
// not resolve to a finite number are treated as "not scored yet".
const parseScoreValue = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const lower = value.trim().toLowerCase();
  if (!lower || ['n/a', 'na', 'none', '-', '--', '—', 'null', 'undefined', 'pending', 'unavailable'].includes(lower)) return null;
  const numeric = Number(lower.replace('%', '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
};

// A score may live in any of several fields depending on which pipeline wrote
// the record; the Dashboard reads the same chain. First hit wins.
const pickScore = (record, result) => {
  const candidates = [
    // The current purchase workflow writes the score to a flat column; older
    // rows only carry it inside the embedded report.
    record?.match_score,
    record?.inv_audit_score,
    record?.audit_score,
    result?.overall?.final_score,
    result?.overall_summary?.average_score,
    result?.output?.overall_summary?.average_score,
    result?.score,
    result?.audit_score,
    record?.Score,
    record?.score,
  ];
  for (const candidate of candidates) {
    const score = parseScoreValue(candidate);
    if (score !== null) return score;
  }
  return null;
};

const getLedgerScore = (record, result) => {
  const numeric = pickScore(record, result);
  if (numeric === null) return { value: null, text: '—', tone: 'none' };
  const clamped = Math.max(0, Math.min(100, numeric));
  // Same tier bands as the sales filters: High >75, Medium 50–75, Low <50.
  return { value: clamped, text: `${clamped}%`, tone: getScoreTier(clamped) };
};

const formatLedgerTimestamp = (value) => {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/* The dial on a grouped card. A purchase audit is split across several rows and
   only some of them carry a score, so the card shows the highest one recorded —
   the audit is not weaker than its best-measured row, and showing a blank dial
   because the sibling rows went unscored would understate it. Rows that were
   never scored at all still read as "not recorded". */
const getPurchaseGroupScore = (group) => {
  let best = null;
  group.records.forEach((record) => {
    const { value } = getLedgerScore(record, parseLedgerAuditResult(record));
    if (value !== null && (best === null || value > best)) best = value;
  });
  if (best === null) return { value: null, text: '—', tone: 'none' };
  return { value: best, text: `${best}%`, tone: getScoreTier(best) };
};

// ── Sales Ledger Score Helpers ───────────────────────────────
// Sales records carry their audit score under `intelligence.audit_score`
// (or at the top level when the transform hasn't split it out). Some rows only
// have the value nested inside their embedded audit report, so walk the same
// chain used on the purchase side.
const getSalesScore = (record) => {
  const intel = record?.intelligence || {};
  const rawAudit = record?.audit_result || intel?.audit_result;
  const candidates = [
    intel?.inv_audit_score,
    intel?.audit_score,
    record?.inv_audit_score,
    record?.audit_score,
    rawAudit?.overall?.final_score,
    intel?.overall?.final_score,
    rawAudit?.overall_summary?.average_score,
    rawAudit?.score,
    record?.Score,
    record?.score,
  ];
  for (const candidate of candidates) {
    const score = parseScoreValue(candidate);
    if (score !== null) return score;
  }
  return null;
};

// Tiers the user set for the ledger itself: Low ≤ 50, Medium 50–75, High > 75.
const getScoreTier = (score) => {
  if (score === null || score === undefined) return 'none';
  if (score > 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
};

const getSalesGroupScoreInfo = (group) => {
  let value = null;
  group.records.forEach((record) => {
    const score = getSalesScore(record);
    if (score !== null && (value === null || score > value)) value = score;
  });
  const valueInt = value === null ? null : Math.round(value);
  return {
    value: valueInt,
    text: valueInt === null ? '—' : `${valueInt}%`,
    tier: getScoreTier(valueInt),
  };
};

const isWithinDateFilter = (createdAt, filter, customRange) => {
  const ts = new Date(createdAt || 0).getTime();
  if (!ts) return false;
  if (filter === 'custom') {
    const { start, end } = customRange || {};
    if (!start && !end) return true;
    const startMs = start ? new Date(start).setHours(0, 0, 0, 0) : null;
    const endMs = end ? new Date(end).setHours(23, 59, 59, 999) : null;
    if (startMs !== null && ts < startMs) return false;
    if (endMs !== null && ts > endMs) return false;
    return true;
  }
  if (!filter || filter === 'all') return true;
  const cutoff = getDateCutoff(filter);
  if (cutoff === null) return true;
  return ts >= cutoff;
};

const AuditHistory = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeSide, setActiveSide] = useState('purchase') // 'purchase' | 'sales'
  const [pendingUploadGroup, setPendingUploadGroup] = useState(null)
  const [history, setHistory] = useState([])
  const [salesHistory, setSalesHistory] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSalesLoading, setIsSalesLoading] = useState(false)
  const [error, setError] = useState(null)
  const [salesError, setSalesError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedAudit, setSelectedAudit] = useState(null)
  const [selectedSalesGroup, setSelectedSalesGroup] = useState(null)
  const [decisionProcessing, setDecisionProcessing] = useState(null)
  const [confirmDecision, setConfirmDecision] = useState(null)
  const [sortOrder, setSortOrder] = useState('latest') // 'latest' | 'oldest'
  const [dateFilter, setDateFilter] = useState('all') // 'all' | 'today' | 'thisWeek' | 'past30' | 'past3m' | 'past6m' | 'thisYear' | 'custom'
  const [customDateRange, setCustomDateRange] = useState({ start: '', end: '' })
  const [purchasePage, setPurchasePage] = useState(1)
  const [salesPage, setSalesPage] = useState(1)
  const [salesQuickOnly, setSalesQuickOnly] = useState(false)
  const [purchaseScoreFilter, setPurchaseScoreFilter] = useState('all') // 'all' | 'high' | 'medium' | 'low'
  const [salesScoreFilter, setSalesScoreFilter] = useState('all') // 'all' | 'high' | 'medium' | 'low'

  // Derived: which groups already have a decision saved
  const salesGroupDecisions = useMemo(() => {
    const map = {};
    salesHistory.forEach(r => {
      const inv = getSalesGroupKey(r);
      if (!inv || inv === 'Unknown') return;
      const raw = r.Result || r.result || r.Status || r.status;
      if (raw === 'Approve' || raw === 'Reject' || raw === 'APPROVED' || raw === 'REJECTED') {
        if (!map[inv]) map[inv] = raw === 'APPROVED' ? 'Approve' : raw === 'REJECTED' ? 'Reject' : raw;
      } else if (raw === 'yes' || raw === 'Yes' || raw === 'YES') {
        if (!map[inv]) map[inv] = 'Approve';
      }
    });
    return map;
  }, [salesHistory]);

  const handleDecisionClick = (auditId, decision) => {
    if (activeSide === 'sales') {
      handleSalesDecision(auditId, decision);
      return;
    }
    setConfirmDecision({ id: auditId, decision });
  }

  const handleSalesDecision = async (uid, decision) => {
    setDecisionProcessing(uid);

    // The two sales ledgers have independent id sequences, so the record is
    // resolved by its table-qualified key before anything is written back.
    const record = salesHistory.find(r => (r.__uid || r.id) === uid);

    // Optimistic update: immediately mark all records with same invoice as decided
    setSalesHistory(prev => {
      const targetInvoice = record ? getSalesGroupKey(record) : null;
      if (!targetInvoice || targetInvoice === 'Unknown') return prev;
      return prev.map(r => {
        const inv = getSalesGroupKey(r);
        if (inv === targetInvoice) {
          return { ...r, Result: decision };
        }
        return r;
      });
    });

    try {
      // The decision workflow is shared by both sales ledgers, so the table it
      // should write back to travels as the `action` query parameter.
      const action = SALES_DECISION_ACTIONS[record?.__source] || SALES_DECISION_ACTIONS.sales;
      const response = await fetch(`${SALES_DECISION_WEBHOOK_URL}?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: record?.id ?? uid,
          decision
        })
      });
      if (!response.ok) throw new Error('Network response was not ok');
      setSelectedSalesGroup(null);
      await fetchSalesHistory(false);
    } catch (err) {
      console.error('Sales decision submission failed', err);
      alert('Failed to submit sales decision.');
      // Roll back optimistic update on failure
      await fetchSalesHistory(false);
    } finally {
      setDecisionProcessing(null);
    }
  }

  const executeDecision = async () => {
    if (!confirmDecision) return;
    const { id, decision } = confirmDecision;
    setDecisionProcessing(id);
    try {
      const response = await fetch(import.meta.env.VITE_DECISION_WEBHOOK_URL || 'https://n8n.srv1010832.hstgr.cloud/webhook/1e6f6a92-5353-47ee-a10f-8e0b198cba84', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference: `REF: ${id}`,
          decision: decision
        })
      });
      
      if (!response.ok) throw new Error('Network response was not ok');
      
      setConfirmDecision(null);
      setSelectedAudit(null);
      setSelectedSalesGroup(null);
      await fetchHistory(false);
    } catch (err) {
      console.error('Decision submission failed', err);
      alert('Failed to communicate with webhook.');
      setConfirmDecision(null);
    } finally {
      setDecisionProcessing(null);
    }
  }

  const normalizeArray = (data, depth = 0) => {
    if (depth > 3) return [];
    if (Array.isArray(data)) {
      // Check if the array wraps a single object with a data key
      if (data.length === 1 && data[0] && typeof data[0] === 'object' && !Array.isArray(data[0])) {
        const inner = normalizeArray(data[0], depth + 1);
        if (Array.isArray(inner) && inner.length > 0) return inner;
      }
      return data;
    }
    if (!data || typeof data !== 'object') return [];
    if (data?.audits && Array.isArray(data.audits)) return data.audits;
    if (data?.data && Array.isArray(data.data)) return data.data;
    if (data?.results && Array.isArray(data.results)) return data.results;
    if (data?.records && Array.isArray(data.records)) return data.records;
    if (data?.items && Array.isArray(data.items)) return data.items;
    // Unwrap single-key wrapper objects (e.g. {"sales": [...]})
    const keys = Object.keys(data);
    if (keys.length === 1 && Array.isArray(data[keys[0]])) return data[keys[0]];
    if (depth === 0 && keys.length > 0) {
      // Check if any value is an array and return the largest one
      const arrays = keys.filter(k => Array.isArray(data[k]) && data[k].length > 0);
      if (arrays.length === 1) return data[arrays[0]];
    }
    return [data];
  };

  const fetchHistory = async (showLoading = true) => {
    if (showLoading) setIsLoading(true)
    setError(null)
    try {
      const data = await fetchPurchaseRecords();
      const auditData = normalizeArray(data);
      
      setHistory(prev => {
        const merged = new Map();
        prev.forEach(item => merged.set(item.id, item));
        auditData.forEach(item => merged.set(item.id, item));
        return Array.from(merged.values()).sort((a, b) => 
          new Date(b.created_at || Date.now()) - new Date(a.created_at || Date.now())
        );
      });
    } catch (err) {
      console.error('History Fetch Error:', err)
      setError(`Could not load purchase records. ${err.message}`)
      setHistory([])
    } finally {
      setIsLoading(false)
    }
  }

// The sales side reads exactly one of the two sales tables — the toggle
  // picks which, and the other table is never requested.
  const fetchSalesHistory = async (showLoading = true) => {
    if (showLoading) setIsSalesLoading(true)
    setSalesError(null)
    const source = salesLedgerSource(salesQuickOnly)
    try {
      const data = await fetchSalesRecords(source);
      const salesData = normalizeArray(data);
      
      // Transform each record: nest intelligence/match fields under `intelligence`
      const transformed = salesData.map(transformSalesRecord);
      
      // Deduplicate by ID to handle potential backend/API duplicates. The key is
      // table-qualified because the sales and quick-check ledgers have
      // independent id sequences.
      const uniqueSales = Array.from(
        new Map(transformed.map(item => [item.__uid || item.id || JSON.stringify(item), item])).values()
      );
      
      setSalesHistory(uniqueSales);
    } catch (err) {
      console.error('Sales History Fetch Error:', err)
      setSalesError(`Could not load ${source === 'sales_qc' ? 'quick check' : 'sales'} records. ${err.message}`)
      setSalesHistory([]);
} finally {
      setIsSalesLoading(false);
    }
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  // The two sales ledgers are separate tables, so flipping the toggle is a
  // ledger change, not a client-side filter — the previously loaded rows are
  // dropped and the other table is read. This one does show the loader: the
  // request crosses to the server, and without it the stale rows from the other
  // ledger sat there looking like the new ledger had simply not changed.
  useEffect(() => {
    setSelectedSalesGroup(null);
    setSalesPage(1);
    fetchSalesHistory();
  }, [salesQuickOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  useSyncRefresh(() => {
    const jobs = [fetchHistory(false)]
    if (activeSide === 'sales' || salesHistory.length > 0) jobs.push(fetchSalesHistory(false))
    return Promise.all(jobs)
  })

  // Deep-link: auto-open sales modal from ?so= URL param
  useEffect(() => {
    const soParam = searchParams.get('so');
    if (!soParam) return;
    // Switch to sales tab and load sales data if needed
    if (activeSide !== 'sales') {
      setActiveSide('sales');
    }
    if (salesHistory.length === 0 && !isSalesLoading) {
      fetchSalesHistory();
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once salesHistory is loaded, match and open the group from the URL param
  useEffect(() => {
    const soParam = searchParams.get('so');
    if (!soParam || salesHistory.length === 0) return;
    const decoded = decodeURIComponent(soParam);
    const groups = {};
    salesHistory.forEach(record => {
      const invoiceNum = getSalesGroupKey(record);
      if (!groups[invoiceNum]) {
        groups[invoiceNum] = {
          invoiceNumber: invoiceNum,
          records: [],
          partyName: record.so_customer_name || record.so_broker_name || record.inv_bill_to_name || 'Unknown Party',
          latestDate: record.created_at
        };
      }
      groups[invoiceNum].records.push(record);
    });
    const match = groups[decoded];
    if (match && !selectedSalesGroup) {
      setSelectedSalesGroup(match);
    }
  }, [salesHistory, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSideToggle = (side) => {
    setActiveSide(side);
    setSearchTerm('');
    if (side === 'sales' && salesHistory.length === 0 && !isSalesLoading) {
      fetchSalesHistory();
    }
  };

  const filteredHistory = useMemo(() => {
    const term = searchTerm.toLowerCase();
    const matchesText = (value) => hasSourceValue(value) && String(value).toLowerCase().includes(term);
    const filtered = history.filter(item =>
      isWithinDateFilter(item.created_at, dateFilter, customDateRange) &&
      (matchesText(item.Invoice_Number_Invoice) ||
      matchesText(item.Supplier_Name_Invoice) ||
      matchesText(readPurchaseColumn(item, 'Vehicle_No_Eway')) ||
      (item.id?.toString().includes(term)))
    );
    return [...filtered].sort((a, b) => {
      const da = new Date(a.created_at || 0).getTime();
      const db = new Date(b.created_at || 0).getTime();
      return sortOrder === 'latest' ? db - da : da - db;
    });
  }, [history, searchTerm, sortOrder, dateFilter, customDateRange])

  /* One purchase audit can land on the ledger as several rows — one per reconciled
     document — so the flat list above is collapsed to one card per invoice number.
     The rows are kept in newest-first order inside the group because the modal
     steps through them in that order. */
  const groupedPurchaseHistory = useMemo(() => {
    const groups = new Map();

    filteredHistory.forEach(record => {
      const key = getPurchaseGroupKey(record);
      if (!key) return;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          invoiceNumber: record.Invoice_Number_Invoice || 'Invoice number unavailable',
          records: [],
          latestDate: record.created_at,
        });
      }
      groups.get(key).records.push(record);
      const current = groups.get(key);
      if (record.created_at && (!current.latestDate || new Date(record.created_at) > new Date(current.latestDate))) {
        current.latestDate = record.created_at;
      }
    });

    const rows = Array.from(groups.values());
    /* Tier filter, same bands as the sales side: High >75, Medium 50-75, Low <50.
       Scored off the group rather than a single row, because an invoice split
       across four documents keeps the score of the record that actually carried
       it. Rows with no score at all have tone 'none' and fall out of every tier. */
    if (purchaseScoreFilter === 'all') return rows;
    return rows.filter(group => getPurchaseGroupScore(group).tone === purchaseScoreFilter);
  }, [filteredHistory, purchaseScoreFilter])

  const filteredSalesHistory = useMemo(() => {
    const term = searchTerm.toLowerCase();
    let result = salesHistory;
    if (dateFilter !== 'all') {
      result = salesHistory.filter(item => isWithinDateFilter(item.created_at, dateFilter, customDateRange));
    }
    if (term) {
      // The __source / __uid tags are plumbing, not ledger content — searching
      // them would make every row match on the word "sales".
      result = result.filter(item =>
        Object.entries(item).some(([key, value]) =>
          !key.startsWith('__') && value?.toString().toLowerCase().includes(term)
        )
      );
    }
    return result;
  }, [salesHistory, searchTerm, dateFilter, customDateRange])

  // Group sales records by invoice number
  const groupedSalesHistory = useMemo(() => {
    const groups = {};
    filteredSalesHistory.forEach(record => {
      const invoiceNum = getSalesGroupKey(record);
      if (!groups[invoiceNum]) {
        groups[invoiceNum] = {
          invoiceNumber: invoiceNum,
          records: [],
          partyName: record.so_customer_name || record.so_broker_name || record.po_customer_name || record.po_supplier_name || record.inv_bill_to_name || record.sheet_bill_to_name || record.bill_to_name || record.inv_broker_name || record.sheet_broker_name || record.broker_name || 'Unknown Party',
          latestDate: record.created_at
        };
      }
      groups[invoiceNum].records.push(record);
      if (record.created_at && (!groups[invoiceNum].latestDate || new Date(record.created_at) > new Date(groups[invoiceNum].latestDate))) {
        groups[invoiceNum].latestDate = record.created_at;
      }
    });
    const groups_arr = Object.values(groups);
    // The ledger on screen is already a single table, so only the score tier
    // still needs filtering here.
    const filtered = groups_arr.filter(group => {
      if (salesScoreFilter !== 'all') {
        const tier = getSalesGroupScoreInfo(group).tier;
        if (tier !== salesScoreFilter) return false;
      }
      return true;
    });
    filtered.sort((a, b) => {
      const da = new Date(a.latestDate || 0).getTime();
      const db = new Date(b.latestDate || 0).getTime();
      return sortOrder === 'latest' ? db - da : da - db;
    });
    return filtered;
  }, [filteredSalesHistory, sortOrder, salesScoreFilter])

  useEffect(() => {
    setPurchasePage(1)
    setSalesPage(1)
  }, [activeSide, searchTerm, sortOrder, dateFilter, customDateRange, salesQuickOnly, salesScoreFilter, purchaseScoreFilter])

  useEffect(() => {
    setPurchasePage(page => Math.max(1, Math.min(page, Math.ceil(groupedPurchaseHistory.length / LEDGERS_PER_PAGE))))
  }, [groupedPurchaseHistory.length])

  useEffect(() => {
    setSalesPage(page => Math.max(1, Math.min(page, Math.ceil(groupedSalesHistory.length / LEDGERS_PER_PAGE))))
  }, [groupedSalesHistory.length])

  // Rotating hints for the vanishing search field, drawn from the parties
  // actually present in the loaded ledger so the prompt names real suppliers
  // (purchase) or customers (sales) rather than generic filler text.
  const searchPlaceholders = useMemo(() => {
    const names = activeSide === 'purchase'
      ? history.map(r => r.Supplier_Name_Invoice)
      : salesHistory.map(r => r.so_customer_name);

    const seen = new Set();
    const unique = [];
    names.forEach(name => {
      if (!hasSourceValue(name)) return;
      const text = String(name).trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      unique.push(text);
    });

    return unique.length > 0
      ? unique.slice(0, 8)
      : [activeSide === 'purchase'
          ? 'Search invoices, suppliers or vehicle numbers...'
          : 'Search sales invoices or customers...'];
  }, [activeSide, history, salesHistory])

  const purchaseTotalPages = Math.max(1, Math.ceil(groupedPurchaseHistory.length / LEDGERS_PER_PAGE))
  const salesTotalPages = Math.max(1, Math.ceil(groupedSalesHistory.length / LEDGERS_PER_PAGE))
  const currentPurchasePage = Math.min(Math.max(purchasePage, 1), purchaseTotalPages)
  const currentSalesPage = Math.min(Math.max(salesPage, 1), salesTotalPages)
  const paginatedHistory = groupedPurchaseHistory.slice((currentPurchasePage - 1) * LEDGERS_PER_PAGE, currentPurchasePage * LEDGERS_PER_PAGE)
  const paginatedSalesHistory = groupedSalesHistory.slice((currentSalesPage - 1) * LEDGERS_PER_PAGE, currentSalesPage * LEDGERS_PER_PAGE)

  // Derive sales table columns dynamically (must be before any early return)
  const salesColumns = useMemo(() => {
    if (salesHistory.length === 0) return [];
    const allKeys = new Set();
    salesHistory.forEach(row => Object.keys(row).forEach(k => allKeys.add(k)));
    return Array.from(allKeys);
  }, [salesHistory]);

  if (isLoading) {
    return (
      <div className="flex-center" style={{ height: '70vh', flexDirection: 'column', gap: '1.5rem' }}>
        <SquareWaveLoader count={5} size={14} squareClassName="bg-primary" />
        <p className="text-muted font-bold tracking-widest uppercase text-xs">Accessing Audit Vault...</p>
      </div>
    )
  }

  return (
    <div className="history-page animate-fade-in">
      <div className="page-header mb-8">
        <div className="flex-between ledger-heading-row mb-6">
          <div>
            <h1 className="page-title">Operational Ledger</h1>
            <p className="page-subtitle">
              {activeSide === 'purchase' ? 'Purchase audit traces & dispatch compliance' : 'Sales side records & invoice log'}
            </p>
          </div>
        </div>

        <div className="header-actions-bar ledger-toolbar">
          <div className="side-toggle-group">
            <button
              className={`pebble-btn side-toggle-btn ${activeSide === 'purchase' ? 'is-active is-purchase' : ''}`}
              onClick={() => handleSideToggle('purchase')}
              aria-pressed={activeSide === 'purchase'}
            >
              <ShoppingCart size={15} className="pebble-btn-icon" />
              <span>Purchase</span>
            </button>
            <button
              className={`pebble-btn side-toggle-btn ${activeSide === 'sales' ? 'is-active is-sales' : ''}`}
              onClick={() => handleSideToggle('sales')}
              aria-pressed={activeSide === 'sales'}
            >
              <IndianRupee size={15} className="pebble-btn-icon" />
              <span>Sales</span>
            </button>
          </div>
          
          <div className="search-bar-container">
            <PebbleSelect
              className="date-filter-wrap"
              value={dateFilter}
              options={DATE_FILTERS}
              onChange={setDateFilter}
              icon={Filter}
              ariaLabel="Filter by date"
            />
            {/* Score tiers, same dropdown on both sides. It lives in the toolbar
                rather than above the ledger because a filter that lives with the
                results disappears when the results it produced are empty — which
                leaves you unable to clear the filter that emptied them. */}
            <PebbleSelect
              className="date-filter-wrap"
              value={activeSide === 'purchase' ? purchaseScoreFilter : salesScoreFilter}
              options={SCORE_FILTERS}
              onChange={activeSide === 'purchase' ? setPurchaseScoreFilter : setSalesScoreFilter}
              icon={Shield}
              ariaLabel="Filter by audit score"
            />
            {dateFilter === 'custom' && (
              <div className="custom-date-range">
                <input
                  type="date"
                  className="date-range-input"
                  value={customDateRange.start}
                  max={customDateRange.end || undefined}
                  onChange={(e) => setCustomDateRange(prev => ({ ...prev, start: e.target.value }))}
                  title="From date"
                />
                <span className="date-range-sep">to</span>
                <input
                  type="date"
                  className="date-range-input"
                  value={customDateRange.end}
                  min={customDateRange.start || undefined}
                  onChange={(e) => setCustomDateRange(prev => ({ ...prev, end: e.target.value }))}
                  title="To date"
                />
                {(customDateRange.start || customDateRange.end) && (
                  <button
                    className="btn btn-outline btn-sm date-range-clear"
                    onClick={() => setCustomDateRange({ start: '', end: '' })}
                    title="Clear custom range"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            )}
            {/* Vanishing search field. Filtering is live while typing, so Enter
                is free to be the "vanish" gesture — it clears both the field
                and the filter together, which is the only way to keep the two
                in sync given the input owns its own value internally. */}
            <div className="ledger-search">
              <PlaceholdersAndVanishInput
                key={activeSide}
                placeholders={searchPlaceholders}
                onChange={(e) => setSearchTerm(e.target.value)}
                onSubmit={() => setSearchTerm('')}
              />
            </div>
            <button 
              className="pebble-btn ledger-sort-btn"
              onClick={() => setSortOrder(sortOrder === 'latest' ? 'oldest' : 'latest')}
              title={`Sort: ${sortOrder === 'latest' ? 'Newest first' : 'Oldest first'}`}
              aria-label={`Sort: ${sortOrder === 'latest' ? 'Newest first' : 'Oldest first'}`}
            >
              {sortOrder === 'latest'
                ? <ArrowDownWideNarrow size={15} className="pebble-btn-icon" />
                : <ArrowUpNarrowWide size={15} className="pebble-btn-icon" />}
              <span className="hide-mobile">{sortOrder === 'latest' ? 'Latest' : 'Oldest'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── PURCHASE SIDE ──────────────────────────────────────── */}
      {activeSide === 'purchase' && (
        <div className="card table-card overflow-hidden animate-fade-in">
          {paginatedHistory.length === 0 ? (
            <div className="empty-state">
              <AlertTriangle size={40} className="empty-icon" />
              <p>{error || 'No purchase records found.'}</p>
            </div>
          ) : (
          <>
          <div className="purchase-ledger-list">
            {paginatedHistory.map((group) => {
              const score = getPurchaseGroupScore(group);
              const amount = (() => {
                // The rows are one invoice split across documents, not separate
                // invoices, so they all carry the same value — taking the first
                // one that has it rather than summing, which would multiply the
                // total by the number of documents.
                for (const record of group.records) {
                  const value = parseLedgerAmount(
                    record.Total_Amount_Invoice ?? record.Total_Amount_EWay ?? record.Amount
                  );
                  if (value !== null && value !== undefined) return value;
                }
                return null;
              })();
              const invoiceNo = group.invoiceNumber;
              const supplier = group.records.find(r => hasSourceValue(r.Supplier_Name_Invoice))?.Supplier_Name_Invoice || 'Unknown supplier';
              const openAudit = () => setSelectedAudit(group);

              /* Document chips are a union across the group: the audit captured
                 all four documents, but each row only carries the columns for
                 the document it reconciled, so a per-row read would show three
                 of the four as "not provided" for every row. Facts are read the
                 same way — first row in the group that has a value wins. */
              const docPresence = PURCHASE_DOC_FAMILIES.reduce((acc, fam) => {
                acc[fam.key] = group.records.some(record => getPurchaseDocumentPresence(record)[fam.key]);
                return acc;
              }, {});

              const pickFact = (field, fallback) =>
                group.records.find(r => hasSourceValue(r[field]))?.[field] || fallback;

              /* Either spelling of the E-Way vehicle column will do, so a row
                 extracted under the other one is not shown as a blank card fact. */
              const pickVehicle = () =>
                group.records.map(r => readPurchaseColumn(r, 'Vehicle_No_EWay'))
                  .find(v => hasSourceValue(v));

              // A label with nothing after it is just noise, so facts without a
              // value drop out and the remaining ones re-flow into the grid.
              const facts = [
                { icon: <Truck size={12} />, label: 'Vehicle', value: pickVehicle() },
                { icon: <Hash size={12} />, label: 'Batch', value: pickFact('Batch_Code_Invoice') },
                { icon: <FileText size={12} />, label: 'E-Way Bill', value: pickFact('EWB_Number_EWay') || pickFact('Invoice_Number_EWay') },
                { icon: <Activity size={12} />, label: 'Audited', value: formatLedgerTimestamp(group.latestDate), always: true },
              ].filter((fact) => fact.always || (fact.value && String(fact.value).trim()));

              return (
                <article
                  key={group.key}
                  className={`purchase-record-card tone-${score.tone}`}
                  onClick={openAudit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openAudit();
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open audit for invoice ${invoiceNo}`}
                >
                  <div
                    className={`purchase-score-dial tone-${score.tone}`}
                    style={score.value !== null
                      ? { background: `conic-gradient(currentColor ${score.value}%, var(--border) ${score.value}%)` }
                      : undefined}
                    title={score.value !== null ? `Compliance score ${score.value}%` : 'No compliance score'}
                  >
                    <span className="purchase-score-value">{score.text}</span>
                    <span className="purchase-score-label">Score</span>
                  </div>

                  <div className="purchase-card-body">
                    <div className="purchase-card-head">
                      <div className="purchase-identity">
                        <h3 className="purchase-invoice-no" title={invoiceNo}>{invoiceNo}</h3>
                        <span className="purchase-ref">REF {group.records[0].id}</span>
                        {group.records.length > 1 && (
                          <span className="item-count-badge">{group.records.length} items</span>
                        )}
                      </div>
                    </div>

                    <p className="purchase-supplier" title={supplier}>{supplier}</p>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.5rem' }}>
                      {PURCHASE_DOC_FAMILIES.map(fam => {
                        const has = docPresence[fam.key];
                        return (
                          <span
                            key={fam.key}
                            title={has ? `${fam.label} captured` : `${fam.label} not provided`}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                              padding: '0.12rem 0.45rem', borderRadius: '999px',
                              fontSize: '0.6rem', fontWeight: 800, textTransform: 'uppercase',
                              letterSpacing: '0.05em', whiteSpace: 'nowrap',
                              background: has ? 'rgba(16,185,129,0.10)' : 'rgba(0,0,0,0.03)',
                              color: has ? '#10b981' : 'var(--text-muted)',
                              border: `1px solid ${has ? 'rgba(16,185,129,0.22)' : 'var(--border)'}`
                            }}
                          >
                            {has ? <Check size={9} /> : <X size={9} />}
                            {fam.label}
                          </span>
                        );
                      })}
                    </div>

                    <dl className="purchase-facts">
                      {facts.map((fact) => (
                        <div className="purchase-fact" key={fact.label}>
                          <dt>{fact.icon} {fact.label}</dt>
                          <dd>{fact.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  <div className="purchase-card-price" title={`Invoice value ${formatLedgerAmount(amount)}`}>
                    <span className="purchase-amount">{formatLedgerAmount(amount)}</span>
                  </div>
                </article>
              );
            })}
          </div>
          <LedgerPagination
            totalItems={groupedPurchaseHistory.length}
            currentPage={currentPurchasePage}
            onPageChange={setPurchasePage}
            itemLabel="purchase audits"
          />
          </>
          )}
        </div>
      )}

      {/* ── SALES SIDE ──────────────────────────────────────── */}
      {activeSide === 'sales' && (
        <div className="card table-card overflow-hidden animate-fade-in">
          {isSalesLoading ? (
            <div className="flex-center" style={{ height: '300px', flexDirection: 'column', gap: '1.5rem' }}>
              <SquareWaveLoader count={5} size={12} squareClassName="bg-primary" />
              <p className="text-muted font-bold tracking-widest uppercase text-xs">Fetching Sales Records...</p>
            </div>
          ) : filteredSalesHistory.length === 0 ? (
            <div className="empty-state">
              <AlertTriangle size={40} className="empty-icon" />
              <p>{salesError || (salesQuickOnly ? 'No quick check records found.' : 'No sales records found.')}</p>
            </div>
          ) : (
            <>
          <div className="sales-filter-bar">
            <label className="quick-switch" title="On: read the Quick Check ledger. Off: read the normal Sales ledger.">
              <span className={`quick-switch-label ${salesQuickOnly ? 'on' : ''}`}>Quick Entry</span>
              <button
                type="button"
                role="switch"
                aria-checked={salesQuickOnly}
                aria-label="Show the quick check ledger"
                className={`quick-switch-track ${salesQuickOnly ? 'on' : ''}`}
                onClick={() => setSalesQuickOnly(value => !value)}
              >
                <span className="quick-switch-knob" />
              </button>
            </label>
          </div>

          {groupedSalesHistory.length === 0 ? (
            <div className="empty-state">
              <AlertTriangle size={40} className="empty-icon" />
              <p>No sales records match the current filters.</p>
            </div>
          ) : (
          <div className="sales-records-list animate-fade-in">
              {paginatedSalesHistory.map((group, idx) => {
                const groupDecision = salesGroupDecisions[group.invoiceNumber];
                const isQuickEntry = isRecordQuickEntry(group.records[0]);
                // Check if any record in the group has pending documents
                const pendingDocStatus = group.records.reduce((acc, r) => {
                  const s = isRecordPendingDocuments(r);
                  return {
                    pending: acc.pending || s.pending,
                    missingLabels: [...new Set([...acc.missingLabels, ...s.missingLabels])],
                  };
                }, { pending: false, missingLabels: [] });
                const hasPendingDocs = PENDING_DOCS_UPLOAD_ENABLED && pendingDocStatus.pending;
                const cardBg = groupDecision === 'Approve' ? 'rgba(16, 185, 129, 0.12)' :
                               groupDecision === 'Reject' ? 'rgba(239, 68, 68, 0.12)' :
                               hasPendingDocs ? 'rgba(245,158,11,0.06)' : '';
                // Score marker on the ledger itself: tier shows the colour before
                // the user even opens the record.
                const scoreInfo = getSalesGroupScoreInfo(group);
                return (
                <div 
                  key={group.invoiceNumber || idx} 
                  className={`sales-record-card tone-${scoreInfo.tier}`}
                  style={{
                    ...(cardBg ? { backgroundColor: cardBg } : {}),
                    ...(hasPendingDocs && !groupDecision ? { borderLeft: '3px solid #f59e0b' } : {})
                  }}
                  onClick={() => {
                    const encoded = encodeURIComponent(group.invoiceNumber);
                    setSearchParams({ so: encoded });
                    setSelectedSalesGroup(group);
                  }}
                >
                  <div className="sales-record-info">
                    <div className="sales-invoice-header">
                      <h3 className="sales-party-name" title={group.partyName}>{group.partyName}</h3>
                      {group.records.length > 1 && (
                        <span className="item-count-badge">{group.records.length} items</span>
                      )}
                      {isQuickEntry && (
                        <span className="quick-entry-badge">Quick Entry</span>
                      )}
                      {hasPendingDocs && !groupDecision && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                          padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.68rem', fontWeight: 800,
                          background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                          border: '1px solid rgba(245,158,11,0.3)', textTransform: 'uppercase', letterSpacing: '0.05em'
                        }}>
                          <AlertTriangle size={10} />
                          {pendingDocStatus.missingLabels.join(' & ')} Pending
                        </span>
                      )}                    </div>
                    <div className="sales-meta">
                      <span className="sales-so-id" title={group.invoiceNumber}>{group.invoiceNumber}</span>
                      <span className="sales-dot">•</span>
                      <span className="sales-date">
                        {group.latestDate ? new Date(group.latestDate).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}
                      </span>
                    </div>
                  </div>
                  <div className="sales-record-action">
                    <span
                      className={`sales-score-indicator tone-${scoreInfo.tier}`}
                      title={scoreInfo.value !== null ? `Audit score: ${scoreInfo.text} (${scoreInfo.tier === 'high' ? 'High, above 75%' : scoreInfo.tier === 'medium' ? 'Medium, 50–75%' : scoreInfo.tier === 'low' ? 'Low, below 50%' : 'no score'})` : 'No audit score recorded'}
                    >
                      {scoreInfo.value !== null ? `${scoreInfo.value}%` : '—'}
                    </span>
                    {groupDecision && (
                      <span className={`sales-decision-badge ${groupDecision === 'Approve' ? 'badge-approve' : 'badge-reject'}`} style={{
                        background: groupDecision === 'Approve' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                        color: groupDecision === 'Approve' ? '#10b981' : '#ef4444',
                        border: `1px solid ${groupDecision === 'Approve' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`
                      }}>
                        {groupDecision === 'Approve' ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                        {groupDecision === 'Approve' ? 'Approved' : 'Rejected'}
                      </span>
                    )}
                    {hasPendingDocs && !groupDecision && (
                      <button
                        className="btn btn-outline btn-sm"
                        onClick={(e) => { e.stopPropagation(); setPendingUploadGroup(group); }}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                          fontSize: '0.72rem', fontWeight: 700, padding: '0.4rem 0.85rem',
                          borderColor: '#f59e0b', color: '#f59e0b',
                          background: 'rgba(245,158,11,0.08)'
                        }}
                      >
                        <UploadCloud size={13} />
                        <span className="hide-mobile">Upload Docs</span>
                        <span className="sr-only-mobile">Upload Docs</span>
                      </button>
                    )}
                    <button className="btn-action-view" aria-label="View comparison" title="View comparison">
                      <Eye size={16} />
                      <span className="hide-mobile">View Comparison</span>
                      <span className="sr-only-mobile">View Comparison</span>
                    </button>
                  </div>
                </div>
                );
              })}
           </div>
          )}
          <LedgerPagination
            totalItems={groupedSalesHistory.length}
            currentPage={currentSalesPage}
            onPageChange={setSalesPage}
            itemLabel="sales records"
          />
            </>
          )}
        </div>
      )}

      {selectedSalesGroup && (
        <SalesRecordModal
          records={selectedSalesGroup.records}
          invoiceNumber={selectedSalesGroup.invoiceNumber}
          onClose={() => { setSelectedSalesGroup(null); setSearchParams({}); }}
          onDecision={handleDecisionClick}
          isProcessing={!!decisionProcessing}
          hasDecision={!!salesGroupDecisions[selectedSalesGroup.invoiceNumber]}
          decisionStatus={salesGroupDecisions[selectedSalesGroup.invoiceNumber]}
        />
      )}

      {PENDING_DOCS_UPLOAD_ENABLED && pendingUploadGroup && (
        <PendingDocsUploadModal
          group={pendingUploadGroup}
          onClose={() => setPendingUploadGroup(null)}
          onUploadSuccess={() => { setPendingUploadGroup(null); fetchSalesHistory(false); }}
        />
      )}

      {selectedAudit && (
        /* Keyed by the audit so each one opens on its own first row. Remounting
           is what resets the stepper — an effect doing it would be a second
           render pass on every open, and would also reset if the key stayed
           the same. */
        <UnifiedAuditModal
          key={selectedAudit.key}
          audit={selectedAudit}
          records={selectedAudit.records}
          onClose={() => setSelectedAudit(null)}
          onDecision={handleDecisionClick}
          processingId={decisionProcessing}
        />
      )}

      {confirmDecision && (
        <div className="modal-overlay animate-fade-in" style={{ zIndex: 9999 }} onClick={() => !decisionProcessing && setConfirmDecision(null)}>
          <div className="card modal-content text-center" style={{ maxWidth: '400px', padding: '2rem' }} onClick={e => e.stopPropagation()}>
             <h3 style={{ marginBottom: '1rem', color: confirmDecision.decision === 'Approve' ? '#10b981' : '#ef4444', fontSize: '1.25rem', fontWeight: 'bold' }}>
               Confirm {confirmDecision.decision}
             </h3>
             <p style={{ marginBottom: '2rem', color: 'var(--text-muted)' }}>
               Are you sure you want to {confirmDecision.decision.toLowerCase()} audit record <strong>REF: {confirmDecision.id}</strong>?
             </p>
             <div className="flex justify-center gap-3">
               <button className="btn btn-outline" onClick={() => setConfirmDecision(null)} disabled={decisionProcessing}>No, Cancel</button>
               <button 
                 className="btn" 
                 style={{ background: confirmDecision.decision === 'Approve' ? '#10b981' : '#ef4444', color: 'white', border: 'none' }}
                 onClick={executeDecision}
                 disabled={decisionProcessing}
               >
                 {decisionProcessing ? 'Sending...' : 'Yes, Proceed'}
               </button>
             </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AuditHistory
