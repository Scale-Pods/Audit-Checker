import React, { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts'
import { Calendar, Filter, Download, RefreshCw, Loader2, AlertTriangle, TrendingUp, ShieldCheck, Zap, Activity, HardDrive, Hash, Truck, IndianRupee } from 'lucide-react'
import './Analytics.css'

const AUDITS_WEBHOOK_URL = import.meta.env.VITE_AUDITS_HISTORY_URL || 'https://n8n.srv1010832.hstgr.cloud/webhook/40a6351a-d510-492f-918b-7ec9bae2bd2a'

const AnalyticsCard = ({ title, value, subtitle }) => (
  <div className="card text-center analytics-metric" style={{
    padding: '2rem',
    borderLeft: '4px solid var(--primary)',
    background: '#1e293b',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.05)'
  }}>
    <p className="text-muted text-sm font-semibold uppercase tracking-wide mb-2">{title}</p>
    <h3 className="text-3xl font-bold text-gray-900 mb-1">{value}</h3>
    <p className="text-xs text-muted">{subtitle}</p>
  </div>
)

const Analytics = () => {
  const [audits, setAudits] = useState([])
  const [isLoading, setIsLoading] = useState(true)

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
      if (!response.ok) throw new Error('Link synchronization failed')
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
      setAudits(auditData)
    } catch (err) {
      console.error('Analytics Fetch Error:', err)
      setAudits([])
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalyticsData()
  }, [])

  const analyticsData = useMemo(() => {
    if (!audits.length) return { total: 0, errorRate: 0, trend: [], suppliers: [], health: 0, failedAudits: [] }

    const total = audits.length
    let mismatches = 0
    let totalScore = 0
    let itemsWithScores = 0

    const trendMap = {}
    const supplierMap = {}
    const failedAudits = []

    audits.forEach(a => {
      const result = parseAuditResult(a.Audit_Result);
      if (!result) return;

      const status = result?.overall?.status || a.Status;
      const scoreStr = result?.overall?.final_score;
      const score = scoreStr ? parseInt(scoreStr) : null;
      
      const isMismatch = status?.includes('MISMATCH') || status === 'Error' || status === 'PARTIAL_MATCH';
      if (isMismatch) {
        mismatches++;
        failedAudits.push(a);
      }

      if (score !== null) {
        totalScore += score;
        itemsWithScores++;
      }

      // Trend analysis
      const dateStr = a.created_at ? new Date(a.created_at).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : 'TBD'
      if (!trendMap[dateStr]) trendMap[dateStr] = { name: dateStr, Errors: 0, Matches: 0 }
      if (isMismatch) trendMap[dateStr].Errors++;
      else trendMap[dateStr].Matches++;

      // Supplier distribution
      const supplier = a.Supplier_Name_Invoice || 'Unknown'
      if (!supplierMap[supplier]) supplierMap[supplier] = { name: supplier, total: 0, errors: 0 }
      supplierMap[supplier].total++
      if (isMismatch) supplierMap[supplier].errors++
    })

    const errorRate = ((mismatches / total) * 100).toFixed(1)
    const health = itemsWithScores > 0 ? Math.round(totalScore / itemsWithScores) : 100 - parseFloat(errorRate)

    const trend = Object.values(trendMap).slice(-10)

    return { total, errorRate, trend, health, failedAudits }
  }, [audits])

  const handleRefresh = () => {
    fetchAnalyticsData(false)
  }

  if (isLoading) {
    return (
      <div className="flex-center" style={{ height: '70vh', flexDirection: 'column', gap: '1.5rem' }}>
        <Loader2 className="animate-spin text-primary" size={48} />
        <p className="text-muted font-black tracking-widest uppercase text-xs">Generating Compliance Projections...</p>
      </div>
    )
  }

  return (
    <div className="analytics-page px-8 pb-12 bg-[#0f172a] min-h-screen text-[#f8fafc]">
      <div className="page-header flex justify-between items-start mb-12">
        <div className="header-text-group">
          <h1 className="page-title text-3xl font-black tracking-tighter text-white">System Analytics Intelligence</h1>
          <p className="page-subtitle text-xs uppercase font-black tracking-widest text-slate-400 opacity-70 mt-1">Advanced compliance distribution & trend modeling</p>
        </div>
        <div className="flex gap-4 header-actions">
          <button className="btn btn-secondary py-2 flex items-center gap-2 border-slate-700 hover:bg-slate-800" onClick={handleRefresh}>
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} /> Refresh Intelligence
          </button>
        </div>
      </div>

      <div className="analytics-metrics-grid mb-12">
        <AnalyticsCard 
          title="Consolidated Audits" 
          value={analyticsData.total} 
          subtitle="Total document lifecycle events" 
        />
        <AnalyticsCard 
          title="Global Discrepancy Rate" 
          value={`${analyticsData.errorRate}%`} 
          subtitle="Aggregate mismatch percentage" 
        />
        <AnalyticsCard 
          title="Integrity Index (Health)" 
          value={analyticsData.health + '/100'} 
          subtitle="Based on confidence scores" 
        />
      </div>

      <div className="charts-grid-half mb-12">
        <div className="card shadow-2xl border-0 bg-[#1e293b] rounded-2xl border border-slate-800">
          <div className="card-header pb-6 border-b border-slate-800 mb-6 pt-8 px-8 bg-slate-900/40 rounded-t-2xl">
            <h3 className="card-title text-sm font-black uppercase tracking-widest flex items-center gap-2 text-white/90">
              <TrendingUp size={18} className="text-primary" /> Error Incidence Projection
            </h3>
          </div>
          <div className="chart-container px-8 pb-8">
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={analyticsData.trend} margin={{ top: 20, right: 30, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255, 255, 255, 0.05)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 700}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10}} />
                <RechartsTooltip 
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '12px',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
                    color: '#f8fafc'
                  }}
                  itemStyle={{ color: '#f8fafc', fontSize: '11px' }}
                />
                <Line type="stepAfter" name="Mismatches" dataKey="Errors" stroke="#ef4444" strokeWidth={4} dot={{r: 4, fill: '#ef4444'}} activeDot={{r: 6}} />
                <Line type="monotone" name="Success" dataKey="Matches" stroke="#10b981" strokeWidth={2} strokeDasharray="5 5" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card shadow-2xl border-0 bg-[#1e293b] rounded-2xl border border-slate-800">
           <div className="card-header pb-6 border-b border-slate-800 mb-6 pt-8 px-8 bg-slate-900/40 rounded-t-2xl">
            <h3 className="card-title text-sm font-black uppercase tracking-widest flex items-center gap-2 text-white/90">
              <RefreshCw size={18} className="text-secondary" /> Historical Integrity Log
            </h3>
          </div>
          <div className="chart-container px-8 pb-8">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={analyticsData.trend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255, 255, 255, 0.05)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 700}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 10}} />
                <RechartsTooltip 
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '12px',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
                    color: '#f8fafc'
                  }}
                  itemStyle={{ color: '#f8fafc', fontSize: '11px' }}
                />
                <Bar name="Audited Count" dataKey="Errors" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card table-card overflow-hidden border-0 shadow-2xl bg-[#1e293b] mb-12 border border-slate-800 rounded-2xl">
        <div className="card-header flex justify-between items-center border-b border-slate-800 p-10 bg-slate-900/40">
          <div>
            <h3 className="text-lg font-black text-white flex items-center gap-3">
              <AlertTriangle className="text-error" size={24} /> Integrity Discrepancy Snapshot
            </h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase mt-1 tracking-widest">Direct drill-down for high-risk audits</p>
          </div>
          <span className="text-[10px] bg-error/10 text-error px-4 py-2 rounded-full font-black uppercase tracking-widest border border-error/20">Action Required</span>
        </div>
        <div className="table-responsive">
          <table className="data-table w-full">
            <thead>
              <tr className="bg-slate-900/20 text-slate-400">
                <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-left">Invoice Identity</th>
                <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-left">Supplier Asset</th>
                <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-left">Transactional Value</th>
                <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-left">Discrepancy Detail</th>
                <th className="px-10 py-6 text-[10px] font-black uppercase tracking-widest text-center">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {analyticsData.failedAudits.length > 0 ? (
                analyticsData.failedAudits.map((audit) => {
                  const result = parseAuditResult(audit.Audit_Result);
                  const score = result?.overall?.final_score || 'N/A';
                  
                  return (
                    <tr key={audit.id} className="hover:bg-slate-800/40 transition-colors border-slate-800 cursor-pointer group">
                      <td className="px-10 py-8">
                         <div className="flex flex-col">
                            <span className="font-black text-white group-hover:text-primary transition-colors">{audit.Invoice_Number_Invoice || 'N/A'}</span>
                            <span className="text-[10px] text-slate-500 font-bold mt-1 tracking-tight">REF: {audit.id}</span>
                         </div>
                      </td>
                      <td className="px-10 py-8 font-bold text-slate-300">{audit.Supplier_Name_Invoice || 'Unknown'}</td>
                      <td className="px-10 py-8 font-black text-primary text-lg">₹{(parseFloat(audit.Total_Amount_Invoice) / 100000).toFixed(2)} L</td>
                      <td className="px-10 py-8">
                         <div className="flex items-center gap-3 text-error/80">
                            <AlertTriangle size={16} />
                            <span className="text-[11px] font-black uppercase tracking-tight">
                               {result?.issues?.[0]?.replace(/_/g, ' ') || 'Manual Flag'}
                            </span>
                         </div>
                      </td>
                      <td className="px-10 py-8 text-center">
                         <div className="inline-block px-5 py-2 rounded-xl bg-error/5 text-error font-black text-lg border border-error/10">
                            {score}
                         </div>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan="5" className="text-center p-32 text-slate-500 italic font-medium">
                    No active lifecycle discrepancies mapped to registry.
                  </td>
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
