import React, { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts'
import { Calendar, Filter, Download, RefreshCw, Loader2, AlertTriangle, TrendingUp, ShieldCheck, Zap, Activity, HardDrive, Hash, Truck, IndianRupee } from 'lucide-react'
import './Analytics.css'

const AUDITS_WEBHOOK_URL = import.meta.env.VITE_AUDITS_HISTORY_URL || 'https://n8n.srv1010832.hstgr.cloud/webhook/40a6351a-d510-492f-918b-7ec9bae2bd2a'

const AnalyticsCard = ({ title, value, subtitle, icon: Icon, color = 'var(--primary)' }) => (
  <div className="card analytics-metric glass" style={{
    padding: '1.75rem',
    background: 'rgba(30, 41, 59, 0.5)',
    borderRadius: '24px',
    border: '1px solid rgba(255, 255, 255, 0.05)',
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
    <h3 className="text-2xl font-black text-white mb-1 tracking-tighter" style={{ textShadow: '0 0 20px rgba(255,255,255,0.05)' }}>{value}</h3>
    <p className="text-[10px] font-bold text-slate-500">{subtitle}</p>
    <div className="absolute top-0 right-0 w-32 h-32 opacity-10 pointer-events-none" 
         style={{ background: `radial-gradient(circle at top right, ${color}, transparent)` }}></div>
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
    if (!audits.length) return { total: 0, errorRate: 0, trend: [], health: 0, failedAudits: [], savings: 0 }

    const total = audits.length
    let mismatches = 0
    let totalScore = 0
    let itemsWithScores = 0
    let estimatedSavings = 0

    const trendMap = {}
    const failedAudits = []

    audits.forEach(a => {
      const result = parseAuditResult(a.Audit_Result || a.Audit_Intelligence);
      
      const status = (result?.overall?.status || a.Status || '').toUpperCase();
      const scoreStr = result?.overall?.final_score;
      const score = scoreStr ? parseInt(scoreStr) : null;
      
      const isMismatch = status.includes('MISMATCH') || status.includes('ERROR') || status.includes('PARTIAL') || status.includes('HIGH_RISK');
      
      if (isMismatch) {
        mismatches++;
        failedAudits.push(a);
        const amtStr = (a.Total_Amount_Invoice || '0').toString().replace(/[^0-9.-]/g, '');
        const amt = parseFloat(amtStr) || 0;
        estimatedSavings += (amt * 0.15); // Logic: Catching a mismatch saves ~15% overhead
      }

      if (score !== null) {
        totalScore += score;
        itemsWithScores++;
      }

      // Trend analysis (Last 7 days)
      const dateStr = a.created_at ? new Date(a.created_at).toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : 'TBD'
      if (!trendMap[dateStr]) trendMap[dateStr] = { name: dateStr, Errors: 0, Matches: 0, Total: 0 }
      trendMap[dateStr].Total++;
      if (isMismatch) trendMap[dateStr].Errors++;
      else trendMap[dateStr].Matches++;
    })

    const errorRate = ((mismatches / total) * 100).toFixed(1)
    const health = itemsWithScores > 0 ? Math.round(totalScore / itemsWithScores) : Math.max(0, 100 - Math.round(parseFloat(errorRate)));

    const trend = Object.values(trendMap).slice(-7)
    const savings = estimatedSavings;

    return { total, errorRate, trend, health, failedAudits, savings }
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
    <div className="analytics-page px-8 pb-12 bg-[#0a0f1c] min-h-screen text-[#f8fafc]">
      <div className="page-header flex justify-between items-start mb-10 pt-8">
        <div className="header-text-group">
          <h1 className="page-title text-4xl font-black tracking-tighter text-white">System Analytics Intelligence</h1>
          <p className="page-subtitle text-[10px] uppercase font-black tracking-widest text-slate-500 mt-2">Advanced compliance distribution & trend modeling</p>
        </div>
        <div className="flex gap-4 header-actions pt-2">
          <button className="btn btn-secondary py-2.5 px-6 rounded-xl font-black uppercase text-[10px] tracking-widest flex items-center gap-2 border-slate-700 hover:bg-slate-800 transition-all" onClick={handleRefresh}>
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} /> Refresh Intelligence
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
        <AnalyticsCard 
          title="Consolidated Audits" 
          value={analyticsData.total} 
          subtitle="Total document lifecycle events"
          icon={Activity}
          color="#3b82f6"
        />
        <AnalyticsCard 
          title="Discrepancy Rate" 
          value={`${analyticsData.errorRate}%`} 
          subtitle="Aggregate mismatch percentage"
          icon={Zap}
          color="#f59e0b"
        />
        <AnalyticsCard 
          title="Integrity Index (Health)" 
          value={analyticsData.health + '/100'} 
          subtitle="Based on confidence scores"
          icon={ShieldCheck}
          color="#10b981"
        />
        <AnalyticsCard 
          title="Est. Savings Managed" 
          value={`₹${(analyticsData.savings / 100000).toFixed(2)}L`} 
          subtitle="Error prevention impact"
          icon={IndianRupee}
          color="#ec4899"
        />
      </div>

      <div className="charts-grid-half mb-12">
        <div className="card shadow-2xl border-0 bg-[#1e293b]/40 rounded-[32px] border border-slate-800/50 backdrop-blur-xl">
          <div className="card-header pb-6 border-b border-slate-800/50 mb-6 pt-10 px-10">
            <h3 className="card-title text-[11px] font-black uppercase tracking-widest flex items-center gap-3 text-slate-400">
              <TrendingUp size={18} className="text-primary" /> Error Incidence Projection
            </h3>
          </div>
          <div className="chart-container px-6 pb-10">
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={analyticsData.trend} margin={{ top: 20, right: 30, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255, 255, 255, 0.03)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 10, fontWeight: 800}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 10}} />
                <RechartsTooltip 
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '16px',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
                    color: '#f8fafc',
                    padding: '12px'
                  }}
                  itemStyle={{ color: '#f8fafc', fontSize: '11px', fontWeight: 700 }}
                />
                <Line type="monotone" name="Success" dataKey="Matches" stroke="#10b981" strokeWidth={3} dot={{r: 4, fill: '#10b981'}} activeDot={{r: 6}} />
                <Line type="monotone" name="Mismatches" dataKey="Errors" stroke="#ef4444" strokeWidth={3} strokeDasharray="4 4" dot={{r: 3, fill: '#ef4444'}} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card shadow-2xl border-0 bg-[#1e293b]/40 rounded-[32px] border border-slate-800/50 backdrop-blur-xl">
           <div className="card-header pb-6 border-b border-slate-800/50 mb-6 pt-10 px-10">
            <h3 className="card-title text-[11px] font-black uppercase tracking-widest flex items-center gap-3 text-slate-400">
              <Activity size={18} className="text-secondary" /> Volume Distribution
            </h3>
          </div>
          <div className="chart-container px-6 pb-10">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={analyticsData.trend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255, 255, 255, 0.03)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 10, fontWeight: 800}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 10}} />
                <RechartsTooltip 
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '16px',
                    color: '#f8fafc'
                  }}
                  itemStyle={{ color: '#f8fafc', fontSize: '11px' }}
                />
                <Bar name="Audited Count" dataKey="Total" fill="#3b82f6" radius={[6, 6, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card table-card overflow-hidden border-0 shadow-3xl bg-[#1e293b]/20 mb-12 border border-slate-800/40 rounded-[32px] backdrop-blur-sm">
        <div className="card-header flex justify-between items-center border-b border-slate-800/40 p-10 bg-slate-900/30">
          <div>
            <h3 className="text-2xl font-black text-white flex items-center gap-4 tracking-tighter">
              <AlertTriangle className="text-error" size={28} /> Integrity Discrepancy Snapshot
            </h3>
            <p className="text-[10px] text-slate-500 font-black uppercase mt-1 tracking-widest">Active high-risk document lifecycle monitoring</p>
          </div>
          <span className="text-[10px] bg-error/10 text-error px-5 py-2.5 rounded-full font-black uppercase tracking-widest border border-error/20 shadow-lg shadow-error/5 pulse-subtle">Critical Action Required</span>
        </div>
        <div className="table-responsive">
          <table className="data-table w-full">
            <thead>
              <tr className="bg-slate-950/20 text-slate-500">
                <th className="px-10 py-7 text-[10px] font-black uppercase tracking-widest text-left">Invoice Identity</th>
                <th className="px-10 py-7 text-[10px] font-black uppercase tracking-widest text-left">Supplier Asset</th>
                <th className="px-10 py-7 text-[10px] font-black uppercase tracking-widest text-left">Transactional Value</th>
                <th className="px-10 py-7 text-[10px] font-black uppercase tracking-widest text-left">Discrepancy Detail</th>
                <th className="px-10 py-7 text-[10px] font-black uppercase tracking-widest text-center">Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/30">
              {analyticsData.failedAudits.length > 0 ? (
                analyticsData.failedAudits.map((audit) => {
                  const result = parseAuditResult(audit.Audit_Result || audit.Audit_Intelligence);
                  const score = result?.overall?.final_score || 'N/A';
                  const amount = parseFloat((audit.Total_Amount_Invoice || '0').toString().replace(/[^0-9.-]/g, '')) || 0;
                  
                  return (
                    <tr key={audit.id} className="hover:bg-slate-800/30 transition-all border-slate-800/20 cursor-pointer group">
                      <td data-label="Invoice Identity" className="px-10 py-10">
                         <div className="flex flex-col">
                            <span className="font-black text-white text-lg tracking-tight group-hover:text-primary transition-colors">{audit.Invoice_Number_Invoice || 'N/A'}</span>
                            <span className="text-[10px] text-slate-600 font-black mt-1 tracking-widest">REF: {audit.id?.slice(0, 8)}</span>
                         </div>
                      </td>
                      <td data-label="Supplier Asset" className="px-10 py-10">
                        <span className="font-bold text-slate-400 group-hover:text-slate-200 transition-colors uppercase text-xs tracking-wide">
                          {audit.Supplier_Name_Invoice || 'Unknown Entity'}
                        </span>
                      </td>
                      <td data-label="Transactional Value" className="px-10 py-10">
                        <div className="flex flex-col">
                          <span className="font-black text-white text-xl">₹{(amount / 100000).toFixed(2)}L</span>
                          <span className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">Gross Value</span>
                        </div>
                      </td>
                      <td data-label="Discrepancy Detail" className="px-10 py-10">
                         <div className="flex items-center gap-3 text-error/90 bg-error/5 p-3 rounded-xl border border-error/10 w-fit">
                            <AlertTriangle size={14} />
                            <span className="text-[10px] font-black uppercase tracking-tight">
                               {result?.issues?.[0]?.replace(/_/g, ' ') || 'Integrity Violation Detected'}
                            </span>
                         </div>
                      </td>
                      <td data-label="Health" className="px-10 py-10 text-center">
                         <div className="inline-block px-6 py-2 rounded-[20px] bg-slate-950/40 text-error font-black text-xl border border-white/5 shadow-inner">
                            {score}
                         </div>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan="5" className="text-center p-32 text-slate-500 italic font-medium">
                    <div className="flex flex-col items-center gap-6 opacity-30">
                       <ShieldCheck size={64} />
                       <span className="uppercase tracking-[0.4em] text-[10px] font-black">Zero Integrity Violations Mapped</span>
                    </div>
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
