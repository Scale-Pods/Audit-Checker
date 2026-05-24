import React, { useState, useEffect, useMemo } from 'react'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { FileText, AlertTriangle, CheckCircle, TrendingDown, RefreshCw, Loader2, Gauge, X, Info, Check, Truck, BarChart3 } from 'lucide-react'
import './Dashboard.css'

const AUDITS_WEBHOOK_URL = import.meta.env.VITE_AUDITS_HISTORY_URL || 'https://n8n.srv1010832.hstgr.cloud/webhook/40a6351a-d510-492f-918b-7ec9bae2bd2a'

const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6']

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

// Known ZV Steels address tokens
const BILL_TO_TOKENS = ['zv steels', 'zvsteels', 'zv metal', 'aaacz0915c', 'gupta bhavan', 'masjid', 'carnac bunder', 'masjid bandar', '400009', 'mumbai', 'maharashtra']
const SHIP_TO_TOKENS  = ['zv metal', 'roshan fabricators', 'taloja', '410208', 'bhagwan laxmi', 'zv steels', 'midc', 'maharashtra']
const ADDRESS_FIELDS  = ['Bill_To', 'Ship_To', 'Bill To', 'Ship To', 'Recipient', 'Details of Recipient', 'Consignee']

const fuzzyMatch = (value, tokens) => {
  if (!value) return false;
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normValue = normalize(value);
  return tokens.some(t => {
    const normToken = normalize(t);
    return normValue.includes(normToken);
  });
}

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

