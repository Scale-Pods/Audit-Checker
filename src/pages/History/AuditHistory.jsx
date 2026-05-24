import React, { useState, useEffect, useMemo } from 'react'
import { FileText, Filter, CheckCircle, AlertTriangle, Eye, Download, RefreshCw, Loader2, Search, Truck, Hash, X, Info, IndianRupee, Activity, ChevronLeft, ChevronRight, Check, Shield, TrendingUp, BarChart3 } from 'lucide-react'
import './AuditHistory.css'

const AUDITS_WEBHOOK_URL = import.meta.env.VITE_AUDITS_HISTORY_URL || 'https://n8n.srv1010832.hstgr.cloud/webhook/40a6351a-d510-492f-918b-7ec9bae2bd2a'
const SALES_WEBHOOK_URL = 'https://n8n.srv1010832.hstgr.cloud/webhook/10916618-e795-416f-9d0a-6646da9aba06'
const SALES_DECISION_WEBHOOK_URL = 'https://n8n.srv1010832.hstgr.cloud/webhook/0c5dfbd4-db17-4d71-87ab-96fa2fb7369e'

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
  return text.toString()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\b(pvt|ltd|private|limited|co|company|corp|corporation|inc|incorporated)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s/g, '');
};

const normalizeHSN = (text) => {
  if (!text || text === '—') return '';
  return text.toString().replace(/[^0-9]/g, '');
};

