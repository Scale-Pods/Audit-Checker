import React, { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts'
import { RefreshCw, Loader2, AlertTriangle, TrendingUp, ShieldCheck, Zap, Activity, IndianRupee } from 'lucide-react'
import './Analytics.css'

const AUDITS_WEBHOOK_URL = import.meta.env.VITE_AUDITS_HISTORY_URL || 'https://n8n.srv1010832.hstgr.cloud/webhook/40a6351a-d510-492f-918b-7ec9bae2bd2a'

const AnalyticsCard = ({ title, value, subtitle, icon: Icon, color = 'var(--primary)' }) => (
  <div className="card analytics-metric glass" style={{
    padding: '1.75rem',
    background: 'var(--surface)',
    borderRadius: '24px',
    border: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
    overflow: 'hidden'
  }}>
    <div className="flex justify-between items-start mb-4">
      <div className="p-3 rounded-xl" style={{ background: `${color}10`, color: color }}>
        {Icon && <Icon size={20} />}
      </div>
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500 opacity-60">Real-time Optic</div>
    </div>
    <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mb-1">{title}</p>
    <h3 className="text-2xl font-black text-white mb-1 tracking-tighter" style={{ color: 'var(--text)' }}>{value}</h3>
    <p className="text-[10px] font-bold text-slate-500">{subtitle}</p>
    <div className="absolute top-0 right-0 w-32 h-32 opacity-10 pointer-events-none" 
         style={{ background: `radial-gradient(circle at top right, ${color}, transparent)` }}></div>
  </div>
)

const Analytics = () => {
  const [audits, setAudits] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const isDarkMode = document.documentElement.getAttribute('data-theme') === 'dark';

  const parseAuditResult = (resultStr) => {
    if (!resultStr) return null;
    try {
      const parsed = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;
      return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch {
      return null;
    }
  }

  const fetchAnalyticsData = async (showLoading = true) => {
    if (showLoading) setIsLoading(true)
    try {
      const response = await fetch(AUDITS_WEBHOOK_URL)
      if (!response.ok) throw new Error('Data sync failed')
      const data = await response.json()
      
      let auditData = [];
      if (Array.isArray(data)) {
        auditData = data;
      } else if (data && data.audits && Array.isArray(data.audits)) {
        auditData = data.audits;
      } else if (data && data.data && Array.isArray(data.data)) {
        auditData = data.data;
      }
      
      setAudits(auditData || [])
    } catch (err) {
      console.error('Fetch Error:', err)
      setAudits([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalyticsData()
  }, [])

  const analyticsData = useMemo(() => {
    const defaultData = { total: 0, errorRate: '0.0', trend: [], health: 0, failedAudits: [], savings: 0 };
    if (!Array.isArray(audits) || audits.length === 0) return defaultData;

    try {
      let mismatches = 0
      let totalScore = 0
      let itemsWithScores = 0
      let estimatedSavings = 0
      const trendMap = {}
      const failedAudits = []

      audits.forEach(a => {
        if (!a) return;
        const result = parseAuditResult(a.Audit_Result || a.Audit_Intelligence || a.audit_result);
        const status = String(result?.overall?.status || a.Status || a.status || '').toUpperCase();
        const scoreVal = result?.overall?.final_score || result?.score || a.Score || a.score;
        const score = scoreVal ? parseInt(scoreVal) : null;
        
        const isMismatch = status.includes('MISMATCH') || status.includes('ERROR') || status.includes('PARTIAL') || status.includes('VIOLATION');
        
        if (isMismatch) {
          mismatches++;
          failedAudits.push(a);
          const amt = parseFloat(String(a.Total_Amount_Invoice || a.Amount || '0').replace(/[^0-9.-]/g, '')) || 0;
          estimatedSavings += (amt * 0.15);
        }

        if (score !== null && !isNaN(score)) {
          totalScore += score;
          itemsWithScores++;
        }

        const date = a.created_at ? new Date(a.created_at) : new Date();
        const dateStr = isNaN(date.getTime()) ? 'TBD' : date.toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
        
        if (!trendMap[dateStr]) trendMap[dateStr] = { name: dateStr, Errors: 0, Matches: 0, Total: 0 }
        trendMap[dateStr].Total++;
        if (isMismatch) trendMap[dateStr].Errors++;
        else trendMap[dateStr].Matches++;
      })

      const total = audits.length
      const errorRate = ((mismatches / total) * 100).toFixed(1)
      const health = itemsWithScores > 0 ? Math.round(totalScore / itemsWithScores) : Math.max(0, 100 - Math.round(parseFloat(errorRate)));
      const trend = Object.values(trendMap).slice(-7)

      return { total, errorRate, trend, health, failedAudits, savings: estimatedSavings }
    } catch (e) {
      console.error('Memo Error:', e);
      return defaultData;
    }
  }, [audits])

  if (isLoading) {
    return (
      <div className="flex-center" style={{ height: '70vh', flexDirection: 'column', gap: '1.5rem', background: 'var(--background)' }}>
        <Loader2 className="animate-spin text-primary" size={48} />
        <p className="text-muted font-black tracking-widest uppercase text-xs">Intelligence Synchronization...</p>
      </div>
    )
  }

  return (
    <div className="analytics-page px-8 pb-12 bg-[var(--background)] min-h-screen text-[var(--text)]">
      <div className="page-header flex flex-col items-start mb-8 pt-8 px-4">
        <div className="header-text-group w-full mb-6">
          <h1 className="page-title text-3xl font-black tracking-tighter text-[var(--text)]">System Analytics Intelligence</h1>
          <p className="page-subtitle text-[10px] uppercase font-black tracking-widest text-slate-500 mt-2">Operational surveillance modeling</p>
        </div>
        <button className="btn btn-secondary w-full py-3 rounded-xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 border-slate-700" onClick={() => fetchAnalyticsData(false)}>
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /> Refresh Trace
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        <AnalyticsCard title="Total Audits" value={analyticsData.total} subtitle="Document lifecycle events" icon={Activity} color="#3b82f6" />
        <AnalyticsCard title="Error Rate" value={`${analyticsData.errorRate}%`} subtitle="Aggregate mismatch index" icon={Zap} color="#f59e0b" />
        <AnalyticsCard title="Health Index" value={`${analyticsData.health}/100`} subtitle="Compliance confidence" icon={ShieldCheck} color="#10b981" />
        <AnalyticsCard title="Est. Impact" value={`₹${(analyticsData.savings / 100000).toFixed(2)}L`} subtitle="Intervention value" icon={IndianRupee} color="#ec4899" />
      </div>

      <div className="charts-grid-half mb-12">
        <div className="card shadow-2xl bg-[var(--surface)] glass rounded-[32px] p-10 border border-[var(--border)]">
          <h3 className="card-title text-[11px] font-black uppercase tracking-widest mb-6 flex items-center gap-2 text-[var(--text-muted)]">
            <TrendingUp size={16} className="text-primary" /> Compliance Trend
          </h3>
          <div style={{ height: '300px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={analyticsData.trend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 10}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 10}} />
                <RechartsTooltip 
                  contentStyle={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    color: 'var(--text)'
                  }}
                  itemStyle={{ color: 'var(--text)' }}
                />
                <Line type="monotone" dataKey="Matches" stroke="#10b981" strokeWidth={3} dot={{r: 4}} />
                <Line type="monotone" dataKey="Errors" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card shadow-2xl bg-[var(--surface)] glass rounded-[32px] p-10 border border-[var(--border)]">
          <h3 className="card-title text-[11px] font-black uppercase tracking-widest mb-6 flex items-center gap-2 text-[var(--text-muted)]">
            <Activity size={16} className="text-secondary" /> Volume Analysis
          </h3>
          <div style={{ height: '300px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analyticsData.trend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 10}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 10}} />
                <RechartsTooltip 
                  contentStyle={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    color: 'var(--text)'
                  }}
                  itemStyle={{ color: 'var(--text)' }}
                />
                <Bar dataKey="Total" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card bg-[var(--surface)] rounded-[32px] overflow-hidden border border-[var(--border)] shadow-xl">
        <div className="card-header p-10 border-b border-[var(--border)] bg-[var(--background)]">
          <h3 className="text-xl font-black text-[var(--text)] flex items-center gap-3">
             <AlertTriangle className="text-error" size={20} /> Discrepancy Snapshot
          </h3>
        </div>
        <div className="table-responsive">
          <table className="data-table w-full">
            <thead>
              <tr className="text-[var(--text)] bg-[var(--background)] font-black">
                <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-left">Identity</th>
                <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-left">Supplier</th>
                <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-left">Amount</th>
                <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-center">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {analyticsData.failedAudits.length > 0 ? (
                analyticsData.failedAudits.map((a, i) => (
                  <tr key={a.id || i} className="hover:bg-[var(--background)] transition-colors">
                    <td className="px-10 py-8 font-black text-[var(--text)]">{a.Invoice_Number_Invoice || 'N/A'}</td>
                    <td className="px-10 py-8 text-[var(--text-muted)] text-xs">{a.Supplier_Name_Invoice || 'Unknown'}</td>
                    <td className="px-10 py-8 font-bold text-[var(--text)]">₹{parseFloat(String(a.Total_Amount_Invoice || '0').replace(/[^0-9.-]/g, '')).toLocaleString()}</td>
                    <td className="px-10 py-8 text-center">
                      <span className="bg-error/10 text-error px-4 py-2 rounded-full font-black text-xs">
                        {parseAuditResult(a.Audit_Result)?.overall?.final_score || 'N/A'}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="4" className="p-20 text-center text-slate-500 uppercase tracking-widest text-[10px]">Zero Violations Detected</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default Analytics