const DetailModal = ({ audit, onClose, onDecision, isProcessing }) => {
  const [view, setView] = useState('intelligence');
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
      <div className="modal-content animate-slide-up ledger-modal" style={{ maxWidth: view === 'universal' ? '1200px' : '750px', transition: 'max-width 0.3s ease' }} onClick={e => e.stopPropagation()}>
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
            >
              {view === 'intelligence' ? '📊 Raw Data' : '🤖 Intelligence'}
            </button>
            <button className="close-btn" onClick={onClose}><X size={20} /></button>
          </div>
        </div>

        <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto', padding: view === 'universal' ? '0rem' : '2rem' }}>
          {view === 'intelligence' ? (
            !result ? (
              <div className="empty-state">
                 <AlertTriangle size={40} className="empty-icon" />
                 <p>No granular intelligence packet available.</p>
              </div>
            ) : (
              <div className="intelligence-grid animate-fade-in">
                <div className="score-main-card">
                   <span className="card-label">Overall Compliance Index</span>
                   <h1 className="main-score">{result.overall?.final_score || 'N/A'}</h1>
                   <span 
                        className={`badge-status ${result.overall?.status?.toLowerCase().replace(/_/g, '')}`}
                        style={
                          audit.Status === 'Approve' ? { background: '#10b981', color: 'white', border: '1px solid #10b981' } :
                          audit.Status === 'Reject' ? { background: '#ef4444', color: 'white', border: '1px solid #ef4444' } : {}
                        }
                      >
                        {audit.Status === 'Approve' || result.overall?.status === 'GOOD_MATCH' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                        {(audit.Status || result.overall?.status?.replace(/_/g, ' ') || 'Pending').toUpperCase()}
                      </span>
                </div>

                <div className="match-metrics-list">
                   <div className="metric-item">
                     <span className="metric-label">Invoice Match Score</span>
                     <span className="metric-value">{result.invoice_number_match?.invoice_vs_eway || '100%'}</span>
                   </div>
                   <div className="metric-item">
                     <span className="metric-label">Vehicle identity Match</span>
                     <span className="metric-value">{result.vehicle_match?.score || '100%'}</span>
                   </div>
                   
                   <div className="metric-item has-tooltip">
                     <span className="metric-label">Amount Match Accuracy</span>
                     <span className="metric-value">{result.amount_match?.score || '100%'}</span>
                     <div className="tooltip-content animate-fade-in">
                        <div className="tooltip-row"><span>Inv Amount:</span> <strong>₹{result.amount_match?.invoice_amount?.toLocaleString()}</strong></div>
                        <div className="tooltip-row"><span>EWB Amount:</span> <strong>₹{result.amount_match?.eway_amount?.toLocaleString()}</strong></div>
                        <div className="tooltip-divider"></div>
                        <div className="tooltip-row highlights"><span>Difference:</span> <strong>₹{Math.abs(result.amount_match?.difference || 0).toLocaleString()}</strong></div>
                     </div>
                   </div>

                   <div className="metric-item has-tooltip">
                     <span className="metric-label">Weight Matches</span>
                     <span className="metric-value">{result.weight_match?.score || '100%'}</span>
                     <div className="tooltip-content animate-fade-in">
                        <div className="tooltip-row"><span>Inv Weight:</span> <strong>{result.weight_match?.invoice_weight_mt} MT</strong></div>
                        <div className="tooltip-row"><span>EWB Weight:</span> <strong>{result.weight_match?.eway_weight_mt} MT</strong></div>
                        <div className="tooltip-row"><span>LR Weight:</span> <strong>{result.weight_match?.lr_weight_mt} MT</strong></div>
                        <div className="tooltip-divider"></div>
                        <div className="tooltip-row highlights"><span>Max Diff:</span> <strong>{result.weight_match?.max_difference_kg} KG</strong></div>
                     </div>
                   </div>

                    {result.issues?.length > 0 && (
                      <div className="metric-item" style={{ background: '#fff1f2', padding: '0.75rem', borderRadius: '8px', borderBottom: 'none', marginTop: '4px' }}>
                        <span className="metric-label" style={{ color: '#be123c', fontWeight: '700' }}>Compliance Exceptions</span>
                        <span className="metric-value" style={{ color: '#be123c' }}>-{100 - parseInt(result.overall?.final_score || 100)}%</span>
                      </div>
                    )}
                 </div>

                <div className="issues-feedback-card">
                   <h4 className="feedback-title">Intelligence Feedback & Issues</h4>
                   <div className="issues-stack">
                     {result.issues?.length > 0 ? (
                       result.issues.map((issue, idx) => (
                         <div key={idx} className="issue-row">
                            <AlertTriangle size={18} className="text-error" />
                            <span className="issue-text">{issue.replace(/_/g, ' ')}</span>
                         </div>
                       ))
                     ) : (
                       <div className="success-row">
                          <CheckCircle size={18} />
                          <span className="success-text">Zero discrepancies found. Operational integrity verified.</span>
                       </div>
                     )}
                     {result.invoice_number_match?.remarks && (
                       <div className="remarks-box">
                         <strong>Technical Note:</strong> {result.invoice_number_match.remarks}
                       </div>
                     )}
                   </div>
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

              <div className="universal-table-wrapper animate-fade-in" style={{ padding: '0rem' }}>
                <table className="comparison-table" style={{ fontSize: '0.75rem', width: '100%', borderCollapse: 'collapse' }}>
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
                          <td data-label="Field Identity" className="field-name-cell font-bold tracking-tight">
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

        <div className="modal-footer flex-between">
          <p className="text-[10px] text-muted italic">4-way cross-document validation · {totalFields} fields analyzed</p>
          <div className="flex gap-2">
            <button className="btn btn-outline" onClick={onClose}>Close Detail</button>
            <button 
              className="btn" 
              style={{ background: '#ef4444', color: 'white', border: 'none' }}
              onClick={() => onDecision(audit.id, 'Reject')}
              disabled={isProcessing}
            >
              {isProcessing ? 'Sending...' : 'Reject'}
            </button>
            <button 
              className="btn" 
              style={{ background: '#10b981', color: 'white', border: 'none' }}
              onClick={() => onDecision(audit.id, 'Approve')}
              disabled={isProcessing}
            >
              {isProcessing ? 'Sending...' : 'Approve'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const StatCard = ({ title, value, icon, trend, trendLabel, type = "default" }) => {
  const Icon = icon;
  const isPositive = type === 'success' || (type === 'default' && trend > 0);
  
  return (
    <div className="card stat-card animate-fade-in">
      <div className="stat-header">
        <div className="stat-info">
          <p className="stat-title">{title}</p>
          <h3 className="stat-value">{value}</h3>
        </div>
        <div className={`stat-icon-wrapper ${type}`}>
          <Icon size={24} />
        </div>
      </div>
      <div className="stat-footer">
        {trend !== undefined && (
          <span className={`trend ${isPositive ? 'positive' : 'negative'}`}>
            {trend > 0 ? '+' : ''}{trend}%
          </span>
        )}
        <span className="trend-label">{trendLabel || 'Live update'}</span>
      </div>
    </div>
  )
}

const Dashboard = () => {
  const [audits, setAudits] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedAudit, setSelectedAudit] = useState(null)
  const [decisionProcessing, setDecisionProcessing] = useState(null)
  const [confirmDecision, setConfirmDecision] = useState(null)

  const handleDecisionClick = (auditId, decision) => {
    setConfirmDecision({ id: auditId, decision });
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
      await fetchAudits(false);
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
    } catch (e) {
      console.warn('Failed to parse audit result:', e);
      return null;
    }
  }

  const fetchAudits = async (showLoading = true) => {
    if (showLoading) setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(AUDITS_WEBHOOK_URL)
      if (!response.ok) throw new Error('Failed to fetch audits')
      const data = await response.json()
      
      let auditData = [];
      if (Array.isArray(data)) {
        auditData = data;
      } else if (data.audits && Array.isArray(data.audits)) {
        auditData = data.audits;
      } else if (data.data && Array.isArray(data.data)) {
        auditData = data.data;
      } else if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        auditData = [data];
      }
      
      setAudits(prev => {
        const merged = new Map();
        // Add existing ones first
        prev.forEach(item => merged.set(item.id, item));
        // Add/Update with new ones
        auditData.forEach(item => merged.set(item.id, item));
        
        // Convert to array and sort by created_at desc
        return Array.from(merged.values()).sort((a, b) => 
          new Date(b.created_at) - new Date(a.created_at)
        );
      });
    } catch (err) {
      console.error('Dashboard Fetch Error:', err)
      setError('Connection failed. Using cached intelligence.')
      setAudits([])
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    fetchAudits()
  }, [])

  const handleRefresh = () => {
    setIsRefreshing(true)
    fetchAudits(false)
  }

  const processedData = useMemo(() => {
    const stats = { total: audits.length, matched: 0, pending: 0, mismatch: 0, totalValue: 0 }
    const charts = { bar: {}, pie: [] }

    audits.forEach(audit => {
      const result = parseAuditResult(audit.Audit_Result);
      const decision = (audit.Result === 'Approve' || audit.Result === 'Reject') ? audit.Result : 
                       (audit.Status === 'Approve' || audit.Status === 'Reject') ? audit.Status : null;
      
      const status = decision || result?.overall?.status || audit.Result || audit.Status;
      const isMatched = status === 'GOOD_MATCH' || status === 'Completed' || status === 'Approve';
      const isMismatch = status?.includes('MISMATCH') || status === 'Error' || status === 'PARTIAL_MATCH' || status === 'Reject';
      
      if (isMatched) stats.matched++;
      else if (isMismatch) stats.mismatch++;
      else stats.pending++;

      const amount = parseFloat(audit.Total_Amount_Invoice) || 0;
      stats.totalValue += amount;

      const dateStr = audit.created_at || audit.Audit_Date || audit.Created_At;
      const date = dateStr ? new Date(dateStr) : new Date();
      const month = date.toLocaleString('default', { month: 'short' });
      if (!charts.bar[month]) charts.bar[month] = { name: month, Success: 0, Issues: 0 }
      if (isMatched) charts.bar[month].Success++;
      else charts.bar[month].Issues++;
    })

    charts.pie = [
      { name: 'Verified Match', value: stats.matched },
      { name: 'Pending Review', value: stats.pending },
      { name: 'Critical Mismatch', value: stats.mismatch }
    ]

    return { stats, charts: { ...charts, bar: Object.values(charts.bar) } }
  }, [audits])

  if (isLoading) {
    return (
      <div className="dashboard-loading flex-center" style={{ height: '80vh', flexDirection: 'column', gap: '1.5rem' }}>
        <Loader2 className="animate-spin text-primary" size={50} />
        <h2 className="text-xl font-bold">Synchronizing Global Audit Intelligence</h2>
        <p className="text-muted">Fetching records from centralized registry...</p>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <div className="page-header">
        <div>
          <h1 className="page-title">Executive Overview</h1>
          <p className="page-subtitle">Unified surveillance of purchase and logistics compliance</p>
          {error && <span className="error-badge">{error}</span>}
        </div>
        <div className="header-actions">
          <button className="btn btn-outline flex items-center gap-2" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} /> Sync Webhook
          </button>
          <button className="btn btn-primary">Surveillance Report</button>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard 
          title="Total Invoices Audited" 
          value={processedData.stats.total} 
          icon={FileText} 
          trendLabel="Active ledger entries"
          type="primary"
        />
        <StatCard 
          title="Compliance Match Rate" 
          value={`${processedData.stats.total ? Math.round((processedData.stats.matched / processedData.stats.total) * 100) : 0}%`}
          icon={CheckCircle} 
          type="success"
          trendLabel="Across all documents"
        />
        <StatCard 
          title="Audit Discrepancies" 
          value={processedData.stats.mismatch} 
          icon={AlertTriangle} 
          type="error"
          trendLabel="Requires immediate action"
        />
        <StatCard 
          title="Total Audit Value" 
          value={`₹${(processedData.stats.totalValue / 100000).toFixed(2)} L`} 
          icon={TrendingDown} 
          type="warning"
          trendLabel="Live transactional volume in Lakhs"
        />
      </div>

      <div className="charts-grid">
        <div className="card chart-card">
          <div className="card-header pb-4 border-b">
            <h3 className="card-title">Compliance Intelligence Timeline</h3>
          </div>
          <div className="chart-container pt-6">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={processedData.charts.bar}>
                <CartesianGrid strokeDasharray="3" vertical={false} stroke="var(--border)" opacity={0.3} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip 
                  cursor={{fill: 'var(--text-muted)', opacity: 0.05}} 
                  contentStyle={{
                    backgroundColor: 'var(--surface)', 
                    border: '1px solid var(--border)', 
                    borderRadius: '12px',
                    boxShadow: 'var(--shadow-lg)',
                    color: 'var(--text)'
                  }}
                  itemStyle={{ color: 'var(--text)', fontSize: '12px' }}
                />
                <Legend iconType="circle" verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px', fontWeight: 'bold', color: 'var(--text)' }} />
                <Bar dataKey="Success" name="Verified Matches" fill="#10B981" radius={[4, 4, 0, 0]} barSize={32} />
                <Bar dataKey="Issues" name="Mismatches/Pending" fill="#475569" radius={[4, 4, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card chart-card">
          <div className="header border-b pb-4">
             <h3 className="card-title px-6">Verification Integrity</h3>
          </div>
          <div className="chart-container flex-center">
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={processedData.charts.pie}
                  cx="50%"
                  cy="50%"
                  innerRadius={75}
                  outerRadius={105}
                  paddingAngle={8}
                  dataKey="value"
                >
                  {processedData.charts.pie.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'var(--surface)', 
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    boxShadow: 'var(--shadow-lg)',
                    color: 'var(--text)'
                  }}
                  itemStyle={{ color: 'var(--text)', fontSize: '12px' }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pie-center-text">
              <span className="pie-percent" style={{ fontSize: '1.5rem' }}>
                {processedData.stats.total ? Math.round((processedData.stats.matched / processedData.stats.total) * 100) : 0}%
              </span>
              <span className="pie-label">Integrity</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card table-card overflow-hidden">
        <div className="card-header flex-between border-b p-6">
          <h3 className="card-title">Recent Intelligence Snapshots</h3>
          <p className="text-xs text-muted font-bold italic">Click any audit row to Drill-down</p>
        </div>
        <div className="table-responsive">
          <table className="data-table">
            <thead>
              <tr>
                <th>Invoice Identity</th>
                <th>Supplier Asset</th>
                <th className="text-right">Compliance Score</th>
              </tr>
            </thead>
            <tbody>
              {audits.slice(0, 8).map((record) => {
                const result = parseAuditResult(record.Audit_Result);
                const score = result?.overall?.final_score || 'N/A';
                
                const finalDecision = (record.Result === 'Approve' || record.Result === 'Reject') ? record.Result : 
                                      (record.Status === 'Approve' || record.Status === 'Reject') ? record.Status : null;

                const rowBg = finalDecision === 'Approve' ? 'rgba(16, 185, 129, 0.2)' : 
                              finalDecision === 'Reject' ? 'rgba(239, 68, 68, 0.2)' : undefined;
                
                return (
                  <tr 
                    key={record.id} 
                    onClick={() => setSelectedAudit(record)}
                    style={{ cursor: 'pointer', backgroundColor: rowBg }}
                    className="audit-row hover:bg-primary/5 transition-all"
                  >
                    <td className="font-bold text-primary" style={{ fontSize: '1.1rem' }}>
                      {record.Invoice_Number_Invoice || `REF-${record.id}`}
                    </td>
                    <td className="font-medium text-gray-700">
                      {record.Supplier_Name_Invoice || 'System Record'}
                    </td>
                    <td className="text-right">
                       <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem' }}>
                          <div className={`score-badge ${parseInt(score) > 80 ? 'high' : 'review'}`} style={{
                            padding: '4px 12px',
                            borderRadius: '20px',
                            fontSize: '14px',
                            fontWeight: '900',
                            background: parseInt(score) > 80 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                            color: parseInt(score) > 80 ? 'var(--success)' : 'var(--warning)',
                            border: `1px solid ${parseInt(score) > 80 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)'}`
                          }}>
                            {score}%
                          </div>
                          <Info size={16} className="text-muted opacity-40" />
                       </div>
                    </td>
                  </tr>
                )
              })}
              {audits.length === 0 && (
                <tr>
                  <td colSpan="3" className="text-center p-20 text-muted">
                    <Loader2 size={40} className="animate-spin mb-4" />
                    <p>No active intelligence reports found in system registry.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedAudit && (
        <DetailModal 
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

export default Dashboard