const normalizeVehicleNo = (text) => {
  if (!text || text === '—') return '';
  return text.toString().toUpperCase().replace(/\s/g, '');
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

  const filled = Object.values(vals).filter(v => v !== '—');
  if (new Set(filled).size > 1) return { status: 'MISMATCH', reason: 'Values differ across documents' };
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

const UnifiedAuditModal = ({ audit, onClose, initialView = 'intelligence', onDecision, isProcessing }) => {
  const [view, setView] = useState(initialView);
  if (!audit) return null;

  const parseAuditResult = (resultStr) => {
    if (!resultStr) return null;
    try {
      const parsed = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;
      return Array.isArray(parsed) ? parsed[0] : parsed;
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
      } else if (lowKey === 'consigner_name' || lowKey === 'supplier_name') {
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
  const auditScore = totalFields > 0 ? Math.round(((matchCount + partialCount * 0.5) / totalFields) * 100) : 0;
  const overallStatus = auditScore >= 85 ? 'GOOD MATCH' : auditScore >= 60 ? 'PARTIAL MATCH' : 'HIGH MISMATCH';
  const riskLevel = mismatchCount > 1 || Object.values(comparisons).some(c => c.status === 'CRITICAL') ? 'HIGH' : mismatchCount > 0 ? 'MEDIUM' : 'LOW';
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
              {view === 'intelligence' ? 'Audit Intelligence' : 'Universal Document Ledger'}
            </h2>
            <p className="modal-subtitle">Ref: {audit.Invoice_Number_Invoice || audit.id}</p>
          </div>
          <div className="flex items-center gap-3">
             <button 
                className="btn btn-outline btn-sm py-1 font-bold text-[10px] uppercase tracking-wider" 
                onClick={() => setView(view === 'intelligence' ? 'universal' : 'intelligence')}
                style={{ height: '32px' }}
              >
                {view === 'intelligence' ? '📊 Raw Data' : '🤖 Intelligence'}
              </button>
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
                    <span className={`score-status-badge ${overallStatus === 'GOOD MATCH' ? 'score-good' : overallStatus === 'PARTIAL MATCH' ? 'score-partial' : 'score-bad'}`}>
                      {overallStatus}
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
  { label: 'Order Number',       invoice: 'order_number',        sheet: 'order_number_sheet',        type: 'text' },
  { label: 'Party Order Number', invoice: 'party_order_number',  sheet: 'party_order_number_sheet',  type: 'text' },
  { label: 'Broker Name',        invoice: 'broker_name',         sheet: 'broker_name_sheet',         type: 'name' },
  { label: 'Bill To Name',       invoice: 'bill_to_name',        sheet: 'bill_to_name_sheet',        type: 'name' },
  { label: 'Rate',               invoice: 'rate',                sheet: 'rate_sheet',                type: 'numeric' },
  { label: 'Quantity (MT)',      invoice: 'quantity',            sheet: 'quantity_sheet',            type: 'quantity' },
  { label: 'Payment Terms',      invoice: 'payment_terms',       sheet: 'payment_terms_sheet',       type: 'numeric' },
  { label: 'Thickness',          invoice: 'thickness',           sheet: 'thickness_sheet',           type: 'numeric' },
  { label: 'Width',              invoice: 'width',               sheet: 'width_sheet',               type: 'numeric' },
  { label: 'Length',             invoice: 'length',              sheet: 'length_sheet',              type: 'numeric' },
];

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

const salesValuesMatch = (a, b, type = 'text') => {
  if (!a && !b) return true;
  if (!a || !b) return false;

  const clean = v => v.toString().replace(/,/g, '').trim();

  if (type === 'name') return fuzzyNameMatch(a, b);

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
    if (!isNaN(na) && !isNaN(nb)) return Math.abs(na - nb) < 0.01;
  }

  // text / fallback
  return clean(a).toLowerCase() === clean(b).toLowerCase();
};

// ── Sales Record Detail Modal (supports grouped items with swipe) ──
const SalesRecordModal = ({ records, onClose, invoiceNumber, onDecision, isProcessing, hasDecision, decisionStatus }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [slideClass, setSlideClass] = useState('');
  const [touchStartX, setTouchStartX] = useState(null);
  const [touchStartY, setTouchStartY] = useState(null);
  const [touchDeltaX, setTouchDeltaX] = useState(0);
  const [touchDeltaY, setTouchDeltaY] = useState(0);

  if (!records || records.length === 0) return null;

  const record = records[currentIndex];
  const totalItems = records.length;
  const hasMultiple = totalItems > 1;

  const navigateTo = (dir) => {
    const next = dir === 'next' ? currentIndex + 1 : currentIndex - 1;
    if (next < 0 || next >= totalItems) return;
    setSlideClass(dir === 'next' ? 'slide-out-left' : 'slide-out-right');
    setTimeout(() => {
      setCurrentIndex(next);
      setSlideClass(dir === 'next' ? 'slide-in-right' : 'slide-in-left');
      setTimeout(() => setSlideClass(''), 300);
    }, 200);
  };

  const onTouchStart = (e) => { 
    setTouchStartX(e.touches[0].clientX); 
    setTouchStartY(e.touches[0].clientY);
    setTouchDeltaX(0); 
    setTouchDeltaY(0);
  };
  
  const onTouchMove = (e) => { 
    if (touchStartX !== null && touchStartY !== null) {
      setTouchDeltaX(e.touches[0].clientX - touchStartX);
      setTouchDeltaY(e.touches[0].clientY - touchStartY);
    }
  };
  
  const onTouchEnd = () => {
    // Only swipe if horizontal movement is significantly greater than vertical movement
    if (Math.abs(touchDeltaX) > 70 && Math.abs(touchDeltaX) > Math.abs(touchDeltaY) * 1.5) { 
      touchDeltaX < 0 ? navigateTo('next') : navigateTo('prev'); 
    }
    setTouchStartX(null); 
    setTouchStartY(null);
    setTouchDeltaX(0); 
    setTouchDeltaY(0);
  };

  const val = (key) => {
    const v = record[key];
    return (v !== null && v !== undefined && v !== '') ? v.toString() : null;
  };

  const totalFields = SALES_COMPARE_FIELDS.length;
  const matchCount = SALES_COMPARE_FIELDS.filter(f => {
    const iv = val(f.invoice), sv = val(f.sheet);
    return iv && sv && salesValuesMatch(iv, sv, f.type);
  }).length;
  const scorePercent = Math.round((matchCount / totalFields) * 100);
  const allMatch = matchCount === totalFields;

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal-content animate-slide-up sales-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="header-text-group">
            <h2 className="modal-title">
              <FileText className="text-primary" size={22} />
              Sales Comparison Ledger
            </h2>
            <p className="modal-subtitle">Invoice: {invoiceNumber || '—'}</p>
          </div>
          <div className="flex items-center gap-3">
            {hasMultiple && (
              <span className="swipe-item-counter">Item {currentIndex + 1}/{totalItems}</span>
            )}
            <div className="sales-score-pill" style={{
              background: allMatch ? 'rgba(16,185,129,0.15)' : scorePercent >= 70 ? 'rgba(245,158,11,0.15)' : 'rgba(239,68,68,0.15)',
              color: allMatch ? '#10b981' : scorePercent >= 70 ? '#f59e0b' : '#ef4444',
              border: `1px solid ${allMatch ? 'rgba(16,185,129,0.3)' : scorePercent >= 70 ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}`,
            }}>
              {scorePercent}% Match
            </div>
            <button className="close-btn" onClick={onClose}><X size={20} /></button>
          </div>
        </div>

        <div
          className={`modal-body swipe-body ${slideClass}`}
          style={{ padding: '0' }}
          onTouchStart={hasMultiple ? onTouchStart : undefined}
          onTouchMove={hasMultiple ? onTouchMove : undefined}
          onTouchEnd={hasMultiple ? onTouchEnd : undefined}
        >
          <table className="sales-compare-table">
            <thead>
              <tr>
                <th className="sc-field-col">Field</th>
                <th className="sc-inv-col">📄 Invoice</th>
                <th className="sc-sheet-col">📊 Sheet</th>
                <th className="sc-status-col">Status</th>
              </tr>
            </thead>
            <tbody>
              {SALES_COMPARE_FIELDS.map(({ label, invoice, sheet, type }) => {
                const iv = val(invoice);
                const sv = val(sheet);
                const bothPresent = iv && sv;
                const matched = bothPresent && salesValuesMatch(iv, sv, type);
                const mismatched = bothPresent && !matched;
                return (
                  <tr key={label} className={mismatched ? 'sc-row-mismatch' : matched ? 'sc-row-match' : ''}>
                    <td className="sc-field-name">{label}</td>
                    <td className={`sc-cell ${mismatched ? 'sc-val-mismatch' : matched ? 'sc-val-match' : ''}`}>
                      {iv ?? <span className="sc-empty">—</span>}
                    </td>
                    <td className={`sc-cell ${mismatched ? 'sc-val-mismatch' : matched ? 'sc-val-match' : ''}`}>
                      {sv ?? <span className="sc-empty">—</span>}
                    </td>
                    <td className="sc-status-cell">
                      {bothPresent
                        ? matched
                          ? <span className="sc-badge match"><CheckCircle size={12} /> Match</span>
                          : <span className="sc-badge mismatch"><AlertTriangle size={12} /> Mismatch</span>
                        : <span className="sc-badge missing">—</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {hasMultiple && (
          <div className="swipe-nav-bar">
            <button className="swipe-nav-btn" onClick={() => navigateTo('prev')} disabled={currentIndex === 0}>
              <ChevronLeft size={16} /> Prev
            </button>
            <div className="swipe-dots">
              {records.map((_, i) => (
                <span key={i} className={`swipe-dot ${i === currentIndex ? 'active' : ''}`} onClick={() => setCurrentIndex(i)} />
              ))}
            </div>
            <button className="swipe-nav-btn" onClick={() => navigateTo('next')} disabled={currentIndex === totalItems - 1}>
              Next <ChevronRight size={16} />
            </button>
          </div>
        )}

        <div className="modal-footer">
          <p className="footer-hint">{matchCount}/{totalFields} fields match · Invoice vs Sheet comparison</p>
          <div className="flex action-group" style={{ gap: '0.75rem' }}>
            <button className="btn btn-outline" onClick={onClose}>Close</button>
            {hasDecision ? (
              <span className="sales-decision-badge" style={{
                background: decisionStatus === 'Approve' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                color: decisionStatus === 'Approve' ? '#10b981' : '#ef4444',
                border: `1px solid ${decisionStatus === 'Approve' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
                padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 700
              }}>
                {decisionStatus === 'Approve' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                {' '}{decisionStatus === 'Approve' ? 'Approved' : 'Rejected'}
              </span>
            ) : onDecision && (
              <>
                <button 
                  className="btn btn-reject"
                  onClick={() => onDecision(record.id, 'Reject')}
                  disabled={isProcessing}
                >
                  Reject Match
                </button>
                <button 
                  className="btn btn-approve"
                  onClick={() => onDecision(record.id, 'Approve')}
                  disabled={isProcessing}
                >
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

const AuditHistory = () => {
  const [activeSide, setActiveSide] = useState('purchase') // 'purchase' | 'sales'
  const [history, setHistory] = useState([])
  const [salesHistory, setSalesHistory] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSalesLoading, setIsSalesLoading] = useState(false)
  const [error, setError] = useState(null)
  const [salesError, setSalesError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedAudit, setSelectedAudit] = useState(null)
  const [selectedSalesGroup, setSelectedSalesGroup] = useState(null)
  const [initialModalView, setInitialModalView] = useState('intelligence')
  const [decisionProcessing, setDecisionProcessing] = useState(null)
  const [confirmDecision, setConfirmDecision] = useState(null)
  const [sortOrder, setSortOrder] = useState('latest') // 'latest' | 'oldest'

  // Derived: which groups already have a decision saved
  const salesGroupDecisions = useMemo(() => {
    const map = {};
    salesHistory.forEach(r => {
      const inv = r.order_number || r["Invoice Number"] || r.Order_Number || r.invoice_number;
      if (!inv) return;
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
        targetInvoice = record.order_number || record["Invoice Number"] || record.Order_Number || record.invoice_number;
      }
      if (!targetInvoice) return prev;
      return prev.map(r => {
        const inv = r.order_number || r["Invoice Number"] || r.Order_Number || r.invoice_number;
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
      return Array.isArray(parsed) ? parsed[0] : parsed;
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
      const response = await fetch(AUDITS_WEBHOOK_URL)
      if (!response.ok) throw new Error('Failed to synchronize logs')
      const data = await response.json()
      const auditData = normalizeArray(data);
      
      setHistory(prev => {
        const merged = new Map();
        prev.forEach(item => merged.set(item.id, item));
        auditData.forEach(item => merged.set(item.id, item));
        return Array.from(merged.values()).sort((a, b) => 
          new Date(b.created_at || Date.now()) - new Date(a.created_at || Date.now())
        );
      });
    } catch {
      console.error('History Fetch Error')
      setError('System offline. Using transient storage.')
      setHistory([])
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  const fetchSalesHistory = async (showLoading = true) => {
    if (showLoading) setIsSalesLoading(true)
    setSalesError(null)
    try {
      const response = await fetch(SALES_WEBHOOK_URL)
      if (!response.ok) throw new Error('Failed to fetch sales records')
      const data = await response.json()
      const salesData = normalizeArray(data);
      
      // Deduplicate by ID to handle potential backend/API duplicates
      const uniqueSales = Array.from(
        new Map(salesData.map(item => [item.id || JSON.stringify(item), item])).values()
      );
      
      setSalesHistory(uniqueSales);
    } catch {
      console.error('Sales History Fetch Error')
      setSalesError('Could not load sales records.')
      setSalesHistory([])
    } finally {
      setIsSalesLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    fetchHistory()
  }, [])

  const handleSideToggle = (side) => {
    setActiveSide(side);
    setSearchTerm('');
    if (side === 'sales' && salesHistory.length === 0 && !isSalesLoading) {
      fetchSalesHistory();
    }
  };

  const filteredHistory = useMemo(() => {
    const filtered = history.filter(item => 
      (item.Invoice_Number_Invoice?.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.Supplier_Name_Invoice?.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.Vehicle_No_Eway?.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.id?.toString().includes(searchTerm))
    );
    return [...filtered].sort((a, b) => {
      const da = new Date(a.created_at || 0).getTime();
      const db = new Date(b.created_at || 0).getTime();
      return sortOrder === 'latest' ? db - da : da - db;
    });
  }, [history, searchTerm, sortOrder])

  const filteredSalesHistory = useMemo(() => {
    if (!searchTerm) return salesHistory;
    const term = searchTerm.toLowerCase();
    return salesHistory.filter(item =>
      Object.values(item).some(v => v?.toString().toLowerCase().includes(term))
    );
  }, [salesHistory, searchTerm])

  // Group sales records by invoice number
  const groupedSalesHistory = useMemo(() => {
    const groups = {};
    filteredSalesHistory.forEach(record => {
      const invoiceNum = record.order_number || record["Invoice Number"] || record.Order_Number || record.invoice_number || 'Unknown';
      if (!groups[invoiceNum]) {
        groups[invoiceNum] = {
          invoiceNumber: invoiceNum,
          records: [],
          partyName: record.bill_to_name || record.broker_name || 'Unknown Party',
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

  const handleRefresh = () => {
    setIsRefreshing(true)
    if (activeSide === 'sales') {
      fetchSalesHistory(false)
    } else {
      fetchHistory(false)
    }
  }

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
        <div className="flex-between mb-6">
          <div>
            <h1 className="page-title">Operational Ledger</h1>
            <p className="page-subtitle">
              {activeSide === 'purchase' ? 'Purchase audit traces & dispatch compliance' : 'Sales side records & invoice log'}
            </p>
          </div>
          <button className="btn btn-outline flex items-center gap-2 refresh-btn-desktop" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        <div className="header-actions-bar">
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
              className="btn btn-outline btn-sm" 
              onClick={() => setSortOrder(sortOrder === 'latest' ? 'oldest' : 'latest')}
              title={`Sort: ${sortOrder === 'latest' ? 'Newest first' : 'Oldest first'}`}
              style={{ padding: '0.5rem 0.65rem', fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap', gap: '4px', flexShrink: 0 }}
            >
              <span>{sortOrder === 'latest' ? '↓' : '↑'}</span>
              <span className="hide-mobile">{sortOrder === 'latest' ? 'Latest' : 'Oldest'}</span>
            </button>
            <button className="btn btn-outline refresh-btn-mobile" onClick={handleRefresh} disabled={isRefreshing}>
              <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* ── PURCHASE SIDE ──────────────────────────────────────── */}
      {activeSide === 'purchase' && (
        <div className="card table-card overflow-hidden animate-fade-in">
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
                {filteredHistory.map((record) => {
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
                            setInitialModalView('universal');
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
          <div className="pagination p-6 border-t flex justify-between items-center text-sm text-muted">
            <span>Displaying {filteredHistory.length} purchase audit records</span>
            <div className="flex gap-2">
              <button className="btn btn-outline btn-sm" disabled>Prev</button>
              <button className="btn btn-primary btn-sm px-4">1</button>
              <button className="btn btn-outline btn-sm" disabled>Next</button>
            </div>
          </div>
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
              {groupedSalesHistory.map((group, idx) => {
                const groupDecision = salesGroupDecisions[group.invoiceNumber];
                const cardBg = groupDecision === 'Approve' ? 'rgba(16, 185, 129, 0.12)' :
                               groupDecision === 'Reject' ? 'rgba(239, 68, 68, 0.12)' : '';
                return (
                <div 
                  key={group.invoiceNumber || idx} 
                  className="sales-record-card"
                  style={cardBg ? { backgroundColor: cardBg } : {}}
                  onClick={() => setSelectedSalesGroup(group)}
                >
                  <div className="sales-record-info">
                    <div className="sales-invoice-header">
                      <h3 className="sales-order-id">{group.invoiceNumber}</h3>
                      {group.records.length > 1 && (
                        <span className="item-count-badge">{group.records.length} items</span>
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
                    <button className="btn-action-view">
                      <Eye size={16} />
                      <span className="hide-mobile">View Comparison</span>
                    </button>
                  </div>
                </div>
                );
              })}
           </div>
          <div className="pagination p-6 border-t flex justify-between items-center text-sm text-muted">
            <span className="hide-mobile">Displaying {groupedSalesHistory.length} sales records</span>
            <span className="show-mobile-only">{groupedSalesHistory.length} Records</span>
            <div className="flex gap-2">
              <button className="btn btn-outline btn-sm" disabled>Prev</button>
              <button className="btn btn-primary btn-sm px-4">1</button>
              <button className="btn btn-outline btn-sm" disabled>Next</button>
            </div>
          </div>
            </>
          )}
        </div>
      )}

      {selectedSalesGroup && (
        <SalesRecordModal
          records={selectedSalesGroup.records}
          invoiceNumber={selectedSalesGroup.invoiceNumber}
          onClose={() => setSelectedSalesGroup(null)}
          onDecision={handleDecisionClick}
          isProcessing={!!decisionProcessing}
          hasDecision={!!salesGroupDecisions[selectedSalesGroup.invoiceNumber]}
          decisionStatus={salesGroupDecisions[selectedSalesGroup.invoiceNumber]}
        />
      )}

      {selectedAudit && (
        <UnifiedAuditModal 
          audit={selectedAudit} 
          onClose={() => setSelectedAudit(null)} 
          initialView={initialModalView}
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



