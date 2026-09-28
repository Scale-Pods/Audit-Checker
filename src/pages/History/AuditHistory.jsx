import React, { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText, Filter, CheckCircle, AlertTriangle, Eye, Download, Loader2, Search, Truck, Hash, X, Info, IndianRupee, Activity, ChevronLeft, ChevronRight, Check, Shield, TrendingUp, BarChart3, UploadCloud, FileUp, Mail, FileSpreadsheet, ShoppingCart, ClipboardList, Scale } from 'lucide-react'
import { fetchSalesRecords } from '../../api/sales.js'
import { fetchPurchaseRecords } from '../../api/audits.js'
import { useSyncRefresh } from '../../context/SyncContext'
import './AuditHistory.css'

const AUDITS_WEBHOOK_URL = import.meta.env.VITE_AUDITS_HISTORY_URL || 'https://n8n.srv1010832.hstgr.cloud/webhook/40a6351a-d510-492f-918b-7ec9bae2bd2a'
const SALES_WEBHOOK_URL = 'https://n8n.srv1010832.hstgr.cloud/webhook/10916618-e795-416f-9d0a-6646da9aba06'
const SALES_DECISION_WEBHOOK_URL = 'https://n8n.srv1010832.hstgr.cloud/webhook/0c5dfbd4-db17-4d71-87ab-96fa2fb7369e'
const PENDING_DOCS_UPLOAD_WEBHOOK = 'https://n8n.srv1010832.hstgr.cloud/webhook/9f099219-ec9c-465d-83f4-6a048fa7dc85'
const LEDGERS_PER_PAGE = 15

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

// Known ZV Steels address tokens for fuzzy checking
const BILL_TO_TOKENS = ['zv steels', 'zvsteels', 'zv metal', 'aaacz0915c', 'gupta bhavan', 'masjid', 'carnac bunder', 'masjid bandar', '400009', 'mumbai', 'maharashtra']
const SHIP_TO_TOKENS  = ['zv metal', 'roshan fabricators', 'taloja', '410208', 'bhagwan laxmi', 'zv steels', 'midc', 'maharashtra']

const ADDRESS_FIELDS  = ['Bill_To', 'Ship_To', 'Bill To', 'Ship To', 'Recipient', 'Details of Recipient', 'Consignee']

const fuzzyMatch = (value, tokens) => {
  if (!value) return false;
  // Deep normalization: remove spaces, dots, and convert to lowercase
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normValue = normalize(value);
  return tokens.some(t => {
    const normToken = normalize(t);
    return normValue.includes(normToken);
  });
}

// ── Intelligent Comparison Utilities ─────────────────────────
const normalizeText = (text) => {
  if (!text || text === '—' || text === 'N/A') return '';
  return text.toString().toLowerCase().replace(/[^a-z0-9]/g, '').trim();
};

