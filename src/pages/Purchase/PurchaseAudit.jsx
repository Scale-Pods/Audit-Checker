import React, { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { UploadCloud, File as FileIcon, FileText, CheckCircle, AlertTriangle, ArrowRight, X, Send, Mail, Loader2, XCircle, Info, ChevronRight, Check, TrendingUp } from 'lucide-react'
import './PurchaseAudit.css'

const WEBHOOK_URL = import.meta.env.VITE_PURCHASE_WEBHOOK_URL || 'https://n8n.srv1010832.hstgr.cloud/webhook/9108c298-08ac-45c3-abb8-050459156001'

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

const MatchResultRow = ({ label, invVal, ewVal, lrVal, isMatch }) => (
  <tr>
    <td data-label="Field Identity" className="font-medium text-muted">{label}</td>
    <td data-label="Supplier Invoice">{invVal || '-'}</td>
    <td data-label="E-Way Bill" className={ewVal && (invVal !== ewVal) ? 'text-error font-medium' : ''}>{ewVal || '-'}</td>
    <td data-label="LR Copy" className={lrVal && (invVal !== lrVal) ? 'text-error font-medium' : ''}>{lrVal || '-'}</td>
    <td data-label="Verification Status">
      {isMatch ? 
        <span className="status-badge success"><CheckCircle size={14}/> Match</span> : 
        <span className="status-badge error"><AlertTriangle size={14}/> Mismatch</span>
      }
    </td>
  </tr>
)

const PurchaseAudit = () => {
  const [result, setResult] = useState(null)
  const [activeStep, setActiveStep] = useState(0) // 0: Invoice, 1: E-way, 2: LR, 3: Processing
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [allDone, setAllDone]           = useState(false)
  const [submitError, setSubmitError]   = useState(null)
  
  const [invoiceFiles, setInvoiceFiles] = useState([])
  const [ewayFiles, setEwayFiles]       = useState([])
  const [lrFiles, setLrFiles]           = useState([])

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
            if (activeStep === 1) setEwayFiles(prev => [...prev, pastedFile]);
            if (activeStep === 2) setLrFiles(prev => [...prev, pastedFile]);
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
    ewayFiles.forEach(f => uploads.push({ file: f, name: 'Eway' }))
    lrFiles.forEach(f => uploads.push({ file: f, name: 'LR' }))

    if (uploads.length === 0) return
    setIsSubmitting(true)
    setSubmitError(null)
    setAllDone(true)
    setActiveStep(3)

    try {
      const formData = new FormData()
      
      uploads.forEach((item) => {
        const ext = item.file.name.includes('.') ? '.' + item.file.name.split('.').pop() : ''
        const fileName = `${item.name}${ext}`
        const renamed = new File([item.file], fileName, { type: item.file.type })
        formData.append(item.name, renamed, fileName)
      })

      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status} – ${text.slice(0, 200)}`)
      }
    } catch (err) {
      console.error('[Submit] Error:', err)
      setSubmitError(err.message || 'Failed to send.')
      setAllDone(false)
      setActiveStep(2)
    } finally {
      setIsSubmitting(false)
    }
  }

  const steps = [
    { label: 'Supplier Invoice', files: invoiceFiles, status: invoiceFiles.length > 0 ? 'Ready' : 'Pending', icon: FileText },
    { label: 'E-Way Bill', files: ewayFiles, status: ewayFiles.length > 0 ? 'Ready' : 'Pending', icon: TrendingUp },
    { label: 'LR Copy', files: lrFiles, status: lrFiles.length > 0 ? 'Ready' : 'Pending', icon: FileText }
  ]

  const nextStep = () => {
    if (activeStep < 2) setActiveStep(activeStep + 1)
  }

  const prevStep = () => {
    if (activeStep > 0) setActiveStep(activeStep - 1)
  }

  return (
    <div className={`audit-module ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="module-header">
        <div>
          <h1 className="module-title">Purchase Audit</h1>
          <p className="module-subtitle">Advanced document verification workflow</p>
          <div className="quality-note hover-lift shadow-sm">
            <Info size={16} />
            Accuracy is dependent on the quality of image uploaded
          </div>
        </div>
        <div className="header-actions">
          {(result || allDone) && (
            <button className="btn btn-outline" onClick={() => {
              setResult(null); setInvoiceFiles([]); setEwayFiles([]); setLrFiles([]); setAllDone(false); setActiveStep(0);
            }}>
              Reset Audit
            </button>
          )}
        </div>
      </div>

      {!result && (
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
                        title="Invoice Upload" 
                        accepted={{'image/*': ['.png', '.jpg', '.jpeg']}}
                        onUpload={setInvoiceFiles}
                        files={invoiceFiles}
                        multiple={true}
                      />
                    )}
                    {activeStep === 1 && (
                      <DocumentUpload 
                        title="E-Way Bill Upload" 
                        accepted={{'image/*': ['.png', '.jpg', '.jpeg']}}
                        onUpload={setEwayFiles}
                        files={ewayFiles}
                        multiple={true}
                      />
                    )}
                    {activeStep === 2 && (
                      <DocumentUpload 
                        title="LR Copy Upload" 
                        accepted={{'image/*': ['.png', '.jpg', '.jpeg']}}
                        onUpload={setLrFiles}
                        files={lrFiles}
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
                      {activeStep < 2 ? (
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
                          disabled={isSubmitting || lrFiles.length === 0}
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
                    {steps.map((s, idx) => (
                      <div 
                        key={idx} 
                        className={`sidebar-nav-item ${activeStep === idx ? 'active' : ''} ${s.files.length > 0 ? 'completed' : ''}`}
                        onClick={() => !allDone && setActiveStep(idx)}
                      >
                        <div className="sidebar-step-num">
                          {s.files.length > 0 ? <Check size={16} /> : idx + 1}
                        </div>
                        <div className="sidebar-step-info">
                          <span className="sidebar-step-name">{s.label}</span>
                          <span className="sidebar-step-status">{s.files.length > 0 ? 'Uploaded' : 'Waiting...'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  

                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="result-stage animate-fade-in">
          <div className="summary-banner card">
            <div className={`summary-icon ${result.status === 'Match' ? 'success' : 'error'}`}>
              {result.status === 'Match' ? <CheckCircle size={32} /> : <AlertTriangle size={32} />}
            </div>
            <div className="summary-content">
              <h2>Audit Result: <span className={result.status === 'Match' ? 'text-success' : 'text-error'}>{result.status}</span></h2>
              <p>Discrepancies found between the documents.</p>
            </div>
          </div>

          <div className="comparison-table-wrapper card">
            <h3 className="card-title p-6 pb-0 border-b">Extracted Data Comparison</h3>
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Supplier Invoice</th>
                  <th>E-Way Bill</th>
                  <th>LR Copy</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <MatchResultRow 
                  label="Invoice Number" 
                  invVal={result.data.invoiceNo.inv} ewVal={result.data.invoiceNo.ew} lrVal={result.data.invoiceNo.lr} isMatch={result.data.invoiceNo.match} 
                />
                <MatchResultRow 
                  label="Date" 
                  invVal={result.data.date.inv} ewVal={result.data.date.ew} lrVal={result.data.date.lr} isMatch={result.data.date.match} 
                />
                <MatchResultRow 
                  label="GSTIN" 
                  invVal={result.data.gstin.inv} ewVal={result.data.gstin.ew} lrVal={result.data.gstin.lr} isMatch={result.data.gstin.match} 
                />
                <MatchResultRow 
                  label="Quantity" 
                  invVal={result.data.quantity.inv} ewVal={result.data.quantity.ew} lrVal={result.data.quantity.lr} isMatch={result.data.quantity.match} 
                />
                <MatchResultRow 
                  label="Amount" 
                  invVal={result.data.amount.inv} ewVal={result.data.amount.ew} lrVal={result.data.amount.lr} isMatch={result.data.amount.match} 
                />
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default PurchaseAudit
