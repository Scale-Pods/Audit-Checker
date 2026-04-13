import React, { useState, useEffect, useMemo } from 'react'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { FileText, AlertTriangle, CheckCircle, TrendingDown, RefreshCw, Loader2, Gauge, X, Info } from 'lucide-react'
import './Dashboard.css'

const AUDITS_WEBHOOK_URL = import.meta.env.VITE_AUDITS_HISTORY_URL || 'https://n8n.srv1010832.hstgr.cloud/webhook/40a6351a-d510-492f-918b-7ec9bae2bd2a'

const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6']

const DetailModal = ({ audit, onClose, onDecision, isProcessing }) => {
  const [view, setView] = useState('intelligence'); // 'intelligence' | 'universal'
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
    const EXCLUDED_KEYS = ['Audit_Result', 'Audit_Intelligence', 'id', 'created_at'];
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
    if (docType === 'LR Copy' && addr) return <td key={docType} style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', opacity: 0.3 }}>N/A</td>;

    // LR Number is only applicable for LR Copy
    if (fieldBase === 'LR Number' && (docType === 'Invoice' || docType === 'E-Way Bill')) {
      return <td key={docType} style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', opacity: 0.3 }}>N/A</td>;
    }

    // E-Way Bill Number and Vehicle No are not applicable for Invoice
    if ((fieldBase === 'E-Way Bill Number' || fieldBase === 'Vehicle No') && docType === 'Invoice') {
      return <td key={docType} style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', opacity: 0.3 }}>N/A</td>;
    }

    // Batch / Coil Number is not applicable for E-Way Bill
    if (fieldBase === 'Batch / Coil Number' && docType === 'E-Way Bill') {
      return <td key={docType} style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', opacity: 0.3 }}>N/A</td>;
    }

    const status = addr ? getAddressStatus(fieldBase, docType, value) : null;
    const mismatch = !addr && hasMismatch(fieldMap[fieldBase], fieldBase);
    const filled = Object.values(fieldMap[fieldBase]).filter(v => v !== '—');
    const allMatch = !mismatch && filled.length >= 2 && value !== '—';

    let color = 'inherit';
    if (mismatch && value !== '—') color = '#ef4444';
    else if (allMatch) color = '#10b981';
    if (status === 'ok') color = '#10b981';
    if (status === 'fail') color = '#ef4444';

    return (
      <td key={docType} data-label={docType} style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)', wordBreak: 'break-word', fontWeight: 600, color }}>
        {value}
        {status && (
          <span style={{ marginLeft: '4px', fontSize: '0.7rem' }}>
            {status === 'ok' ? '✓' : '✗'}
          </span>
        )}
      </td>
    );
  };

  return (
    <div className="modal-overlay animate-fade-in" onClick={onClose}>
      <div className="modal-content animate-slide-up" style={{ maxWidth: view === 'universal' ? '1100px' : '750px', transition: 'max-width 0.3s ease' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="header-text-group">
            <h2 className="modal-title">
              <Info className="text-primary" size={24} /> 
              {view === 'intelligence' ? 'Audit Intelligence' : 'Universal Raw Data'}
            </h2>
            <p className="modal-subtitle">Ref: {audit.Invoice_Number_Invoice || audit.id}</p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              className="btn btn-outline btn-sm py-1 font-bold text-[10px] uppercase tracking-wider" 
              onClick={() => setView(view === 'intelligence' ? 'universal' : 'intelligence')}
            >
              {view === 'intelligence' ? 'Switch to Raw Data' : 'Back to Intelligence'}
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
            <div className="universal-table-wrapper animate-fade-in" style={{ padding: '0rem' }}>
              <table className="data-table" style={{ fontSize: '0.75rem', tableLayout: 'fixed', width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ background: 'transparent', opacity: 0.7, padding: '0.75rem', width: '20%' }}>Field</th>
                    <th style={{ background: 'transparent', opacity: 0.7, padding: '0.75rem' }}>Invoice</th>
                    <th style={{ background: 'transparent', opacity: 0.7, padding: '0.75rem' }}>E-Way Bill</th>
                    <th style={{ background: 'transparent', opacity: 0.7, padding: '0.75rem' }}>LR Copy</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(fieldMap).map(([fieldBase, vals]) => {
                    const mismatch = !isAddressField(fieldBase) && hasMismatch(vals, fieldBase);
                    return (
                      <tr key={fieldBase}>
                        <td data-label="Field Identity" className="font-bold tracking-tight" style={{ color: 'var(--text-muted)', padding: '0.75rem', borderBottom: '1px solid var(--border)' }}>
                          {fieldBase.replace(/_/g, ' ')}
                          {mismatch && <span style={{ color: '#ef4444', marginLeft: '6px', fontSize: '10px' }}>⚠ Mismatch</span>}
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
          <p className="text-[10px] text-muted italic">Double-check all cross-document discrepancies.</p>
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


