import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useDropzone } from 'react-dropzone'
import { UploadCloud, File as FileIcon, CheckCircle, AlertTriangle, ArrowRight, X, Send, Mail, Loader2, XCircle, Info, ChevronRight, Check } from 'lucide-react'
import './PurchaseAudit.css'

const WEBHOOK_URL = import.meta.env.VITE_PURCHASE_WEBHOOK_URL || 'https://n8n.srv1010832.hstgr.cloud/webhook/9108c298-08ac-45c3-abb8-050459156001'

/* Last document step. 4 is the "processing" step and has no dropzone. */
const LAST_STEP = 3

/* Tips that cycle through the row under the dropzone. Module-level so the array
   identity never changes - the rotation effect keys off it, and a list rebuilt
   during render would restart the timer on every pass and freeze the hint. */
const UPLOAD_HINTS = [
  {
    key: 'paste',
    text: 'Press Ctrl + V to paste screenshots directly.',
    render: () => (
      <>
        <span className="kbd">Ctrl</span>
        <span>+</span>
        <span className="kbd">V</span>
        <span>to paste screenshots directly</span>
      </>
    )
  },
  {
    key: 'quality',
    text: 'Accuracy is dependent on the quality of image uploaded.',
    render: () => (
      <>
        <Info size={16} />
        <span>Accuracy is dependent on the quality of image uploaded</span>
      </>
    )
  }
]

const RotatingHint = ({ hints = UPLOAD_HINTS, intervalMs = 3000 }) => {
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex(prev => (prev + 1) % hints.length)
    }, intervalMs)
    return () => clearInterval(timer)
  }, [hints.length, intervalMs])

  // Clamped rather than wrapped: an emptied list must not index undefined.
  const hint = hints[Math.min(activeIndex, hints.length - 1)]

  return (
    <div className="paste-hint">
      {/* Not a live region - one would re-announce every swap. Screen readers
          get the full set once, from the static copy below. */}
      <span className="sr-only">
        {hints.map(h => h.text).join('. ')}
      </span>
      <span aria-hidden="true" className="paste-hint-viewport">
        {/* Keyed on the hint so each swap remounts the node, which is what
            restarts the entry animation. */}
        <span key={hint.key} className="paste-hint-item">{hint.render()}</span>
      </span>
    </div>
  )
}

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
    <div className={`upload-box card ${isSubmitted ? 'card-submitted' : ''} ${multiple ? 'bulk-upload-box' : ''}`} style={{ transition: 'all 0.4s' }}>
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

