import React, { useState, useEffect, useMemo } from 'react'
import { FileText, Filter, CheckCircle, AlertTriangle, Eye, Download, RefreshCw, Loader2, Search, Truck, Hash, X, Info } from 'lucide-react'
import './AuditHistory.css'

const AUDITS_WEBHOOK_URL = import.meta.env.VITE_AUDITS_HISTORY_URL || 'https://n8n.srv1010832.hstgr.cloud/webhook/40a6351a-d510-492f-918b-7ec9bae2bd2a'

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

  // --- Universal Data Logic ---
  const fieldMap = {};
  Object.entries(audit).forEach(([key, val]) => {
    const EXCLUDED_KEYS = ['Audit_Result', 'Audit_Intelligence', 'id', 'created_at', 'Invoice_SupplierGSTIn_(Invoice)'];
    if (EXCLUDED_KEYS.some(k => key.toLowerCase().includes(k.toLowerCase()))) return;

    let docType = null;
    let fieldBase = key;

    // 1. Identify Document Type from Suffix (handle both _ and space before parenthesis)
    if (key.match(/[ _]\(Invoice\)$|_Invoice$/i)) { docType = 'Invoice'; fieldBase = key.replace(/[ _]\(Invoice\)$|_Invoice$/i, ''); }
    else if (key.match(/[ _]\(EWay\)$|_EWay$/i)) { docType = 'E-Way Bill'; fieldBase = key.replace(/[ _]\(EWay\)$|_EWay$/i, ''); }
    else if (key.match(/[ _]\(LR\)$|_LR$/i)) { docType = 'LR Copy'; fieldBase = key.replace(/[ _]\(LR\)$|_LR$/i, ''); }

    if (docType) {
      // 2. Normalize prefixes (e.g., "Invoice_Weight" -> "Weight")
      // Special handling for identity numbers and GSTINs to prevent incorrect merging
      const lowKey = fieldBase.toLowerCase();
      if (lowKey.includes('invoice_number')) {
        fieldBase = 'Invoice Number';
      } else if (lowKey.includes('lr_number')) {
        fieldBase = 'LR Number';
      } else if (lowKey.includes('ewb_number') || lowKey.includes('eway_number')) {
        fieldBase = 'E-Way Bill Number';
      } else if (lowKey.includes('gstin')) {
        fieldBase = 'GSTIN';
      } else if (lowKey.includes('batch_code') || lowKey.includes('coil_number')) {
        fieldBase = 'Batch / Coil Number';
      } else {
        fieldBase = fieldBase.replace(/^(Invoice|EWay|EWB|LR|Supplier|Consigner|Consignee)[_ ]+/i, '');
      }
      
      // 3. Final cleanup and special cases
      fieldBase = fieldBase.replace(/_/g, ' ').trim();
      if (fieldBase.toLowerCase().includes('total amount')) fieldBase = 'Total Amount';
      if (fieldBase.toLowerCase() === 'name') return;
      
      if (!fieldMap[fieldBase]) fieldMap[fieldBase] = { Invoice: '—', 'E-Way Bill': '—', 'LR Copy': '—' };
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

  const hasMismatch = (vals, fieldName = '') => {
    const filled = Object.values(vals).filter(v => v !== '—');
    if (filled.length <= 1) return false;
    
    // 1. Date-aware comparison (Tolerance: ±1 day)
    if (fieldName.toLowerCase().includes('date')) {
      const timestamps = filled.map(v => {
        const parts = v.split(/[./-]/);
        if (parts.length === 3) {
          const d = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10) - 1;
          const y = parseInt(parts[2], 10);
          return new Date(y, m, d).getTime();
        }
        const p = Date.parse(v);
        return isNaN(p) ? null : p;
      });

      if (timestamps.every(t => t !== null)) {
        const base = timestamps[0];
        const dayMs = 24 * 60 * 60 * 1000;
        return timestamps.some(t => Math.abs(t - base) > dayMs + 1000); 
      }
    }

    const nums = filled.map(v => {
      const cleaned = v.replace(/,/g, '').replace(/[^\d.-]/g, '');
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? null : parsed;
    });

    if (nums.every(n => n !== null)) {
      const base = nums[0];
      const tolerance = fieldName.toLowerCase().includes('weight') ? 0.25 : 1.2;
      return nums.some(n => Math.abs(n - base) >= tolerance);
    }

    return new Set(filled).size > 1;
  };

  const renderCell = (fieldBase, docType, value) => {
    const addr = isAddressField(fieldBase);
    if (docType === 'LR Copy' && addr) return <td key={docType} className="doc-value-cell not-applicable">N/A</td>;
    
    // LR Number is only applicable for LR Copy
    if (fieldBase === 'LR Number' && (docType === 'Invoice' || docType === 'E-Way Bill')) {
      return <td key={docType} className="doc-value-cell not-applicable">N/A</td>;
    }

    // E-Way Bill Number and Vehicle No are not applicable for Invoice
    if ((fieldBase === 'E-Way Bill Number' || fieldBase === 'Vehicle No') && docType === 'Invoice') {
      return <td key={docType} className="doc-value-cell not-applicable">N/A</td>;
    }

    // Batch / Coil Number is not applicable for E-Way Bill
    if (fieldBase === 'Batch / Coil Number' && docType === 'E-Way Bill') {
      return <td key={docType} className="doc-value-cell not-applicable">N/A</td>;
    }

    const status = addr ? getAddressStatus(fieldBase, docType, value) : null;
    const mismatch = !addr && hasMismatch(fieldMap[fieldBase], fieldBase);
    const filled = Object.values(fieldMap[fieldBase]).filter(v => v !== '—');
    const allMatch = !mismatch && filled.length >= 2 && value !== '—';

    let extraClass = '';
    if (mismatch && value !== '—') extraClass = 'mismatch-val';
    else if (allMatch) extraClass = 'match-val';
    if (status === 'ok')   extraClass = 'addr-ok';
    if (status === 'fail') extraClass = 'addr-fail';

    return (
      <td key={docType} className={`doc-value-cell ${extraClass}`} style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', wordBreak: 'break-word', fontWeight: 600 }}>
        {value}
        {status && (
          <span className={`addr-badge ${status}`} style={{ display: 'inline-block', marginLeft: '4px' }}>
            {status === 'ok' ? '✓' : '✗'}
          </span>
        )}
      </td>
    );
  };

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal-content animate-slide-up universal-modal" style={{ maxWidth: view === 'universal' ? '1100px' : '750px', transition: 'max-width 0.3s ease' }} onClick={e => e.stopPropagation()}>
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
                {view === 'intelligence' ? '📊 Switch to Raw Data' : '🤖 Back to Intelligence'}
              </button>
            <button className="close-btn" onClick={onClose}><X size={20} /></button>
          </div>
        </div>

        <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto', padding: '1.5rem' }}>
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
                    <h1 className="main-score" style={{ 
                      color: parseInt(result.overall?.final_score) > 80 ? 'var(--success)' : (parseInt(result.overall?.final_score) > 40 ? 'var(--warning)' : 'var(--error)')
                    }}>
                      {result.overall?.final_score || '0%'}
                    </h1>
                    <span className={`badge-status ${result.overall?.status?.toLowerCase().replace(/_/g, '')}`} style={{ padding: '0.4rem 1.2rem', fontSize: '0.8rem' }}>
                      {result.overall?.status?.replace(/_/g, ' ') || 'UNVERIFIED'}
                    </span>
                  </div>

                  <div className="match-metrics-list">
                    <div className="metric-item">
                      <span className="metric-label">Invoice Identity Ledger</span>
                      <span className={`metric-value ${result.invoice_number_match?.invoice_vs_eway === 'MATCH' ? 'text-success' : (result.invoice_number_match?.invoice_vs_eway ? 'text-error' : '')}`}>
                        {result.invoice_number_match?.invoice_vs_eway || 'N/A'}
                      </span>
                    </div>
                    <div className="metric-item">
                      <span className="metric-label">Vehicle Positioning Match</span>
                      <span className={`metric-value ${parseInt(result.vehicle_match?.score) > 80 ? 'text-success' : (result.vehicle_match?.score ? 'text-error' : '')}`}>
                        {result.vehicle_match?.score || 'Check Pending'}
                      </span>
                    </div>
                    
                    <div className="metric-item has-tooltip">
                      <span className="metric-label">Financial Value Accuracy</span>
                      <span className={`metric-value ${parseInt(result.amount_match?.score) === 100 ? 'text-success' : (result.amount_match?.score ? 'text-error' : '')}`}>
                        {result.amount_match?.score || 'Processing...'}
                      </span>
                      {result.amount_match && (
                        <div className="tooltip-content animate-fade-in">
                           <div className="tooltip-row"><span>Inv Amount:</span> <strong>₹{result.amount_match?.invoice_amount?.toLocaleString()}</strong></div>
                           <div className="tooltip-row"><span>EWB Amount:</span> <strong>₹{result.amount_match?.eway_amount?.toLocaleString()}</strong></div>
                           <div className="tooltip-divider"></div>
                           <div className="tooltip-row highlights"><span>Difference:</span> <strong>₹{Math.abs(result.amount_match?.difference || 0).toLocaleString()}</strong></div>
                        </div>
                      )}
                    </div>

                    <div className="metric-item has-tooltip">
                      <span className="metric-label">Logistics Weight Verification</span>
                      <span className={`metric-value ${result.weight_match?.score === 'MATCH' || parseInt(result.weight_match?.score) > 80 ? 'text-success' : (result.weight_match?.score ? 'text-error font-bold' : '')}`}>
                        {result.weight_match?.score || 'Metric Missing'}
                      </span>
                      {result.weight_match && (
                        <div className="tooltip-content animate-fade-in">
                           <div className="tooltip-row"><span>Inv Weight:</span> <strong>{result.weight_match?.invoice_weight_mt} MT</strong></div>
                           <div className="tooltip-row"><span>EWB Weight:</span> <strong>{result.weight_match?.eway_weight_mt} MT</strong></div>
                           <div className="tooltip-row"><span>LR Weight:</span> <strong>{result.weight_match?.lr_weight_mt} MT</strong></div>
                           <div className="tooltip-divider"></div>
                           <div className="tooltip-row highlights"><span>Max Diff:</span> <strong>{result.weight_match?.max_difference_kg} KG</strong></div>
                        </div>
                      )}
                    </div>

                    {result.overall?.final_score && parseInt(result.overall.final_score) < 100 && (
                      <div className="metric-item" style={{ background: 'rgba(239, 68, 68, 0.05)', padding: '0.85rem', borderRadius: '12px', borderBottom: 'none', marginTop: '12px', border: '1px solid rgba(239, 68, 68, 0.1)' }}>
                        <span className="metric-label" style={{ color: '#ef4444', fontWeight: '800', fontSize: '0.7rem' }}>Integrity Deduction</span>
                        <span className="metric-value" style={{ color: '#ef4444', fontWeight: '900' }}>{100 - parseInt(result.overall.final_score)}% Impact</span>
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
            <div className="universal-table-wrapper animate-fade-in" style={{ padding: '0rem' }}>
                  <table className="comparison-table" style={{ fontSize: '0.75rem', tableLayout: 'fixed', width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        <th className="field-col" style={{ width: '20%', padding: '0.75rem' }}>Field</th>
                        <th className="doc-col invoice-col" style={{ padding: '0.75rem' }}>📄 Invoice</th>
                        <th className="doc-col eway-col" style={{ padding: '0.75rem' }}>🚛 E-Way Bill</th>
                        <th className="doc-col lr-col" style={{ padding: '0.75rem' }}>📋 LR Copy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(fieldMap).map(([fieldBase, vals]) => {
                        const mismatch = !isAddressField(fieldBase) && hasMismatch(vals, fieldBase);
                        return (
                          <tr key={fieldBase} className={mismatch ? 'mismatch-row' : ''}>
                             <td className="field-name-cell" style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)' }}>
                               {fieldBase.replace(/_/g, ' ')}
                               {mismatch && <span className="mismatch-flag">⚠ Mismatch</span>}
                             </td>
                             {renderCell(fieldBase, 'Invoice', vals['Invoice'])}
                             {renderCell(fieldBase, 'E-Way Bill', vals['E-Way Bill'])}
                             {renderCell(fieldBase, 'LR Copy', vals['LR Copy'])}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
            </div>
          )}
        </div>

        <div className="modal-footer flex-between">
            <p className="text-[10px] text-muted italic">Field-by-field cross-doc validation active.</p>
            <div className="flex gap-2">
                <button className="btn btn-outline" onClick={onClose}>Close</button>
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

const AuditHistory = () => {
  const [history, setHistory] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedAudit, setSelectedAudit] = useState(null)
  const [initialModalView, setInitialModalView] = useState('intelligence')
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
      setSelectedAudit(null); // Auto-close modal on success
      await fetchHistory(false); // Refetch from webhook
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

  const fetchHistory = async (showLoading = true) => {
    if (showLoading) setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(AUDITS_WEBHOOK_URL)
      if (!response.ok) throw new Error('Failed to synchronize logs')
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

  useEffect(() => {
    fetchHistory()
  }, [])

  const filteredHistory = useMemo(() => {
    return history.filter(item => 
      (item.Invoice_Number_Invoice?.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.Supplier_Name_Invoice?.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.Vehicle_No_Eway?.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (item.id?.toString().includes(searchTerm))
    )
  }, [history, searchTerm])

  const handleRefresh = () => {
    setIsRefreshing(true)
    fetchHistory(false)
  }

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
      <div className="page-header flex-between mb-8">
        <div>
          <h1 className="page-title">Operational Ledger</h1>
          <p className="page-subtitle">Granular audit traces for purchase and dispatch compliance</p>
          {error && <span className="error-badge">{error}</span>}
        </div>
        <div className="header-actions">
          <div className="search-bar" style={{ position: 'relative' }}>
            <Search size={16} className="text-muted" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
            <input 
              type="text" 
              placeholder="Search Invoice, Supplier or Vehicle..." 
              className="input-search" 
              style={{ paddingLeft: '36px', width: '320px' }}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className="btn btn-outline flex items-center gap-2" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="card table-card overflow-hidden">
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
                
                // Prioritize 'Approve' or 'Reject' from either Status or Result columns
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
                            {score}{score !== 'N/A' && '%'}
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
          <span>Displaying {filteredHistory.length} active audit records</span>
          <div className="flex gap-2">
            <button className="btn btn-outline btn-sm" disabled>Prev</button>
            <button className="btn btn-primary btn-sm px-4">1</button>
            <button className="btn btn-outline btn-sm" disabled>Next</button>
          </div>
        </div>
      </div>

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