const normalizeInvoiceNo = (text) => {
  if (!text || text === '—') return '';
  return text.toString()
    .toLowerCase()
    .replace(/^inv[\s\-_:#]*/i, '')
    .replace(/^invoice[\s\-_:#]*/i, '')
    .replace(/[\/\s\-_#,.:]/g, '')
    .trim();
};

const normalizeSupplierName = (text) => {
  if (!text || text === '—') return '';
  let name = text.toString().toLowerCase();
  
  // Expand common abbreviation for JSW Steel Coated Products Limited
  name = name.replace(/jswscpl/g, 'jsw steel coated products');
  
  // Remove common location, administration suffixes, and keywords
  const wordsToRemove = [
    'tarapur', 'works', 'plant', 'depot', 'mumbai', 'khopoli', 'kalmeshwar', 'vasind',
    'pvt', 'ltd', 'private', 'limited', 'co', 'company', 'corp', 'corporation', 'inc', 'incorporated'
  ];
  
  wordsToRemove.forEach(w => {
    name = name.replace(new RegExp('\\b' + w + '\\b', 'g'), '');
    name = name.replace(new RegExp('-?' + w + '-?', 'g'), '');
  });

  return name
    .replace(/[^a-z0-9]/g, '')
    .trim();
};

const normalizeHSN = (text) => {
  if (!text || text === '—') return '';
  return text.toString().replace(/[^0-9]/g, '');
};

const normalizeVehicleNo = (text) => {
  if (!text || text === '—') return '';
  return text.toString().toUpperCase().replace(/\s/g, '');
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

const semanticSimilarity = (a, b) => {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const tokensA = new Set(na.split(/\s+/));
  const tokensB = new Set(nb.split(/\s+/));
  const intersection = new Set([...tokensA].filter(t => tokensB.has(t)));
  const union = new Set([...tokensA, ...tokensB]);
  return intersection.size / union.size;
};

const compareFieldValues = (fieldName, vals, audit) => {
  const docs = ['Invoice', 'E-Way Bill', 'LR Copy', 'GRN'];
  const filledDocs = docs.filter(d => vals[d] && vals[d] !== '—');
  if (filledDocs.length <= 1) return { status: null, reason: 'Single data point — no comparison' };
  const field = fieldName.toLowerCase();

  if (field.includes('bill to') || field.includes('recipient')) {
    const results = filledDocs.map(d => ({ doc: d, match: fuzzyMatch(vals[d], BILL_TO_TOKENS) }));
    const allOk = results.every(r => r.match);
    return { status: allOk ? 'MATCH' : 'MISMATCH', reason: allOk ? 'Bill-to address matches known vendor locations' : 'Bill-to address does not match known vendor locations' };
  }

  if (field.includes('ship to') || field.includes('consignee')) {
    const results = filledDocs.map(d => ({ doc: d, match: fuzzyMatch(vals[d], SHIP_TO_TOKENS) }));
    const allOk = results.every(r => r.match);
    return { status: allOk ? 'MATCH' : 'MISMATCH', reason: allOk ? 'Ship-to address matches known destinations' : 'Ship-to address does not match known destinations' };
  }

  if (field.includes('invoice number')) {
    const normalized = filledDocs.map(d => ({ doc: d, norm: normalizeInvoiceNo(vals[d]) }));
    const unique = new Set(normalized.map(n => n.norm));
    if (unique.size === 1) return { status: 'MATCH', reason: 'Invoice numbers match after normalization' };
    if (unique.size === 2) return { status: 'PARTIAL_MATCH', reason: 'Minor variation in invoice number format' };
    return { status: 'MISMATCH', reason: 'Invoice numbers differ across documents' };
  }

  if (field.includes('supplier name')) {
    const normalized = filledDocs.map(d => ({ doc: d, norm: normalizeSupplierName(vals[d]) }));
    const unique = new Set(normalized.map(n => n.norm));
    if (unique.size === 1) return { status: 'MATCH', reason: 'Supplier name verified across all documents' };
    
    // Fallback: Check if they are all JSW-related entities
    const allContainJSW = normalized.every(n => n.norm.includes('jsw'));
    if (allContainJSW && normalized.length > 0) {
      return { status: 'MATCH', reason: 'Supplier name verified across all documents (JSW Group entity)' };
    }

    if (unique.size === 2) {
      const names = Array.from(unique);
      if (semanticSimilarity(names[0], names[1]) > 0.7) return { status: 'PARTIAL_MATCH', reason: 'Supplier name has minor formatting variation (Ltd/Limited)' };
    }
    return { status: 'MISMATCH', reason: 'Supplier name differs — possible vendor mismatch' };
  }

  if (field.includes('gstin')) {
    const normalized = filledDocs.map(d => ({ doc: d, norm: normalizeText(vals[d]) }));
    const unique = new Set(normalized.map(n => n.norm));
    if (unique.size === 1) return { status: 'MATCH', reason: 'GSTIN verified across documents' };
    return { status: 'CRITICAL', reason: 'GSTIN MISMATCH — possible tax compliance violation' };
  }

  if (field.includes('product')) {
    const normalized = filledDocs.map(d => ({ doc: d, norm: normalizeText(vals[d]) }));
    const unique = new Set(normalized.map(n => n.norm));
    if (unique.size === 1) return { status: 'MATCH', reason: 'Product code matches across documents' };
    if (unique.size === 2) {
      const codes = Array.from(unique);
      if (semanticSimilarity(codes[0], codes[1]) > 0.6) return { status: 'PARTIAL_MATCH', reason: 'Product code has minor spacing/format variation' };
    }
    return { status: 'MISMATCH', reason: 'Product code differs across documents' };
  }

  if (field.includes('description')) {
    let bestSim = 1;
    for (let i = 0; i < filledDocs.length; i++) {
      for (let j = i + 1; j < filledDocs.length; j++) {
        bestSim = Math.min(bestSim, semanticSimilarity(vals[filledDocs[i]], vals[filledDocs[j]]));
      }
    }
    if (bestSim >= 0.8) return { status: 'MATCH', reason: 'Descriptions semantically match' };
    if (bestSim >= 0.4) return { status: 'PARTIAL_MATCH', reason: 'Descriptions partially match — possible OCR variation' };
    return { status: 'MISMATCH', reason: 'Descriptions differ significantly' };
  }

  if (field.includes('hsn')) {
    const normalized = filledDocs.map(d => ({ doc: d, norm: normalizeHSN(vals[d]) }));
    const first4 = new Set(normalized.map(n => n.norm.substring(0, 4)));
    if (first4.size === 1) {
      const first6 = new Set(normalized.map(n => n.norm.substring(0, 6)));
      return first6.size === 1
        ? { status: 'MATCH', reason: 'HSN code fully matches' }
        : { status: 'PARTIAL_MATCH', reason: 'HSN first 4–6 digits match — sub-classification difference' };
    }
    return { status: 'MISMATCH', reason: 'HSN code differs across documents' };
  }

  if (field.includes('batch') || field.includes('coil')) {
    const normalized = filledDocs.map(d => ({ doc: d, norm: normalizeText(vals[d]) }));
    const unique = new Set(normalized.map(n => n.norm));
    if (unique.size === 1) return { status: 'MATCH', reason: 'Batch/coil number matches' };
    return { status: 'MISMATCH', reason: 'Batch/coil number differs' };
  }

  if (field.includes('vehicle')) {
    const normalized = filledDocs.map(d => ({ doc: d, norm: normalizeVehicleNo(vals[d]) }));
    const unique = new Set(normalized.map(n => n.norm));
    if (unique.size === 1) return { status: 'MATCH', reason: 'Vehicle number matches transport records' };
    return { status: 'MISMATCH', reason: 'Vehicle number differs between documents' };
  }

  if (field.includes('weight') || field.includes('quantity')) {
    const numericVals = {};
    filledDocs.forEach(d => {
      const raw = extractNumericValue(vals[d]);
      numericVals[d] = raw !== null ? toKG(raw, vals[d]) : null;
    });
    const valid = Object.entries(numericVals).filter(([, v]) => v !== null);
    if (valid.length <= 1) return { status: null, reason: 'Insufficient data' };
    const invVal = numericVals['Invoice'];
    const lrVal = numericVals['LR Copy'];
    if (invVal && lrVal) {
      const ratio = lrVal / invVal;
      if (ratio > 1.5 && ratio < 2.5) return { status: 'DUPLICATE_LR_CASE', reason: 'LR weight appears duplicated (combined shipment pattern)' };
    }
    const allV = valid.map(([, v]) => v);
    const maxDiff = Math.max(...allV) - Math.min(...allV);
    if (maxDiff <= 250) return { status: 'MATCH', reason: `Weight within 250 KG tolerance (${Math.round(maxDiff)} KG diff)` };
    if (maxDiff <= 500) return { status: 'PARTIAL_MATCH', reason: `Weight difference ${Math.round(maxDiff)} KG — within extended tolerance` };
    return { status: 'MISMATCH', reason: `Weight differs by ${Math.round(maxDiff)} KG — possible discrepancy` };
  }

  if (field.includes('total amount') || field === 'amount') {
    const numericVals = {};
    filledDocs.forEach(d => { numericVals[d] = extractNumericValue(vals[d]); });
    const valid = Object.entries(numericVals).filter(([, v]) => v !== null);
    if (valid.length <= 1) return { status: null, reason: 'Single data point' };
    const allV = valid.map(([, v]) => v);
    const maxDiff = Math.max(...allV) - Math.min(...allV);
    if (maxDiff < 1) return { status: 'MATCH', reason: `Amount matches within ₹1 tolerance (₹${maxDiff.toFixed(2)} diff)` };
    return { status: 'MISMATCH', reason: `Amount differs by ₹${maxDiff.toFixed(2)}` };
  }

  if (field.includes('date')) {
    const normalized = filledDocs.map(d => ({ doc: d, norm: normalizeDate(vals[d]) }));
    const unique = new Set(normalized.map(n => n.norm));
    if (unique.size === 1) return { status: 'MATCH', reason: 'Dates match after normalization' };
    return { status: 'MISMATCH', reason: 'Date values differ across documents' };
  }

  const filled = Object.values(vals).filter(v => v !== '—');
  const normalizedFilled = filled.map(v => v.toString().toLowerCase().replace(/\s+/g, ' ').trim());
  if (new Set(normalizedFilled).size > 1) return { status: 'MISMATCH', reason: 'Values differ across documents' };
  return { status: 'MATCH', reason: 'Values match across documents' };
};

const generateInsights = (comparisons, fieldMap) => {
  const insights = [];
  const matched = Object.values(comparisons).filter(c => c.status === 'MATCH').length;
  const partial = Object.values(comparisons).filter(c => c.status === 'PARTIAL_MATCH').length;
  const mismatched = Object.values(comparisons).filter(c => c.status === 'MISMATCH' || c.status === 'CRITICAL').length;
  const dupLR = Object.values(comparisons).filter(c => c.status === 'DUPLICATE_LR_CASE').length;

  if (matched > partial + mismatched) insights.push('Majority of fields match across all documents — high data integrity.');
  if (partial > 0) insights.push(`${partial} field(s) show partial matches — likely due to formatting or OCR variations.`);
  if (mismatched > 0) insights.push(`${mismatched} field(s) have critical or significant mismatches requiring attention.`);
  if (dupLR > 0) insights.push('LR weight pattern suggests combined shipment entry — common logistics scenario.');

  const supl = fieldMap['Supplier Name'];
  if (supl) {
    const suplDocs = Object.values(supl).filter(v => v !== '—');
    if (new Set(suplDocs.map(s => normalizeSupplierName(s))).size === 1 && suplDocs.length >= 2) {
      insights.push('Invoice, EWay and GRN supplier details align successfully.');
    }
  }

  const veh = fieldMap['Vehicle No'];
  if (veh && veh['E-Way Bill'] !== '—' && veh['LR Copy'] !== '—') {
    if (normalizeVehicleNo(veh['E-Way Bill']) === normalizeVehicleNo(veh['LR Copy'])) {
      insights.push('Vehicle number matches transport records — logistics chain verified.');
    }
  }

  return insights;
};

const UnifiedAuditModal = ({ audit, onClose, onDecision, isProcessing }) => {
  const [view] = useState('universal');
  if (!audit) return null;

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

  // ── Enhanced field parser with GRN support ──
  const fieldMap = {};
  Object.entries(audit).forEach(([key, val]) => {
    const EXCLUDED_KEYS = ['Audit_Result', 'Audit_Intelligence', 'id', 'created_at'];
    if (EXCLUDED_KEYS.some(k => key.toLowerCase().includes(k.toLowerCase()))) return;

    let docType = null;
    let fieldBase = key;

    if (key.match(/[ _]\(Invoice\)$|_Invoice$/i)) { docType = 'Invoice'; fieldBase = key.replace(/[ _]\(Invoice\)$|_Invoice$/i, ''); }
    else if (key.match(/[ _]\(EWay\)$|_EWay$/i)) { docType = 'E-Way Bill'; fieldBase = key.replace(/[ _]\(EWay\)$|_EWay$/i, ''); }
    else if (key.match(/[ _]\(LR\)$|_LR$/i)) { docType = 'LR Copy'; fieldBase = key.replace(/[ _]\(LR\)$|_LR$/i, ''); }
    else if (key.match(/[ _]\(GRN\)$|_GRN$/i)) { docType = 'GRN'; fieldBase = key.replace(/[ _]\(GRN\)$|_GRN$/i, ''); }

    if (docType) {
      const lowKey = fieldBase.toLowerCase();
      if (lowKey.includes('invoice_number') || lowKey.includes('invoice_no')) {
        fieldBase = 'Invoice Number';
      } else if (lowKey.includes('lr_number')) {
        fieldBase = 'LR Number';
      } else if (lowKey.includes('ewb_number') || lowKey.includes('eway_number')) {
        fieldBase = 'E-Way Bill Number';
      } else if (lowKey.includes('gstin')) {
        fieldBase = 'GSTIN';
      } else if (lowKey.includes('batch_code') || lowKey.includes('coil_number') || lowKey.includes('batch_number')) {
        fieldBase = 'Batch / Coil Number';
      } else if (lowKey === 'consigner_name' || lowKey === 'supplier_name' || lowKey === 'consignor_name' ||
                 (lowKey.includes('supplier') && lowKey.includes('name')) ||
                 (lowKey.includes('consign') && lowKey.includes('name'))) {
        fieldBase = 'Supplier Name';
      } else if (lowKey === 'consignee_name' || lowKey === 'ship_to') {
        fieldBase = 'Ship To';
      } else if (lowKey === 'bill_to') {
        fieldBase = 'Bill To';
      } else if (lowKey.includes('product') || lowKey.includes('item_description') || lowKey.includes('item')) {
        fieldBase = 'Product';
      } else if (lowKey.includes('description') || lowKey.includes('desc')) {
        fieldBase = 'Description';
      } else if (lowKey.includes('hsn') || lowKey.includes('sac')) {
        fieldBase = 'HSN';
      } else if (lowKey.includes('vehicle') || lowKey.includes('veh_no')) {
        fieldBase = 'Vehicle No';
      } else if (lowKey.includes('weight') || lowKey.includes('wt')) {
        fieldBase = 'Weight';
      } else if (lowKey.includes('total_amount') || lowKey === 'amount') {
        fieldBase = 'Total Amount';
      } else if (lowKey.includes('quantity') || lowKey.includes('qty')) {
        fieldBase = 'Quantity';
      } else {
        fieldBase = fieldBase.replace(/^(Invoice|EWay|EWB|LR|Supplier|Consigner|Consignee)[_ ]+/i, '');
      }

      fieldBase = fieldBase.replace(/_/g, ' ').trim();
      if (fieldBase.toLowerCase().includes('total amount')) fieldBase = 'Total Amount';
      if (fieldBase.toLowerCase() === 'name' && !lowKey.includes('supplier') && !lowKey.includes('consigner') && !lowKey.includes('consignee')) return;

      if (!fieldMap[fieldBase]) fieldMap[fieldBase] = { Invoice: '—', 'E-Way Bill': '—', 'LR Copy': '—', 'GRN': '—' };
      fieldMap[fieldBase][docType] = val?.toString() || '—';
    }
  });

  const isAddressField = (name) =>
    ADDRESS_FIELDS.some(f => name.toLowerCase().includes(f.toLowerCase().replace(/ /g, '_')) ||
                              name.toLowerCase().includes(f.toLowerCase()));

  const isBillTo = (name) => name.toLowerCase().includes('bill') || name.toLowerCase().includes('recipient');
  const isShipTo = (name) => name.toLowerCase().includes('ship') || name.toLowerCase().includes('consignee');

  const getAddressStatus = (fieldBase, docType, value) => {
    if (value === '—') return null;
    if (isBillTo(fieldBase)) return fuzzyMatch(value, BILL_TO_TOKENS) ? 'ok' : 'fail';
    if (isShipTo(fieldBase)) return fuzzyMatch(value, SHIP_TO_TOKENS) ? 'ok' : 'fail';
    return null;
  };

  // ── Compute all field comparisons ──
  const comparisons = {};
  Object.entries(fieldMap).forEach(([fieldBase, vals]) => {
    comparisons[fieldBase] = compareFieldValues(fieldBase, vals, audit);
  });

  const totalFields = Object.keys(comparisons).length;
  const matchCount = Object.values(comparisons).filter(c => c.status === 'MATCH').length;
  const partialCount = Object.values(comparisons).filter(c => c.status === 'PARTIAL_MATCH').length;
  const mismatchCount = Object.values(comparisons).filter(c => c.status === 'MISMATCH' || c.status === 'CRITICAL').length;
  const webhookScore = parseInt(result?.overall?.final_score);
  const auditScore = !isNaN(webhookScore) ? webhookScore : (totalFields > 0 ? Math.round(((matchCount + partialCount * 0.5) / totalFields) * 100) : 0);
  const overallStatus = result?.overall?.status || (auditScore >= 85 ? 'GOOD MATCH' : auditScore >= 60 ? 'PARTIAL MATCH' : 'HIGH MISMATCH');
  const riskLevel = result?.overall?.status === 'CRITICAL' ? 'HIGH' : mismatchCount > 1 || Object.values(comparisons).some(c => c.status === 'CRITICAL') ? 'HIGH' : mismatchCount > 0 ? 'MEDIUM' : 'LOW';
  const confidence = auditScore >= 85 ? 'HIGH' : auditScore >= 60 ? 'MEDIUM' : 'LOW';

  const insights = generateInsights(comparisons, fieldMap);

  const statusIcon = (status) => {
    switch (status) {
      case 'MATCH': return <Check size={12} />;
      case 'PARTIAL_MATCH': return <AlertTriangle size={12} />;
      case 'MISMATCH': return <X size={12} />;
      case 'CRITICAL': return <AlertTriangle size={12} />;
      case 'DUPLICATE_LR_CASE': return <Truck size={12} />;
      default: return null;
    }
  };

  const statusClass = (status) => {
    switch (status) {
      case 'MATCH': return 'status-match';
      case 'PARTIAL_MATCH': return 'status-partial';
      case 'MISMATCH': return 'status-mismatch';
      case 'CRITICAL': return 'status-critical';
      case 'DUPLICATE_LR_CASE': return 'status-duplicate-lr';
      default: return '';
    }
  };

  const renderCell = (fieldBase, docType, value) => {
    const addr = isAddressField(fieldBase);
    if (docType === 'LR Copy' && addr) return <td key={docType} className="doc-value-cell not-applicable"><span className="na-text">N/A</span></td>;

    if (fieldBase === 'LR Number' && (docType === 'Invoice' || docType === 'E-Way Bill')) {
      return <td key={docType} className="doc-value-cell not-applicable"><span className="na-text">N/A</span></td>;
    }

    if ((fieldBase === 'E-Way Bill Number' || fieldBase === 'Vehicle No') && docType === 'Invoice') {
      return <td key={docType} className="doc-value-cell not-applicable"><span className="na-text">N/A</span></td>;
    }

    if (fieldBase === 'Batch / Coil Number' && docType === 'E-Way Bill') {
      return <td key={docType} className="doc-value-cell not-applicable"><span className="na-text">N/A</span></td>;
    }

    const status = addr ? getAddressStatus(fieldBase, docType, value) : null;
    const comp = comparisons[fieldBase];
    const cellStatus = comp?.status;

    let extraClass = '';
    if (cellStatus && value !== '—') {
      extraClass = statusClass(cellStatus) + '-cell';
    }
    if (status === 'ok')   extraClass = 'addr-ok';
    if (status === 'fail') extraClass = 'addr-fail';

    return (
      <td key={docType} data-label={docType.replace(/_/g, ' ')} className={`doc-value-cell ${extraClass}`}>
        <span className="cell-value">{value}</span>
        {!addr && cellStatus && value !== '—' && (
          <span className={`cell-status-badge ${statusClass(cellStatus)}`} title={comp?.reason || ''}>
            {statusIcon(cellStatus)}
          </span>
        )}
        {addr && status && (
          <span className={`addr-badge ${status}`}>
            {status === 'ok' ? '✓' : '✗'}
          </span>
        )}
        {!addr && cellStatus && value !== '—' && comp?.reason && (
          <div className="cell-tooltip">{comp.reason}</div>
        )}
      </td>
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
                        <div className="tooltip-row"><span>EWB No:</span> <strong>{audit.Vehicle_No_EWay || audit['Vehicle_No_EWay'] || audit['Vehicle No (EWay)'] || '—'}</strong></div>
                        <div className="tooltip-row"><span>LR No:</span> <strong>{audit.Vehicle_No_LR || audit['Vehicle_No_LR'] || audit['Vehicle No (LR)'] || '—'}</strong></div>
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
              {/* ── Audit Score Header ── */}
              <div className="audit-score-header glass-morphism">
                <div className="score-header-left">
                  <div className="audit-score-ring" style={{
                    background: `conic-gradient(${auditScore >= 85 ? '#10b981' : auditScore >= 60 ? '#f59e0b' : '#ef4444'} ${auditScore}%, rgba(255,255,255,0.06) ${auditScore}%)`
                  }}>
                    <span className="audit-score-value">{auditScore}%</span>
                  </div>
                </div>
                <div className="score-header-meta">
                  <div className="score-header-top">
                    <span className={`score-status-badge ${overallStatus === 'GOOD MATCH' || overallStatus === 'GOOD_MATCH' ? 'score-good' : overallStatus === 'PARTIAL MATCH' || overallStatus === 'PARTIAL_MATCH' || overallStatus === 'NEEDS_REVIEW' ? 'score-partial' : 'score-bad'}`}>
                      {overallStatus.replace(/_/g, ' ')}
                    </span>
                    <span className={`risk-badge ${riskLevel === 'LOW' ? 'risk-low' : riskLevel === 'MEDIUM' ? 'risk-medium' : 'risk-high'}`}>
                      {riskLevel} RISK
                    </span>
                    <span className="confidence-badge">AI Confidence: {confidence}</span>
                  </div>
                  <div className="score-header-stats">
                    <span className="stat-chip match-chip"><Check size={11} /> {matchCount} Match</span>
                    <span className="stat-chip partial-chip"><AlertTriangle size={11} /> {partialCount} Partial</span>
                    <span className="stat-chip mismatch-chip"><X size={11} /> {mismatchCount} Issue{mismatchCount !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </div>

              <div className="universal-table-wrapper animate-fade-in">
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th className="field-col" style={{ width: '18%', padding: '0.75rem' }}>Field</th>
                      <th className="doc-col invoice-col" style={{ padding: '0.75rem' }}>📄 Invoice</th>
                      <th className="doc-col eway-col" style={{ padding: '0.75rem' }}>🚛 E-Way Bill</th>
                      <th className="doc-col lr-col" style={{ padding: '0.75rem' }}>📋 LR Copy</th>
                      <th className="doc-col grn-col" style={{ padding: '0.75rem' }}>📦 GRN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(fieldMap).map(([fieldBase, vals]) => {
                      const comp = comparisons[fieldBase];
                      return (
                        <tr key={fieldBase} className={`ledger-row ${comp?.status ? statusClass(comp.status) + '-row' : ''}`}>
                          <td data-label="Field Identity" className="field-name-cell">
                            <span className="field-label-text">{fieldBase.replace(/_/g, ' ')}</span>
                            {comp?.status && (
                              <span className={`row-status-badge ${statusClass(comp.status)}`} title={comp.reason || ''}>
                                {statusIcon(comp.status)}
                                <span className="badge-label">
                                  {comp.status === 'DUPLICATE_LR_CASE' ? 'DUPLICATE LR' : comp.status === 'PARTIAL_MATCH' ? 'PARTIAL' : comp.status}
                                </span>
                              </span>
                            )}
                            {comp?.reason && <div className="row-tooltip">{comp.reason}</div>}
                          </td>
                          {renderCell(fieldBase, 'Invoice', vals['Invoice'])}
                          {renderCell(fieldBase, 'E-Way Bill', vals['E-Way Bill'])}
                          {renderCell(fieldBase, 'LR Copy', vals['LR Copy'])}
                          {renderCell(fieldBase, 'GRN', vals['GRN'])}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* ── Audit Insights Panel ── */}
              {insights.length > 0 && (
                <div className="audit-insights-panel glass-morphism animate-fade-in">
                  <div className="insights-header">
                    <BarChart3 size={14} />
                    <span>Audit Insights</span>
                  </div>
                  <div className="insights-list">
                    {insights.map((insight, i) => (
                      <div key={i} className="insight-item">
                        <span className="insight-bullet" />
                        <span>{insight}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
            <p className="footer-hint">4-way cross-document validation · {totalFields} fields analyzed</p>
            <div className="flex footer-actions">
                <button className="btn btn-outline" onClick={onClose}>Close</button>
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
  { label: 'Gate Pass Number',   invoice: null,                      so: null,                   po: null,                    gp: 'gp_number',            ws: null,                       type: 'text', nowrap: true },
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
  { label: 'Material Description', invoice: null,                      so: null,                   po: null,                    gp: 'gp_material_description', ws: null,                       type: 'text' },
  { label: 'Gate Pass Date',     invoice: null,                      so: null,                   po: null,                    gp: 'gp_date',               ws: null,                       type: 'text' },
  { label: 'Coil Number',        invoice: null,                      so: 'so_coil_number',       po: null,                    gp: 'gp_coil_number',        ws: null,                       type: 'text', nowrap: true },
  { label: 'GSTIN',              invoice: 'inv_gstin',               so: null,                   po: 'po_gstin',              gp: null,                    ws: null,                       type: 'text' },
];

// Group sales records by the main order number (so_number OR so_po_number)
const getSalesGroupKey = (record) =>
  record.so_number || record.so_po_number || record['so_number'] || 'Unknown';

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
  const ta = normalizeNameTokens(a);
  const tb = normalizeNameTokens(b);
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer  = ta.length <= tb.length ? tb : ta;
  // Each token of the shorter must appear in the longer (or be ≥80% similar or max 2 typos)
  const matched = shorter.filter(st =>
    longer.some(lt => {
      if (lt === st) return true;
      if (st.length > 3 && lt.includes(st)) return true;
      if (lt.length > 3 && st.includes(lt)) return true;
      // Allow minor spelling mistakes (max 2 characters diff for words > 4 chars)
      if (st.length > 4 && lt.length > 4) {
         const dist = levenshtein(st, lt);
         return dist <= 2;
      }
      return false;
    })
  );
  return matched.length / shorter.length >= 0.7;
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

// Broker names often carry an honorific suffix (e.g. "Namdev Bhai" where Bhai = brother).
// Match on the first (given) name — if it matches, treat the broker as the same person.
const brokerNameMatch = (a, b) => {
  if (!a || !b) return false;
  const ta = stripHonorifics(normalizeNameTokens(a));
  const tb = stripHonorifics(normalizeNameTokens(b));
  if (ta.length === 0 || tb.length === 0) return false;

  const firstA = ta[0];
  const firstB = tb[0];
  if (firstA === firstB) return true;
  if (firstA.length > 3 && (firstA.includes(firstB) || firstB.includes(firstA))) return true;
  if (firstA.length > 4 && firstB.length > 4 && levenshtein(firstA, firstB) <= 2) return true;

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
};

const MatchBadge = ({ value }) => {
  const b = MATCH_STATUS_BADGE(value);
  const ToneIcon = { positive: CheckCircle, negative: X, warning: AlertTriangle, neutral: Info }[b.tone];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap',
      padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.68rem', fontWeight: 800,
      backgroundColor: b.bg, color: b.text, border: `1px solid ${b.border}`,
      textTransform: 'uppercase', letterSpacing: '0.04em'
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
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap',
      padding: '0.25rem 0.7rem', borderRadius: '50px', fontSize: '0.68rem', fontWeight: 800,
      backgroundColor: b.bg, color: b.text, border: `1px solid ${b.border}`,
      textTransform: 'uppercase', letterSpacing: '0.05em'
    }}>
      <ToneIcon size={11} />
      {b.label}
    </span>
  );
};

const ScoreBadge = ({ value }) => {
  const n = parseAmount(value);
  if (n === null) return <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#94a3b8', fontFamily: 'monospace' }}>—</span>;
  const c = SCORE_COLOR(n);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'baseline', gap: '0.15rem',
      padding: '0.25rem 0.7rem', borderRadius: '8px', fontSize: '0.95rem', fontWeight: 800,
      fontFamily: 'monospace', backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`
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
      padding: '0.6rem 0.75rem', borderRadius: '10px',
      border: '1px solid var(--border)', background: 'rgba(0,0,0,0.015)'
    }}>
      <div style={{
        fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase',
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
      border: '1px solid var(--border)', borderRadius: '10px',
      background: 'rgba(0,0,0,0.015)', overflow: 'hidden'
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.45rem',
        padding: '0.45rem 0.7rem', background: 'rgba(0,0,0,0.02)',
        borderBottom: '1px solid var(--border)'
      }}>
        <span style={{
          display: 'inline-flex', padding: '0.22rem', borderRadius: '6px',
          background: accent.bg, color: accent.color
        }}>
          <PanelIcon size={12} />
        </span>
        <span style={{
          fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase',
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
      fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase',
      letterSpacing: '0.1em', color: 'var(--text-muted)'
    }}>{children}</span>
    {action}
  </div>
);

const MatchStrip = ({ title, items }) => (
  <div style={{
    marginTop: '0.8rem', padding: '0.6rem 0.75rem', borderRadius: '10px',
    border: '1px solid var(--border)', background: 'rgba(0,0,0,0.015)'
  }}>
    <SectionLabel>{title}</SectionLabel>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
      {items.map(item => (
        <div key={item.label} style={{
          display: 'flex', alignItems: 'center', gap: '0.45rem',
          padding: '0.28rem 0.6rem', borderRadius: '8px',
          border: '1px solid var(--border)', background: 'var(--surface)'
        }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)' }}>{item.label}</span>
          <MatchBadge value={item.value} />
        </div>
      ))}
    </div>
  </div>
);

const CheckRow = ({ label, value }) => {
  const b = MATCH_STATUS_BADGE(value);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
      padding: '0.35rem 0.65rem', borderRadius: '8px', border: '1px solid var(--border)',
      background: b.tone === 'neutral' ? 'rgba(0,0,0,0.015)' : b.bg
    }}>
      <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text)' }}>{label}</span>
      <MatchBadge value={value} />
    </div>
  );
};

const FINDING_TONES = {
  critical: { color: '#ef4444', bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.15)' },
  warning:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.15)' },
  missing:  { color: '#94a3b8', bg: 'rgba(100,116,139,0.06)', border: 'rgba(100,116,139,0.15)' },
};

const FindingList = ({ tone, title, items, emptyText, icon }) => {
  const colors = FINDING_TONES[tone] || FINDING_TONES.missing;
  const ToneIcon = icon || AlertTriangle;
  const entries = toList(items);

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <SectionLabel action={(
        <span style={{
          fontSize: '0.6rem', fontWeight: 800, fontFamily: 'monospace',
          padding: '0.1rem 0.4rem', borderRadius: '4px',
          background: colors.bg, color: colors.color, border: `1px solid ${colors.border}`
        }}>{entries.length}</span>
      )}>{title}</SectionLabel>

      {entries.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {entries.map((entry, index) => (
            <div key={index} style={{
              display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
              padding: '0.55rem 0.75rem', borderRadius: '8px',
              backgroundColor: colors.bg, border: `1px solid ${colors.border}`,
              fontSize: '0.79rem', color: tone === 'critical' ? '#ef4444' : 'var(--text)', fontWeight: 600,
              lineHeight: 1.45
            }}>
              <ToneIcon size={14} style={{ flexShrink: 0, marginTop: '1px', color: colors.color }} />
              <span>{entry}</span>
            </div>
          ))}
        </div>
      ) : (
        emptyText && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.55rem 0.75rem', borderRadius: '8px',
            backgroundColor: colors.bg, border: `1px solid ${colors.border}`,
            fontSize: '0.79rem', fontWeight: 600, color: colors.color
          }}>
            <ToneIcon size={14} style={{ flexShrink: 0 }} />
            <span>{emptyText}</span>
          </div>
        )
      )}
    </div>
  );
};

const SummaryBlock = ({ summary }) => {
  if (!hasSourceValue(summary)) return null;
  const text = typeof summary === 'string' ? summary.trim() : findingText(summary);
  if (!text) return null;

  return (
    <div style={{
      padding: '0.8rem 0.9rem', borderRadius: '10px',
      backgroundColor: 'rgba(37,99,235,0.04)', border: '1px solid rgba(37,99,235,0.1)',
      display: 'flex', gap: '0.6rem', alignItems: 'flex-start'
    }}>
      <Info size={16} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '2px' }} />
      <div>
        <div style={{
          fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase',
          letterSpacing: '0.08em', color: 'var(--primary)', marginBottom: '0.25rem'
        }}>Audit Summary</div>
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text)', lineHeight: 1.55, fontWeight: 500, whiteSpace: 'pre-line' }}>{text}</p>
      </div>
    </div>
  );
};

// Audit score / status pair reused at the top of the match and findings sections.
const AuditStatusStrip = ({ score, status }) => (
  <div style={{
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '1.5rem',
    padding: '0.6rem 0.85rem', borderRadius: '10px',
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

const isRecordQuickEntry = (record) =>
  !Object.keys(record).some(k =>
    (k.startsWith('inv_') || k.startsWith('gp_') || k.startsWith('ws_')) &&
    record[k] !== null && record[k] !== undefined && record[k] !== ''
  );

// Detect records that are missing Invoice or Weightslip uploads
// (weightslip upload is allowed whenever the invoice is present)
const isRecordPendingDocuments = (record) => {
  const hasPO = record.po_number && record.po_number !== '';
  const hasSO = record.so_number && record.so_number !== '';
  const hasGP = record.gp_number && record.gp_number !== '';
  // Check if invoice fields are empty
  const hasInvoice = Object.keys(record).some(k =>
    k.startsWith('inv_') && record[k] !== null && record[k] !== undefined && record[k] !== ''
  );
  // Check if weightslip fields are empty
  const hasWS = Object.keys(record).some(k =>
    k.startsWith('ws_') && record[k] !== null && record[k] !== undefined && record[k] !== ''
  );
  // If invoice is already present, the weightslip can still be uploaded,
  // so flag it even when PO/SO/GP numbers aren't all extracted.
  if ((!hasPO || !hasSO || !hasGP) && !hasInvoice) return { pending: false, missingInvoice: false, missingWS: false };
  const pending = !hasInvoice || !hasWS;
  return { pending, missingInvoice: !hasInvoice, missingWS: !hasWS };
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
          <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
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
            borderRadius: '8px',
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
              borderRadius: '6px',
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
              borderRadius: '8px',
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
  const [invoiceFile, setInvoiceFile] = useState(null);
  const [weightslipFile, setWeightslipFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);

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

  const handleFile = async (e, setter) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type === 'application/pdf') {
      try {
        const img = await convertPdfToImg(file);
        setter(img);
      } catch { setter(file); }
    } else {
      setter(file);
    }
  };

  const handleSubmit = async () => {
    if (!invoiceFile && !weightslipFile) {
      setUploadError('Please select at least one file (Invoice or Weightslip) to upload.');
      return;
    }
    setIsUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      // Attach SO/PO/GP context
      const soNum = record.so_number || record.inv_order_number || record.order_number || record["Invoice Number"] || group.invoiceNumber || '';
      formData.append('so_number', soNum);
      formData.append('so_no', soNum);
      formData.append('SO Number', soNum);
      formData.append('po_number', record.po_number || '');
      formData.append('gp_number', record.gp_number || '');
      formData.append('record_id', record.id?.toString() || '');
      if (invoiceFile) {
        const ext = invoiceFile.name.includes('.') ? invoiceFile.name.split('.').pop() : 'png';
        const renamed = new File([invoiceFile], `Invoice.${ext}`, { type: invoiceFile.type });
        formData.append('Invoice', renamed, renamed.name);
      }
      if (weightslipFile) {
        const ext = weightslipFile.includes?.('.') ? weightslipFile.name.split('.').pop() : 'png';
        const renamed = new File([weightslipFile], `Weightslip.${ext}`, { type: weightslipFile.type });
        formData.append('Weightslip', renamed, renamed.name);
      }
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
              <div style={{ padding: '0.6rem', borderRadius: '10px', background: 'rgba(245,158,11,0.12)', color: '#f59e0b', display: 'flex' }}>
                <FileUp size={18} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--text)' }}>Upload Pending Documents</h3>
                <p style={{ margin: '0.15rem 0 0', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  SO: {record.so_number || group.invoiceNumber || '—'} · PO: {record.po_number || '—'} · GP: {record.gp_number || '—'}
                </p>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '4px' }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Missing doc info badges */}
        <div style={{ padding: '1rem 1.5rem 0' }}>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.3rem 0.75rem', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700,
              background: pendingInfo.missingInvoice ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
              color: pendingInfo.missingInvoice ? '#ef4444' : '#10b981',
              border: `1px solid ${pendingInfo.missingInvoice ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`
            }}>
              {pendingInfo.missingInvoice ? <AlertTriangle size={11} /> : <CheckCircle size={11} />}
              Invoice {pendingInfo.missingInvoice ? '— Pending' : '— Present'}
            </span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.3rem 0.75rem', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700,
              background: pendingInfo.missingWS ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
              color: pendingInfo.missingWS ? '#ef4444' : '#10b981',
              border: `1px solid ${pendingInfo.missingWS ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`
            }}>
              {pendingInfo.missingWS ? <AlertTriangle size={11} /> : <CheckCircle size={11} />}
              Weightslip {pendingInfo.missingWS ? '— Pending' : '— Present'}
            </span>
          </div>
        </div>

        {/* Upload form */}
        <div style={{ padding: '0 1.5rem 1.5rem' }}>
          <SingleFilePicker
            label="Invoice"
            file={invoiceFile}
            isPending={pendingInfo.missingInvoice}
            onSelectFile={(e) => handleFile(e, setInvoiceFile)}
          />

          <SingleFilePicker
            label="Weightslip"
            file={weightslipFile}
            isPending={pendingInfo.missingWS}
            onSelectFile={(e) => handleFile(e, setWeightslipFile)}
          />

          {uploadError && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem',
              borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
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
  const [expandedSections, setExpandedSections] = useState({ 'Document Comparison Matrix': true });

  if (!records || records.length === 0) return null;

  const totalItems = records.length;
  const hasMultiple = totalItems > 1;
  const record = records[currentIndex];
  const I = record?.intelligence || {};

  const toggleSection = (key) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  const v = (key) => fmt(record[key]);

  // Match/audit fields live under `intelligence`, but a record can also carry
  // them at the top level — read both so no check silently reads as unchecked.
  const check = (key) => (I[key] !== undefined && I[key] !== null && I[key] !== '' ? I[key] : record[key]);

  const hasDocData = (prefix) =>
    Object.keys(record).some(k => k.startsWith(prefix) && record[k] !== null && record[k] !== undefined && record[k] !== '');

  const hasInvoiceData = hasDocData('inv_');
  const hasGPData = hasDocData('gp_');
  const hasWSData = hasDocData('ws_');
  const isQuickEntry = !hasInvoiceData && !hasGPData && !hasWSData;

  const SectionHeader = ({ title, defaultOpen = true }) => (
    <div
      onClick={() => toggleSection(title)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.85rem 1.25rem', cursor: 'pointer', userSelect: 'none',
        borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.02)'
      }}
    >
      <h3 style={{ margin: 0, fontSize: '0.8rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text)' }}>{title}</h3>
      <ChevronRight size={16} style={{ transform: expandedSections[title] ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', color: 'var(--text-muted)' }} />
    </div>
  );

  const Badge = ({ value, green, yellow, red }) => {
    const score = value !== null && value !== undefined && value !== '' ? Number(value) : null;
    if (score === null) return <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b' }}>—</span>;
    let colors;
    if (green && score >= green) colors = { bg: 'rgba(16,185,129,0.12)', text: '#10b981' };
    else if (yellow && score >= yellow) colors = { bg: 'rgba(245,158,11,0.12)', text: '#eab308' };
    else if (red) colors = { bg: 'rgba(239,68,68,0.12)', text: '#ef4444' };
    else colors = { bg: 'rgba(100,116,139,0.08)', text: '#64748b' };
    return <span style={{ padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 800, backgroundColor: colors.bg, color: colors.text }}>{score}</span>;
  };

  const CollapseSection = ({ title, children }) => (
    <div style={{ border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden', marginBottom: '1rem', background: 'var(--surface)' }}>
      <SectionHeader title={title} />
      {expandedSections[title] && <div style={{ padding: '1rem 1.25rem' }}>{children}</div>}
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

  // True when the Document Comparison Matrix finds an actual field conflict
  // (mirrors the per-row mismatch detection used in Section 1).
  const hasMatrixMismatch = SALES_COMPARE_FIELDS
    .filter(f => !f.conditional || getCellVal(f, f.conditional))
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
  { label: 'PO',              key: 'po_match' },
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

  const score = I.audit_score !== undefined ? Number(I.audit_score) : null;

  const sc = SCORE_COLOR(score);

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal-content animate-slide-up" onClick={e => e.stopPropagation()}
        style={{ maxWidth: '1100px', width: '95%', borderRadius: '16px', padding: 0, overflow: 'hidden' }}
      >
        {/* ── Header ── */}
        <div style={{
          padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)',
          background: 'var(--surface)'
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FileText size={20} style={{ color: 'var(--primary)' }} />
                Sales Comparison Ledger
                {isQuickEntry && (
                  <span style={{
                    fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase',
                    letterSpacing: '0.08em', padding: '0.2rem 0.6rem', borderRadius: '6px',
                    background: 'rgba(245,158,11,0.12)', color: '#f59e0b',
                    border: '1px solid rgba(245,158,11,0.25)', verticalAlign: 'middle'
                  }}>
                    Quick Entry
                  </span>
                )}
              </h2>
              {hasMultiple && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  Item {currentIndex + 1} of {totalItems}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              {hasMultiple && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <button
                    onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                    disabled={currentIndex === 0}
                    style={{ ...navBtnStyle, opacity: currentIndex === 0 ? 0.4 : 1 }}
                  >
                    <ChevronLeft size={16} /> Prev
                  </button>
                  <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                    {records.map((_, i) => (
                      <span
                        key={i}
                        onClick={() => setCurrentIndex(i)}
                        style={{
                          width: '8px', height: '8px', borderRadius: '50%', cursor: 'pointer',
                          background: i === currentIndex ? 'var(--primary)' : 'var(--border)',
                          transition: 'all 0.2s'
                        }}
                      />
                    ))}
                  </div>
                  <button
                    onClick={() => setCurrentIndex(Math.min(totalItems - 1, currentIndex + 1))}
                    disabled={currentIndex === totalItems - 1}
                    style={{ ...navBtnStyle, opacity: currentIndex === totalItems - 1 ? 0.4 : 1 }}
                  >
                    Next <ChevronRight size={16} />
                  </button>
                </div>
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
            padding: '0.65rem 0.85rem', background: 'rgba(0,0,0,0.02)', borderRadius: '8px',
            fontSize: '0.75rem', alignItems: 'center'
          }}>
            {[
              { label: 'Invoice #', value: invoiceNumber || v('inv_order_number') },
              { label: 'SO #', value: v('so_number') },
              { label: 'PO #', value: v('po_number') },
              { label: 'GP #', value: v('gp_number') },
              { label: 'WS #', value: v('ws_number') },
            ].map((item, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: '0.65rem', letterSpacing: '0.05em' }}>{item.label}</span>
                <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: '0.8rem' }}>{item.value || '—'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Scrollable Body ── */}
        <div style={{ padding: '1.25rem 1.5rem', maxHeight: '70vh', overflowY: 'auto' }}>
          
          {/* ─── Section 1: Document Comparison Matrix ─── */}
          <CollapseSection title="Document Comparison Matrix">
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem',
                border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden'
              }}>
                <thead>
                  <tr style={{ background: 'rgba(0,0,0,0.03)' }}>
                    <th style={thStyle}>Field</th>
                    {hasInvoiceData && <th style={{ ...thStyle, textAlign: 'center' }}>Invoice</th>}
                    <th style={{ ...thStyle, textAlign: 'center' }}>SO</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>PO</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Gate Pass</th>
                    {hasWSData && <th style={{ ...thStyle, textAlign: 'center' }}>Weight Slip</th>}
                  </tr>
                </thead>
                <tbody>
                  {SALES_COMPARE_FIELDS
                    .filter(f => !f.conditional || getCellVal(f, f.conditional))
                    .map((field) => {
                    const { label, type, nowrap } = field;
                    const iv = getCellVal(field, 'invoice');
                    const sv = getCellVal(field, 'so');
                    const pv = getCellVal(field, 'po');
                    const gv = getCellVal(field, 'gp');
                    const wv = getCellVal(field, 'ws');
                    const rawVals = [iv, sv, pv, gv, wv];
                    const allVals = rawVals.filter(Boolean);

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
                        {hasInvoiceData && <td style={{ ...tdStyle, textAlign: 'center', background: getCellBg(iv, 0) }}><DocBadge val={formatDocVal(field, 'invoice', iv)} nowrap={nowrap} align="center" color={getCellColor(iv, 0)} /></td>}
                        <td style={{ ...tdStyle, textAlign: 'center', background: getCellBg(sv, 1) }}><DocBadge val={formatDocVal(field, 'so', sv)} nowrap={nowrap} align="center" color={getCellColor(sv, 1)} /></td>
                        <td style={{ ...tdStyle, textAlign: 'center', background: getCellBg(pv, 2) }}><DocBadge val={formatDocVal(field, 'po', pv)} nowrap={nowrap} align="center" color={getCellColor(pv, 2)} /></td>
                        <td style={{ ...tdStyle, textAlign: 'center', background: getCellBg(gv, 3) }}><DocBadge val={formatDocVal(field, 'gp', gv)} nowrap={nowrap} align="center" color={getCellColor(gv, 3)} /></td>
                        {hasWSData && <td style={{ ...tdStyle, textAlign: 'center', background: getCellBg(wv, 4) }}><DocBadge val={formatWsCell(field, wv)} nowrap={nowrap} align="center" color={getCellColor(wv, 4)} /></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CollapseSection>

          {/* ─── Section 2: Estimated Amount ─── */}
          <CollapseSection title="Estimated Amount">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
              <div style={{
                display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem 1.25rem',
                padding: '0.5rem 0.75rem', borderRadius: '8px',
                border: '1px solid var(--border)', background: 'rgba(0,0,0,0.02)'
              }}>
                <span style={{
                  fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase',
                  letterSpacing: '0.1em', color: 'var(--text-muted)'
                }}>Invoice Number</span>
                <span style={{
                  fontFamily: 'monospace', fontSize: '0.88rem', fontWeight: 800,
                  color: showText(record.inv_number) === '—' ? '#94a3b8' : 'var(--text)'
                }}>{showText(record.inv_number)}</span>
              </div>

              <div>
                <SectionLabel>Amounts on Record</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.6rem' }}>
                  <StatCard label="Taxable Amount" value={showMoney(record.inv_taxable_value)} />
                  <StatCard label="Final Invoice Amount" value={showMoney(record.inv_final_amount)} />
                  <StatCard label="PO Amount" value={showMoney(record.po_total_amount)} />
                </div>
              </div>

              <div>
                <SectionLabel action={<MatchBadge value={check('rate_match')} />}>Rate Comparison</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.6rem' }}>
                  <StatCard label="SO Rate" value={showRate(record.so_rate)} />
                  <StatCard label="PO Rate" value={showRate(record.po_rate)} />
                  <StatCard label="Invoice Rate" value={showRate(record.inv_rate)} />
                </div>
              </div>
            </div>
          </CollapseSection>

          {/* ─── Section 3: Financial Summary ─── */}
          <CollapseSection title="Financial Summary">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.6rem' }}>
              <StatCard label="Invoice Taxable Value" value={showMoney(record.inv_taxable_value)} />
              <StatCard label="Invoice Final Amount" value={showMoney(record.inv_final_amount)} />
              <StatCard label="Invoice CGST" value={showMoney(record.inv_cgst_amount)} />
              <StatCard label="Invoice SGST" value={showMoney(record.inv_sgst_amount)} />
              <StatCard label="Invoice IGST" value={showMoney(record.inv_igst_amount)} />
              <StatCard label="PO Rate" value={showRate(record.po_rate)} />
              <StatCard label="Invoice Rate" value={showRate(record.inv_rate)} />
              <StatCard label="SO Rate" value={showRate(record.so_rate)} />
              <StatCard label="PO Total Amount" value={showMoney(record.po_total_amount)} />
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

          {/* ─── Section 4: Material Information ─── */}
          <CollapseSection title="Material Information">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(255px, 1fr))', gap: '0.7rem' }}>
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
              <DocPanel
                kind="invoice"
                title="Invoice"
                rows={[
                  { label: 'Description', value: showText(record.inv_notes) },
                  { label: 'Dimensions (T × W × L)', value: showDimensions(record.inv_thickness, record.inv_width, record.inv_length) },
                  { label: 'Quantity', value: showQuantity(record.inv_quantity, record.inv_unit) },
                ]}
              />
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

          {/* ─── Section 5: Logistics ─── */}
          <CollapseSection title="Logistics">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(255px, 1fr))', gap: '0.7rem' }}>
              <DocPanel
                kind="invoice"
                title="Invoice · Dispatch"
                rows={[
                  { label: 'Vehicle', value: showText(record.inv_vehicle_number) },
                  { label: 'Weight Slip Number', value: showText(record.inv_weight_slip_number) },
                  { label: 'Consignee', value: showText(record.inv_consignee_name) },
                ]}
              />
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

          {/* ─── Section 6: Match Results ─── */}
          <CollapseSection title="Match Results">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <AuditStatusStrip score={check('audit_score')} status={check('audit_status')} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '0.4rem' }}>
                {MATCH_RESULT_CHECKS.map(item => (
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
                emptyText="All expected documents are available."
                icon={Info}
              />

              <SummaryBlock summary={I.audit_summary} />

              {hasMatrixMismatch && !toList(I.critical_mismatches).length && !toList(I.warnings).length && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.7rem 0.85rem',
                  borderRadius: '8px', backgroundColor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)',
                  color: '#ef4444', fontSize: '0.82rem', fontWeight: 600
                }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                  <span>Field mismatch detected in the document comparison matrix.</span>
                </div>
              )}

              {!hasMatrixMismatch && !toList(I.critical_mismatches).length && !toList(I.warnings).length && !toList(I.missing_documents).length && !hasSourceValue(I.audit_summary) && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 0.85rem',
                  borderRadius: '8px', backgroundColor: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)',
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
        <div style={{
          padding: '1rem 1.5rem', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem',
          background: 'var(--surface)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>Overall Score</span>
            <Badge value={score} green={90} yellow={75} red={0} />
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            <button className="btn btn-outline" onClick={onClose} style={{ fontSize: '0.8rem', padding: '0.5rem 1.25rem' }}>Close</button>
            {hasDecision ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 700,
                background: decisionStatus === 'Approve' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                color: decisionStatus === 'Approve' ? '#10b981' : '#ef4444',
                border: `1px solid ${decisionStatus === 'Approve' ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`
              }}>
                {decisionStatus === 'Approve' ? <CheckCircle size={14} /> : <X size={14} />}
                {decisionStatus === 'Approve' ? 'Approved' : 'Rejected'}
              </span>
            ) : onDecision && (
              <>
                <button className="btn btn-reject" onClick={() => onDecision(record.id, 'Reject')} disabled={isProcessing}
                  style={{ fontSize: '0.8rem', padding: '0.5rem 1.25rem' }}>
                  Reject Match
                </button>
                <button className="btn btn-approve" onClick={() => onDecision(record.id, 'Approve')} disabled={isProcessing}
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

const navBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
  padding: '0.4rem 0.85rem', borderRadius: '8px', border: '1px solid var(--border)',
  background: 'var(--surface)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
  color: 'var(--text)'
};

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

  const handleSalesDecision = async (id, decision) => {
    setDecisionProcessing(id);

    // Optimistic update: immediately mark all records with same invoice as decided
    setSalesHistory(prev => {
      let targetInvoice = null;
      const record = prev.find(r => r.id === id);
      if (record) {
        targetInvoice = getSalesGroupKey(record);
      }
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
      const response = await fetch(SALES_DECISION_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision })
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

  const fetchSalesHistory = async (showLoading = true) => {
    if (showLoading) setIsSalesLoading(true)
    setSalesError(null)
    try {
      const data = await fetchSalesRecords();
      const salesData = normalizeArray(data);
      
      // Transform each record: nest intelligence/match fields under `intelligence`
      const transformed = salesData.map(transformSalesRecord);
      
      // Deduplicate by ID to handle potential backend/API duplicates
      const uniqueSales = Array.from(
        new Map(transformed.map(item => [item.id || JSON.stringify(item), item])).values()
      );
      
      setSalesHistory(uniqueSales);
    } catch (err) {
      console.error('Sales History Fetch Error:', err)
      setSalesError(`Could not load sales records. ${err.message}`)
      setSalesHistory([])
    } finally {
      setIsSalesLoading(false)
    }
  }

  useEffect(() => {
    fetchHistory()
  }, [])

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
    const filtered = history.filter(item => 
      isWithinDateFilter(item.created_at, dateFilter, customDateRange) &&
      ((item.Invoice_Number_Invoice?.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.Supplier_Name_Invoice?.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.Vehicle_No_Eway?.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.id?.toString().includes(searchTerm)))
    );
    return [...filtered].sort((a, b) => {
      const da = new Date(a.created_at || 0).getTime();
      const db = new Date(b.created_at || 0).getTime();
      return sortOrder === 'latest' ? db - da : da - db;
    });
  }, [history, searchTerm, sortOrder, dateFilter, customDateRange])

  const filteredSalesHistory = useMemo(() => {
    const term = searchTerm.toLowerCase();
    let result = salesHistory;
    if (dateFilter !== 'all') {
      result = salesHistory.filter(item => isWithinDateFilter(item.created_at, dateFilter, customDateRange));
    }
    if (term) {
      result = result.filter(item =>
        Object.values(item).some(v => v?.toString().toLowerCase().includes(term))
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
    groups_arr.sort((a, b) => {
      const da = new Date(a.latestDate || 0).getTime();
      const db = new Date(b.latestDate || 0).getTime();
      return sortOrder === 'latest' ? db - da : da - db;
    });
    return groups_arr;
  }, [filteredSalesHistory, sortOrder])

  useEffect(() => {
    setPurchasePage(1)
    setSalesPage(1)
  }, [activeSide, searchTerm, sortOrder, dateFilter, customDateRange])

  useEffect(() => {
    setPurchasePage(page => Math.max(1, Math.min(page, Math.ceil(filteredHistory.length / LEDGERS_PER_PAGE))))
  }, [filteredHistory.length])

  useEffect(() => {
    setSalesPage(page => Math.max(1, Math.min(page, Math.ceil(groupedSalesHistory.length / LEDGERS_PER_PAGE))))
  }, [groupedSalesHistory.length])

  const purchaseTotalPages = Math.max(1, Math.ceil(filteredHistory.length / LEDGERS_PER_PAGE))
  const salesTotalPages = Math.max(1, Math.ceil(groupedSalesHistory.length / LEDGERS_PER_PAGE))
  const currentPurchasePage = Math.min(Math.max(purchasePage, 1), purchaseTotalPages)
  const currentSalesPage = Math.min(Math.max(salesPage, 1), salesTotalPages)
  const paginatedHistory = filteredHistory.slice((currentPurchasePage - 1) * LEDGERS_PER_PAGE, currentPurchasePage * LEDGERS_PER_PAGE)
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
        <Loader2 className="animate-spin text-primary" size={40} />
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
              className={`side-toggle-btn ${activeSide === 'purchase' ? 'active-purchase' : ''}`}
              onClick={() => handleSideToggle('purchase')}
            >
              🛒 Purchase
            </button>
            <button
              className={`side-toggle-btn ${activeSide === 'sales' ? 'active-sales' : ''}`}
              onClick={() => handleSideToggle('sales')}
            >
              💰 Sales
            </button>
          </div>
          
          <div className="search-bar-container">
            <div className="date-filter-wrap">
              <Filter size={14} className="text-muted date-filter-icon" />
              <select 
                className="input-search date-filter-select" 
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                title="Filter by date"
              >
                {DATE_FILTERS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
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
            <div className="search-bar">
              <Search size={16} className="text-muted search-icon-inner" />
              <input 
                type="text" 
                placeholder={activeSide === 'purchase' ? 'Search records...' : 'Search sales...'}
                className="input-search" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button 
              className="btn btn-outline btn-sm ledger-sort-btn"
              onClick={() => setSortOrder(sortOrder === 'latest' ? 'oldest' : 'latest')}
              title={`Sort: ${sortOrder === 'latest' ? 'Newest first' : 'Oldest first'}`}
            >
              <span>{sortOrder === 'latest' ? '↓' : '↑'}</span>
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
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Audit Identity</th>
                  <th>Supplier / Logistics Asset</th>
                  <th>Reference Tracking</th>
                  <th>Operational Metrics</th>
                  <th>Time of Audit</th>
                  <th>Integrity Status</th>
                  <th className="text-right">Intelligence Trace</th>
                </tr>
              </thead>
              <tbody>
                {paginatedHistory.map((record) => {
                  const result = parseAuditResult(record.Audit_Result);
                  const score = result?.overall?.final_score || 'N/A';
                  const finalDecision = (record.Result === 'Approve' || record.Result === 'Reject') ? record.Result :
                                        (record.Status === 'Approve' || record.Status === 'Reject') ? record.Status : null;
                  const status = finalDecision || result?.overall?.status || record.Result || record.Status;
                  const rowBg = finalDecision === 'Approve' ? 'rgba(16, 185, 129, 0.2)' :
                                finalDecision === 'Reject' ? 'rgba(239, 68, 68, 0.2)' : undefined;
                  return (
                    <tr key={record.id} onClick={() => setSelectedAudit(record)} style={{ cursor: 'pointer', backgroundColor: rowBg }} className="audit-row">
                      <td data-label="Audit Identity" className="font-bold text-primary">
                        <div className="flex flex-col">
                          <span>{record.Invoice_Number_Invoice || 'N/A'}</span>
                          <span className="text-[10px] text-muted opacity-60">REF: {record.id}</span>
                        </div>
                      </td>
                      <td data-label="Supplier / Logistics Asset">
                        <div className="flex flex-col">
                          <span className="font-semibold text-gray-800">{record.Supplier_Name_Invoice || 'Unknown'}</span>
                          <span className="text-xs text-muted flex items-center gap-1"><Truck size={10}/> {record.Vehicle_No_Eway || 'NO_VEHICLE'}</span>
                        </div>
                      </td>
                      <td data-label="Reference Tracking">
                        <div className="flex flex-col text-xs">
                          <span className="flex items-center gap-1"><Hash size={10}/> BATCH: {record.Batch_Code_Invoice || 'N/A'}</span>
                          <span className="text-muted font-mono">EWB: {record.EWB_Number_EWay || 'NONE'}</span>
                        </div>
                      </td>
                      <td data-label="Operational Metrics" className="text-muted font-medium">
                        <span className="text-primary font-bold">₹{(parseFloat(record.Total_Amount_Invoice) / 100000).toFixed(2)} L</span>
                        <br/>
                        <span className="text-[10px] uppercase tracking-tighter">Gross (in Lakhs)</span>
                      </td>
                      <td data-label="Time of Audit" className="text-muted text-xs font-semibold">
                        {new Date(record.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </td>
                      <td data-label="Integrity Status">
                        <span
                          className={`badge-status ${status?.toLowerCase().replace(/_/g, '')}`}
                          style={
                            status === 'Approve' ? { background: '#10b981', color: 'white', border: '1px solid #10b981' } :
                            status === 'Reject' ? { background: '#ef4444', color: 'white', border: '1px solid #ef4444' } : {}
                          }
                        >
                          {status === 'GOOD_MATCH' || status === 'Completed' || status === 'Approve' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                          {(status?.replace(/_/g, ' ') || 'Pending').toUpperCase()}
                        </span>
                      </td>
                      <td data-label="Trace" className="text-right">
                        <div className="flex items-center justify-end">
                          <div className="unified-trace-btn" onClick={(e) => {
                            e.stopPropagation();
                            setSelectedAudit(record);
                          }}>
                            <div className="trace-score" style={{
                              color: score === 'N/A' ? 'var(--text-muted)' : (parseInt(score) > 80 ? 'var(--success)' : (parseInt(score) > 40 ? 'var(--warning)' : 'var(--error)'))
                            }}>
                              {score}{score !== 'N/A' && !score.toString().includes('%') && '%'}
                            </div>
                            <div className="trace-action">
                              <Eye size={12} />
                              <span>LEDGER</span>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <LedgerPagination
            totalItems={filteredHistory.length}
            currentPage={currentPurchasePage}
            onPageChange={setPurchasePage}
            itemLabel="purchase audit records"
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
              <Loader2 className="animate-spin text-primary" size={36} />
              <p className="text-muted font-bold tracking-widest uppercase text-xs">Fetching Sales Records...</p>
            </div>
          ) : filteredSalesHistory.length === 0 ? (
            <div className="empty-state">
              <AlertTriangle size={40} className="empty-icon" />
              <p>{salesError || 'No sales records found.'}</p>
            </div>
          ) : (
            <>
          <div className="sales-records-list animate-fade-in">
              {paginatedSalesHistory.map((group, idx) => {
                const groupDecision = salesGroupDecisions[group.invoiceNumber];
                const isQuickEntry = group.records.every(isRecordQuickEntry);
                // Check if any record in the group has pending documents
                const pendingDocStatus = group.records.reduce((acc, r) => {
                  const s = isRecordPendingDocuments(r);
                  return {
                    pending: acc.pending || s.pending,
                    missingInvoice: acc.missingInvoice || s.missingInvoice,
                    missingWS: acc.missingWS || s.missingWS,
                  };
                }, { pending: false, missingInvoice: false, missingWS: false });
                const hasPendingDocs = pendingDocStatus.pending;
                const cardBg = groupDecision === 'Approve' ? 'rgba(16, 185, 129, 0.12)' :
                               groupDecision === 'Reject' ? 'rgba(239, 68, 68, 0.12)' :
                               hasPendingDocs ? 'rgba(245,158,11,0.06)' : '';
                return (
                <div 
                  key={group.invoiceNumber || idx} 
                  className="sales-record-card"
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
                      <h3 className="sales-order-id">{group.invoiceNumber}</h3>
                      {group.records.length > 1 && (
                        <span className="item-count-badge">{group.records.length} items</span>
                      )}
                      {isQuickEntry && (
                        <span className="quick-entry-badge">Quick Entry</span>
                      )}
                      {hasPendingDocs && !groupDecision && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                          padding: '0.2rem 0.6rem', borderRadius: '5px', fontSize: '0.65rem', fontWeight: 800,
                          background: 'rgba(245,158,11,0.15)', color: '#f59e0b',
                          border: '1px solid rgba(245,158,11,0.3)', textTransform: 'uppercase', letterSpacing: '0.05em'
                        }}>
                          <AlertTriangle size={10} />
                          {pendingDocStatus.missingInvoice && pendingDocStatus.missingWS
                            ? 'Invoice & Weightslip Pending'
                            : pendingDocStatus.missingInvoice
                            ? 'Invoice Pending'
                            : 'Weightslip Pending'}
                        </span>
                      )}
                    </div>
                    <div className="sales-meta">
                      <span className="sales-party">{group.partyName}</span>
                      <span className="sales-dot">•</span>
                      <span className="sales-date">
                        {group.latestDate ? new Date(group.latestDate).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}
                      </span>
                    </div>
                  </div>
                  <div className="sales-record-action">
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
                      </button>
                    )}
                    <button className="btn-action-view">
                      <Eye size={16} />
                      <span className="hide-mobile">View Comparison</span>
                    </button>
                  </div>
                </div>
                );
              })}
           </div>
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

      {pendingUploadGroup && (
        <PendingDocsUploadModal
          group={pendingUploadGroup}
          onClose={() => setPendingUploadGroup(null)}
          onUploadSuccess={() => { setPendingUploadGroup(null); fetchSalesHistory(false); }}
        />
      )}

      {selectedAudit && (
        <UnifiedAuditModal 
          audit={selectedAudit} 
          onClose={() => setSelectedAudit(null)} 
          onDecision={handleDecisionClick}
          isProcessing={decisionProcessing === selectedAudit.id}
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