const MatchResultRow = ({ label, invVal, ewVal, lrVal, grnVal, isMatch }) => (
  <tr>
    <td data-label="Field Identity" className="font-medium text-muted">{label}</td>
    <td data-label="Supplier Invoice">{invVal || '-'}</td>
    <td data-label="E-Way Bill" className={ewVal && (invVal !== ewVal) ? 'text-error font-medium' : ''}>{ewVal || '-'}</td>
    <td data-label="LR Copy" className={lrVal && (invVal !== lrVal) ? 'text-error font-medium' : ''}>{lrVal || '-'}</td>
    <td data-label="GRN" className={grnVal && (invVal !== grnVal) ? 'text-error font-medium' : ''}>{grnVal || '-'}</td>
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
  const [activeStep, setActiveStep] = useState(0) // 0: Invoice, 1: E-way, 2: LR, 3: GRN, 4: Processing
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [allDone, setAllDone]           = useState(false)
  const [submitError, setSubmitError]   = useState(null)
  const [isSubmitConfirmOpen, setIsSubmitConfirmOpen] = useState(false)

  const [invoiceFiles, setInvoiceFiles] = useState([])
  const [ewayFiles, setEwayFiles]       = useState([])
  const [lrFiles, setLrFiles]           = useState([])
  const [grnFiles, setGrnFiles]         = useState([])

  /* The four documents, each independent and each optional. This array is the
     single source of truth for step order, the sidebar, the dropzone and the
     FormData field names - they used to be repeated across four render
     branches and the submit handler, which is exactly how the old
     "GRN is mandatory" rule crept in. */
  const docs = [
    { field: 'Invoice', label: 'Supplier Invoice', title: 'Invoice Upload',    files: invoiceFiles, setFiles: setInvoiceFiles },
    { field: 'Eway',    label: 'E-Way Bill',       title: 'E-Way Bill Upload', files: ewayFiles,    setFiles: setEwayFiles },
    { field: 'LR',      label: 'LR Copy',          title: 'LR Copy Upload',    files: lrFiles,      setFiles: setLrFiles },
    { field: 'GRN',     label: 'GRN',              title: 'GRN Upload',        files: grnFiles,     setFiles: setGrnFiles },
  ]

  const uploadedDocs = docs.filter(d => d.files.length > 0)
  const missingDocs  = docs.filter(d => d.files.length === 0)
  const totalFileCount = docs.reduce((count, d) => count + d.files.length, 0)

  /* `docs` is rebuilt on every render, so listing it as a dependency would
     detach and reattach the paste listener on every pass. The state setters it
     holds are stable, so the current step's setter is read through a ref and
     the effect depends on the step alone. */
  const activeSetFiles = useRef(null)
  activeSetFiles.current = docs[activeStep]?.setFiles

  // Paste handler - the clipboard file lands on whichever document is open.
  useEffect(() => {
    const handlePaste = (e) => {
      const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
      if (!items) return;

      const setFiles = activeSetFiles.current;
      if (!setFiles) return;

      for (const item of items) {
        if (item.kind === 'file') {
          const blob = item.getAsFile();
          if (blob && blob.type.startsWith('image/')) {
            const pastedFile = new File([blob], `Pasted-Image-${Date.now()}.png`, { type: blob.type });
            setFiles(prev => [...prev, pastedFile]);
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [activeStep]);

  const handleSubmitAll = async () => {
    const uploads = docs.flatMap(d => d.files.map(file => ({ file, name: d.field })))

    // Nothing to send. The button is already disabled in this state; this guard
    // exists so the failure is visible rather than a silent no-op.
    if (uploads.length === 0) {
      setSubmitError('Upload at least one document before submitting.')
      return
    }

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

      // Files are only appended for the documents that were actually uploaded,
      // so the webhook would otherwise see no difference between "not
      // collected" and "collected nothing". These two fields let it tell the
      // two apart and audit on whatever subset arrived.
      formData.append('uploadedDocuments', uploadedDocs.map(d => d.field).join(','))
      formData.append('missingDocuments', missingDocs.map(d => d.field).join(','))

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
      // Back to the document that was open when the submit was triggered - the
      // old code always jumped to GRN, which was wrong once a subset could be
      // submitted from any step.
      setActiveStep(prev => (prev > LAST_STEP ? LAST_STEP : prev))
    } finally {
      setIsSubmitting(false)
    }
  }

  const nextStep = () => {
    if (activeStep < LAST_STEP) setActiveStep(activeStep + 1)
  }

  const prevStep = () => {
    if (activeStep > 0) setActiveStep(activeStep - 1)
  }

  const resetAudit = () => {
    setResult(null)
    setInvoiceFiles([]); setEwayFiles([]); setLrFiles([]); setGrnFiles([])
    setAllDone(false)
    setActiveStep(0)
    setSubmitError(null)
    setIsSubmitConfirmOpen(false)
  }

  return (
    <div className={`audit-module audit-wizard purchase-audit ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="module-header">
        <h1 className="module-title">Purchase Audit</h1>
        <div className="header-actions">
          {(result || allDone) && (
            <button className="btn btn-outline" onClick={resetAudit}>
              Reset Audit
            </button>
          )}
        </div>
      </div>

      {!result && (
        <div className="stepper-section animate-fade-in" style={{ position: 'relative' }}>
          <div className={`audit-layout ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
            <div className={`main-upload-area ${allDone ? 'is-complete' : ''}`}>
              <div className="step-content-wrapper animate-slide-up">
                {allDone && (
                  <div className="all-done-stage animate-fade-in">
                    <div className="all-done-card">
                      <div className="all-done-icon"><Mail size={28} /></div>
                      <p className="all-done-title">Success! Documents are under process</p>
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
                  <div className="upload-stage">
                    <DocumentUpload
                      key={docs[activeStep].field}
                      title={docs[activeStep].title}
                      accepted={{'image/*': ['.png', '.jpg', '.jpeg']}}
                      onUpload={docs[activeStep].setFiles}
                      files={docs[activeStep].files}
                      multiple={true}
                    />

                    {/* One row: the rotating hint on the left, navigation on
                        the right. Nothing here is gated on an empty document -
                        every doc is optional, so any step is reachable from any
                        other. Submit lives in the sidebar, next to the document
                        list it reports on. */}
                    <div className="step-footer">
                      <RotatingHint />

                      <div className="step-nav">
                        {activeStep > 0 && (
                          <button className="btn btn-outline" onClick={prevStep} style={{ borderRadius: '12px', padding: '1rem 2.5rem', fontSize: '1rem' }}>
                            Back
                          </button>
                        )}
                        {activeStep < LAST_STEP && (
                          <button
                            className="btn btn-primary btn-done"
                            onClick={nextStep}
                            style={{ padding: '1rem 4rem' }}
                          >
                            Next Stage <ChevronRight size={22} />
                          </button>
                        )}
                      </div>
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
                    Documents
                  </div>
                  <div className="sidebar-nav-list">
                    {docs.map((d, idx) => (
                      <div
                        key={d.field}
                        className={`sidebar-nav-item ${activeStep === idx ? 'active' : ''} ${d.files.length > 0 ? 'completed' : ''}`}
                        onClick={() => !allDone && setActiveStep(idx)}
                      >
                        <div className="sidebar-step-num">
                          {d.files.length > 0 ? <Check size={16} /> : idx + 1}
                        </div>
                        <div className="sidebar-step-info">
                          <span className="sidebar-step-name">{d.label}</span>
                          {/* Optional documents: an empty one reads as "not
                              collected", not as something still outstanding. */}
                          <span className="sidebar-step-status">
                            {d.files.length > 0 ? `${d.files.length} uploaded` : 'Not uploaded'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Submit sits under the list it summarises, so what is
                      about to go over and what is being skipped are in one
                      glance. Hidden once the audit is with the workflow. */}
                  {!allDone && (
                    <div className="sidebar-submit-wrap">
                      <button
                        className="sidebar-submit"
                        onClick={() => setIsSubmitConfirmOpen(true)}
                        disabled={isSubmitting || totalFileCount === 0}
                      >
                        {isSubmitting
                          ? <><Loader2 size={18} className="spin-icon" /> Sending...</>
                          : <><Send size={18} /> Final Submit</>}
                      </button>

                      {totalFileCount === 0 && (
                        <p className="sidebar-submit-hint">Upload any one document to enable the audit.</p>
                      )}
                      {totalFileCount > 0 && missingDocs.length > 0 && (
                        <p className="sidebar-submit-hint">
                          {missingDocs.length} of {docs.length} not uploaded - the audit will cover only what you send.
                        </p>
                      )}
                    </div>
                  )}
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
                  <th>GRN</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <MatchResultRow 
                  label="Invoice Number" 
                  invVal={result.data.invoiceNo?.inv} ewVal={result.data.invoiceNo?.ew} lrVal={result.data.invoiceNo?.lr} grnVal={result.data.invoiceNo?.grn} isMatch={result.data.invoiceNo?.match} 
                />
                <MatchResultRow 
                  label="Date" 
                  invVal={result.data.date?.inv} ewVal={result.data.date?.ew} lrVal={result.data.date?.lr} grnVal={result.data.date?.grn} isMatch={result.data.date?.match} 
                />
                <MatchResultRow 
                  label="GSTIN" 
                  invVal={result.data.gstin?.inv} ewVal={result.data.gstin?.ew} lrVal={result.data.gstin?.lr} grnVal={result.data.gstin?.grn} isMatch={result.data.gstin?.match} 
                />
                <MatchResultRow 
                  label="Quantity" 
                  invVal={result.data.quantity?.inv} ewVal={result.data.quantity?.ew} lrVal={result.data.quantity?.lr} grnVal={result.data.quantity?.grn} isMatch={result.data.quantity?.match} 
                />
                <MatchResultRow 
                  label="Amount" 
                  invVal={result.data.amount?.inv} ewVal={result.data.amount?.ew} lrVal={result.data.amount?.lr} grnVal={result.data.amount?.grn} isMatch={result.data.amount?.match} 
                />
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Spells out exactly what is going over, so a subset submit is a decision
          rather than an accident - each document is optional, but the result
          only covers the ones actually uploaded. */}
      {isSubmitConfirmOpen && (
        <div className="confirm-modal-overlay" onClick={() => !isSubmitting && setIsSubmitConfirmOpen(false)}>
          <div
            className="confirm-modal animate-scale-in"
            role="dialog"
            aria-modal="true"
            aria-labelledby="purchase-submit-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="confirm-modal-close"
              onClick={() => setIsSubmitConfirmOpen(false)}
              aria-label="Close confirmation"
              disabled={isSubmitting}
            >
              <X size={18} />
            </button>

            <div className="confirm-modal-icon">
              <Send size={26} />
            </div>

            <h3 id="purchase-submit-confirm-title" className="confirm-modal-title">
              Confirm Submission
            </h3>

            <ul className="doc-manifest">
              {docs.map(d => (
                <li key={d.field} className={d.files.length > 0 ? 'has-files' : 'is-missing'}>
                  {d.files.length > 0
                    ? <CheckCircle size={16} />
                    : <AlertTriangle size={16} />}
                  <span className="doc-manifest-label">{d.label}</span>
                  <span className="doc-manifest-state">
                    {d.files.length > 0 ? `${d.files.length} file${d.files.length > 1 ? 's' : ''}` : 'Skipped'}
                  </span>
                </li>
              ))}
            </ul>

            <p className="confirm-modal-text">
              {missingDocs.length > 0
                ? `${missingDocs.length} document${missingDocs.length > 1 ? 's' : ''} will be skipped, and the audit will only cover the ones uploaded.`
                : 'All documents will be processed and evaluated automatically.'}
            </p>

            <div className="confirm-modal-actions">
              <button
                className="btn btn-outline confirm-modal-cancel"
                onClick={() => setIsSubmitConfirmOpen(false)}
                disabled={isSubmitting}
              >
                Go Back
              </button>
              <button
                className="btn btn-primary confirm-modal-submit"
                onClick={() => {
                  setIsSubmitConfirmOpen(false)
                  handleSubmitAll()
                }}
              >
                <Send size={16} /> Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PurchaseAudit
