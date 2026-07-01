import React, { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { UploadCloud, File as FileIcon, FileText, CheckCircle, AlertTriangle, ArrowRight, X, Send, Mail, Loader2, XCircle, Info, ChevronRight, Check, ClipboardList, Scale, ShoppingCart } from 'lucide-react'
import '../Purchase/PurchaseAudit.css'

const DocumentUpload = ({ title, accepted, onUpload, files, isSubmitted, multiple }) => {
  const onDrop = useCallback(acceptedFiles => {
    if (multiple) {
      onUpload(prev => [...prev, ...acceptedFiles])
    } else if (acceptedFiles.length > 0) {
      onUpload(acceptedFiles[0])
    }
  }, [onUpload, multiple])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: accepted,
    multiple: !!multiple
  })

  const renderFilePreview = (f, index) => (
    <div key={index || 0} className="file-preview animate-scale-in">
      <FileIcon className="file-icon" size={32} />
      <div className="file-info">
        <span className="file-name" style={{ fontSize: '1.1rem' }}>{f.name}</span>
        <span className="file-size">{(f.size / 1024).toFixed(2)} KB</span>
      </div>
      {!isSubmitted && (
        <button className="remove-btn" onClick={(e) => {
          e.stopPropagation();
          onUpload(prev => prev.filter((_, i) => i !== index))
        }}>
          <X size={20} />
        </button>
      )}
    </div>
  )

  const hasFiles = files && files.length > 0

  return (
    <div className={`upload-box card ${isSubmitted ? 'card-submitted' : ''} ${multiple ? 'bulk-upload-box' : ''}`} style={{ transition: 'all 0.4s', height: '100%' }}>
      <h3 className="upload-title text-primary flex items-center gap-2" style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>
        <UploadCloud size={24} /> {title}
      </h3>
      
      {!hasFiles ? (
        <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''} ${multiple ? 'bulk-dropzone' : ''}`}>
          <input {...getInputProps()} />
          <UploadCloud size={80} className="drop-icon" style={{ opacity: 0.7, marginBottom: '1.5rem' }} />
          <p className="drop-text" style={{ fontSize: '1.5rem', fontWeight: '700' }}>Drag & drop files here</p>
          <span className="drop-subtext" style={{ fontSize: '1rem' }}>or click to browse from folder</span>
        </div>
      ) : (
        <div className="file-list-container">
          {files.map((f, i) => renderFilePreview(f, i))}
          
          {!isSubmitted && (
            <div {...getRootProps()} className="dropzone-mini" style={{ padding: '1.5rem', borderStyle: 'solid', borderWidth: '2px' }}>
              <input {...getInputProps()} />
              <span style={{ fontSize: '1rem' }}>+ Add more files</span>
            </div>
          )}

          {isSubmitted && (
            <div className="submit-success" style={{ padding: '1.5rem' }}>
              <CheckCircle size={24} />
              <span style={{ fontSize: '1.1rem' }}>All files submitted successfully!</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const SALES_WEBHOOK_URL = import.meta.env.VITE_SALES_WEBHOOK_URL || 'https://n8n.srv1010832.hstgr.cloud/webhook/365acab8-8d63-48bc-8ac9-0e079ecba8db'

const SalesAudit = () => {
  const [result, setResult] = useState(null)
  const [activeStep, setActiveStep] = useState(0)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [allDone, setAllDone] = useState(false)
  const [submitError, setSubmitError] = useState(null)

  const [invoiceFiles, setInvoiceFiles] = useState([])
  const [gatepassFiles, setGatepassFiles] = useState([])
  const [weightslipFiles, setWeightslipFiles] = useState([])
  const [purchaseOrderFiles, setPurchaseOrderFiles] = useState([])

  const [webhookResponse, setWebhookResponse] = useState(null)

  // Paste handler
  useEffect(() => {
    const handlePaste = (e) => {
      const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
      if (!items) return;

      for (const item of items) {
        if (item.kind === 'file') {
          const blob = item.getAsFile();
          if (blob && blob.type.startsWith('image/')) {
            const pastedFile = new File([blob], `Pasted-Image-${Date.now()}.png`, { type: blob.type });
            if (activeStep === 0) setInvoiceFiles(prev => [...prev, pastedFile]);
            if (activeStep === 1) setGatepassFiles(prev => [...prev, pastedFile]);
            if (activeStep === 2) setWeightslipFiles(prev => [...prev, pastedFile]);
            if (activeStep === 3) setPurchaseOrderFiles(prev => [...prev, pastedFile]);
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [activeStep]);

  const handleSubmitAll = async () => {
    let uploads = []
    invoiceFiles.forEach(f => uploads.push({ file: f, name: 'Invoice' }))
    gatepassFiles.forEach(f => uploads.push({ file: f, name: 'Gatepass' }))
    weightslipFiles.forEach(f => uploads.push({ file: f, name: 'Weightslip' }))
    purchaseOrderFiles.forEach(f => uploads.push({ file: f, name: 'PurchaseOrder' }))

    if (uploads.length === 0) return
    setIsSubmitting(true)
    setSubmitError(null)
    setAllDone(true)
    setActiveStep(4)

    try {
      const formData = new FormData()
      
      uploads.forEach((item) => {
        const ext = item.file.name.includes('.') ? '.' + item.file.name.split('.').pop() : ''
        const fileName = `${item.name}${ext}`
        const renamed = new File([item.file], fileName, { type: item.file.type })
        formData.append(item.name, renamed, fileName)
      })

      const res = await fetch(SALES_WEBHOOK_URL, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} – ${text.slice(0, 200)}`)
      }

      const responseText = await res.text();
      let data;
      try {
        data = responseText ? JSON.parse(responseText) : { status: 'success', message: 'Documents received' };
      } catch {
        data = { status: 'success', raw: responseText };
      }

      setWebhookResponse(data)
      if (data && data.status && data.data && !data.raw) setResult(data)
    } catch (err) {
      console.error('[Submit] Error:', err)
      setSubmitError(err.message || 'Failed to send.')
      setAllDone(false)
      setActiveStep(3)
    } finally {
      setIsSubmitting(false)
    }
  }

  const steps = [
    { label: 'Sales Invoice', files: invoiceFiles, status: invoiceFiles.length > 0 ? 'Ready' : 'Pending', icon: FileText },
    { label: 'Gatepass', files: gatepassFiles, status: gatepassFiles.length > 0 ? 'Ready' : 'Pending', icon: ClipboardList },
    { label: 'Weightslip', files: weightslipFiles, status: weightslipFiles.length > 0 ? 'Ready' : 'Pending', icon: Scale },
    { label: 'Purchase Order', files: purchaseOrderFiles, status: purchaseOrderFiles.length > 0 ? 'Ready' : 'Pending', icon: ShoppingCart }
  ]

  const nextStep = () => {
    if (activeStep < 3) setActiveStep(activeStep + 1)
  }

  const prevStep = () => {
    if (activeStep > 0) setActiveStep(activeStep - 1)
  }

  const renderWebhookResponse = () => {
    if (!webhookResponse) return null;

    let tableData = null;
    let overallStatus = null;
    let confidence = null;
    let notes = null;

    try {
      const dataObj = Array.isArray(webhookResponse) ? webhookResponse[0] : webhookResponse;
      
      const extractInfo = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        const table = obj.comparison_table || (obj.data && obj.data.comparison_table);
        if (!table) return null;
        
        return {
          table,
          status: obj.status || (obj.data && obj.data.status),
          confidence: obj.confidence || (obj.data && obj.data.confidence),
          notes: obj.notes || (obj.data && obj.data.notes)
        };
      };

      let results = extractInfo(dataObj);

      if (!results && dataObj.raw && typeof dataObj.raw === 'object') {
        results = extractInfo(dataObj.raw);
      }
      if (!results && dataObj.data && typeof dataObj.data === 'object') {
        results = extractInfo(dataObj.data);
      }

      if (!results) {
        const rawString = dataObj.output || (typeof dataObj.raw === 'string' ? dataObj.raw : null);
        if (rawString) {
          const cleanJson = rawString.replace(/```json\n?|```/g, '').trim();
          const parsed = JSON.parse(cleanJson);
          results = extractInfo(parsed);
        }
      }

      if (results) {
        tableData = results.table;
        overallStatus = results.status;
        confidence = results.confidence;
        notes = results.notes;
      }
    } catch (e) {
      console.warn('[SalesAudit] Discovery error:', e);
    }

    if (tableData && Array.isArray(tableData) && tableData.length > 0) {
      const isFullMatch = overallStatus?.includes('MATCH') && !overallStatus?.includes('PARTIAL');
      
      return (
        <div className="webhook-output animate-fade-in" style={{ marginTop: '2.5rem' }}>
          <div className="card" style={{ padding: '0', overflow: 'hidden', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)' }}>
            
            <div style={{ 
              display: 'flex', 
              flexWrap: 'wrap', 
              alignItems: 'center', 
              justifyContent: 'space-between', 
              gap: '1.5rem', 
              padding: '1.75rem', 
              borderBottom: '1px solid var(--border)',
              background: isFullMatch ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, transparent 100%)' : 'linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, transparent 100%)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                <div style={{ 
                  padding: '0.85rem', 
                  borderRadius: '14px', 
                  backgroundColor: isFullMatch ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                  color: isFullMatch ? 'var(--success)' : 'var(--warning)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <CheckCircle size={32} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.4rem', fontWeight: '800', fontFamily: 'Outfit, sans-serif', color: 'var(--text)' }}>
                    AI Audit Analysis
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.4rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: '500' }}>
                       <FileText size={14} style={{ color: 'var(--primary)' }}/> Scan verified successfully
                    </div>
                    <span style={{ 
                      fontSize: '10px', 
                      textTransform: 'uppercase', 
                      letterSpacing: '0.08em', 
                      fontWeight: '700', 
                      padding: '2px 8px', 
                      borderRadius: '4px', 
                      backgroundColor: 'rgba(100, 116, 139, 0.1)', 
                      color: 'var(--text-muted)',
                      border: '1px solid rgba(100, 116, 139, 0.1)'
                    }}>Standard</span>
                  </div>
                </div>
              </div>
              
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2rem' }}>
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <p style={{ fontSize: '10px', color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: '950', margin: 0, opacity: 0.6 }}>Audit Status</p>
                    <div style={{ 
                      fontSize: '11px', 
                      fontWeight: '800', 
                      padding: '0.5rem 1.5rem', 
                      borderRadius: '50px', 
                      textTransform: 'uppercase', 
                      letterSpacing: '0.08em', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.6rem',
                      backgroundColor: isFullMatch ? 'var(--success)' : 'var(--error)',
                      color: 'white',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                    }}>
                      {isFullMatch ? <CheckCircle size={14}/> : <AlertTriangle size={14}/>}
                      {overallStatus?.replace(/_/g, ' ')}
                    </div>
                 </div>
                 
                 {confidence && (
                   <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingLeft: '2rem', borderLeft: '1px solid var(--border)' }}>
                      <p style={{ fontSize: '10px', color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '0.15em', fontWeight: '950', margin: 0, opacity: 0.6 }}>Confidence</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span style={{ fontSize: '1.75rem', fontWeight: '950', color: 'var(--primary)', lineHeight: 1 }}>{confidence}%</span>
                        <div style={{ width: '120px', height: '10px', backgroundColor: 'rgba(100, 116, 139, 0.1)', borderRadius: '10px', position: 'relative', overflow: 'hidden' }}>
                          <div style={{ 
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            height: '100%',
                            width: `${confidence}%`, 
                            backgroundColor: 'var(--primary)',
                            borderRadius: '10px',
                            transition: 'width 1.2s cubic-bezier(0.4, 0, 0.2, 1)' 
                          }}></div>
                        </div>
                      </div>
                   </div>
                 )}
              </div>
            </div>
            
            <div className="comparison-table-wrapper" style={{ overflowX: 'auto' }}>
              <table className="comparison-table">
                <thead>
                  <tr>
                    <th>Field Identity</th>
                    <th>Master Sheet (SO)</th>
                    <th>Invoice Data</th>
                    <th style={{ textAlign: 'right' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.filter(row => {
                    const fieldName = (row.field || row.label || '').toLowerCase();
                    return !fieldName.includes('batch') && !fieldName.includes('coil');
                  }).map((row, idx) => {
                    const sheetVal = String(row.sheet_value || row.expected || '').trim();
                    const invVal = String(row.invoice_value || row.actual || '').trim();
                    const resultFlag = String(row.result || row.match || row.status || row.is_match).toUpperCase();

                    const parseNum = (s) => {
                      const n = parseFloat(s.replace(/[₹,\s]/g, ''));
                      return isNaN(n) ? null : n;
                    };
                    const numSheet = parseNum(sheetVal);
                    const numInv = parseNum(invVal);
                    const withinRoundingTolerance = 
                      numSheet !== null && numInv !== null && Math.abs(numSheet - numInv) <= 1.0;

                    const isMatch = 
                      resultFlag === 'MATCH' || 
                      resultFlag === 'TRUE' || 
                      row.match === true || 
                      row.is_match === true ||
                      withinRoundingTolerance ||
                      (sheetVal !== '' && sheetVal === invVal);

                    return (
                      <tr key={idx}>
                        <td data-label="Field Identity" className="field-label-cell">
                          <FileText size={14} style={{ color: 'var(--primary)', opacity: 0.7 }}/>
                          {(row.field || row.label || '').replace(/_/g, ' ')}
                        </td>
                        <td data-label="Master Sheet (SO)" className="data-cell" style={{ fontFamily: 'monospace' }}>
                          {row.sheet_value || row.expected || '—'}
                        </td>
                        <td data-label="Invoice Data" className={`data-cell ${isMatch ? 'val-match' : 'val-mismatch'}`} style={{ fontFamily: 'monospace' }}>
                          {row.invoice_value || row.actual || '—'}
                        </td>
                        <td data-label="Verification" className="status-cell" style={{ textAlign: 'right' }}>
                          <span className={`match-badge ${isMatch ? 'success' : 'danger'}`}>
                             {isMatch ? <CheckCircle size={14}/> : <AlertTriangle size={14}/>}
                             {isMatch ? 'Match' : 'Mismatch'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          
          {notes && (
            <div style={{ 
              marginTop: '1.5rem', 
              padding: '1.5rem', 
              borderRadius: '16px', 
              backgroundColor: 'rgba(37, 99, 235, 0.04)', 
              border: '1px solid rgba(37, 99, 235, 0.1)',
              display: 'flex',
              gap: '1rem',
              alignItems: 'flex-start'
            }}>
              <div style={{ 
                padding: '0.5rem', 
                borderRadius: '10px', 
                backgroundColor: 'rgba(37, 99, 235, 0.1)', 
                color: 'var(--primary)',
                display: 'flex'
              }}>
                <FileText size={20} />
              </div>
              <div style={{ flex: 1 }}>
                <h4 style={{ fontSize: '11px', fontWeight: '900', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--primary)', margin: '0 0 0.4rem 0' }}>AI Audit Intelligence</h4>
                <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text)', lineHeight: '1.6', fontWeight: '500', fontStyle: 'italic' }}>
                  "{notes}"
                </p>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="webhook-output animate-fade-in" style={{ marginTop: '2rem' }}>
        <div className="card" style={{ padding: '0', overflow: 'hidden' }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            padding: '1.25rem 1.5rem', 
            borderBottom: '1px solid var(--border)', 
            background: 'linear-gradient(to right, rgba(0, 0, 0, 0.02), transparent)' 
          }}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0, fontSize: '1rem', fontWeight: '700', color: 'var(--text)' }}>
              <FileText size={18} style={{ color: 'var(--primary)' }} /> Webhook RAW Trace
            </h3>
            <span style={{ fontSize: '10px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.1em', background: 'rgba(100, 116, 139, 0.1)', color: 'var(--text-muted)', padding: '3px 8px', borderRadius: '4px' }}>No table found</span>
          </div>
          <div style={{ padding: '1.5rem', backgroundColor: '#0d1117' }}>
             <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--success)', boxShadow: '0 0 10px var(--success)' }}></div>
                <span style={{ fontSize: '10px', color: 'var(--success)', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.2em' }}>Scan Complete</span>
             </div>
            <pre style={{ margin: 0, fontSize: '0.85rem', color: '#e6edf3', overflowX: 'auto', fontFamily: 'monospace', maxHeight: '400px', lineHeight: '1.6' }}>
              {JSON.stringify(webhookResponse, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`audit-module ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`} style={result || webhookResponse ? { marginRight: 0 } : {}}>
      <div className="module-header">
        <div>
          <h1 className="module-title">Sales Audit</h1>
          <p className="module-subtitle">Multi-document verification workflow</p>
          <div className="quality-note hover-lift shadow-sm">
            <Info size={16} />
            Accuracy is dependent on the quality of image uploaded
          </div>
        </div>
        <div className="header-actions">
          {(result || allDone) && (
            <button className="btn btn-outline" onClick={() => {
              setResult(null); setInvoiceFiles([]); setGatepassFiles([]); setWeightslipFiles([]); setPurchaseOrderFiles([]); setAllDone(false); setActiveStep(0); setWebhookResponse(null);
            }}>
              Reset Audit
            </button>
          )}
        </div>
      </div>

      {!result ? (
        <div className="stepper-section animate-fade-in" style={{ position: 'relative' }}>
          <div className={`audit-layout ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
            <div className="main-upload-area">
              <div className="step-content-wrapper animate-slide-up">
                {allDone && (
                  <div className="all-done-banner animate-fade-in" style={{ marginBottom: '2rem' }}>
                    <Mail size={24} />
                    <div>
                      <p className="all-done-title" style={{ fontSize: '1.1rem' }}>Success! Documents are under process</p>
                      <p className="all-done-sub">Check your email shortly for the audit results.</p>
                    </div>
                  </div>
                )}

                {submitError && (
                  <div className="submit-error-banner animate-fade-in" style={{ marginBottom: '2rem' }}>
                    <XCircle size={20} />
                    <span>{submitError}</span>
                    <button className="error-dismiss" onClick={() => setSubmitError(null)}><X size={14}/></button>
                  </div>
                )}

                {!allDone && (
                  <div style={{ minHeight: '500px' }}>
                    {activeStep === 0 && (
                      <DocumentUpload 
                        title="Sales Invoice Upload" 
                        accepted={{'image/*': ['.png', '.jpg', '.jpeg']}}
                        onUpload={setInvoiceFiles}
                        files={invoiceFiles}
                        multiple={true}
                      />
                    )}
                    {activeStep === 1 && (
                      <DocumentUpload 
                        title="Gatepass Upload" 
                        accepted={{'image/*': ['.png', '.jpg', '.jpeg']}}
                        onUpload={setGatepassFiles}
                        files={gatepassFiles}
                        multiple={true}
                      />
                    )}
                    {activeStep === 2 && (
                      <DocumentUpload 
                        title="Weightslip Upload" 
                        accepted={{'image/*': ['.png', '.jpg', '.jpeg']}}
                        onUpload={setWeightslipFiles}
                        files={weightslipFiles}
                        multiple={true}
                      />
                    )}
                    {activeStep === 3 && (
                      <DocumentUpload 
                        title="Purchase Order Upload" 
                        accepted={{'image/*': ['.png', '.jpg', '.jpeg']}}
                        onUpload={setPurchaseOrderFiles}
                        files={purchaseOrderFiles}
                        multiple={true}
                      />
                    )}

                    <div className="paste-hint" style={{ marginTop: '2rem' }}>
                      <span className="kbd" style={{ padding: '4px 8px' }}>Ctrl</span> + <span className="kbd" style={{ padding: '4px 8px' }}>V</span> to paste screenshots directly
                    </div>

                    <div className="step-footer">
                      {activeStep > 0 && (
                        <button className="btn btn-outline" onClick={prevStep} style={{ borderRadius: '12px', padding: '1rem 2.5rem', fontSize: '1rem' }}>
                          Back
                        </button>
                      )}
                      {activeStep < 3 ? (
                        <button 
                          className="btn btn-primary btn-done" 
                          onClick={nextStep}
                          disabled={steps[activeStep].files.length === 0}
                          style={{ padding: '1rem 4rem' }}
                        >
                          Next Stage <ChevronRight size={22} />
                        </button>
                      ) : (
                        <button 
                          className="btn btn-primary btn-done" 
                          onClick={handleSubmitAll}
                          disabled={isSubmitting || purchaseOrderFiles.length === 0}
                          style={{ background: 'var(--success)', borderColor: 'var(--success)', padding: '1rem 5rem' }}
                        >
                          {isSubmitting ? <><Loader2 size={24} className="spin-icon" /> Sending...</> : <><Send size={24} /> Final Submit</>}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className={`audit-sidebar right-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
              <button 
                className="sidebar-retract-btn" 
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
              >
                {isSidebarCollapsed ? <ArrowRight size={18} /> : <X size={18} />}
              </button>
              
              {!isSidebarCollapsed && (
                <div className="sidebar-content animate-fade-in">
                  <div style={{ marginBottom: '1.5rem', fontWeight: '800', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
                    Workflow Stages
                  </div>
                  <div className="sidebar-nav-list">
                    {steps.map((s, idx) => {
                      const StepIcon = s.icon;
                      return (
                        <div 
                          key={idx} 
                          className={`sidebar-nav-item ${activeStep === idx ? 'active' : ''} ${s.files.length > 0 ? 'completed' : ''}`}
                          onClick={() => !allDone && setActiveStep(idx)}
                        >
                          <div className="sidebar-step-num">
                            {s.files.length > 0 ? <Check size={16} /> : <StepIcon size={16} />}
                          </div>
                          <div className="sidebar-step-info">
                            <span className="sidebar-step-name">{s.label}</span>
                            <span className="sidebar-step-status">{s.files.length > 0 ? 'Uploaded' : 'Waiting...'}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="result-stage animate-fade-in">
          {renderWebhookResponse()}
        </div>
      )}
    </div>
  )
}

export default SalesAudit
