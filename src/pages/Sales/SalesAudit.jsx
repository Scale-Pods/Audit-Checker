import React, { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { UploadCloud, File, FileText, CheckCircle, AlertTriangle, ArrowRight, X, Loader2, Send, Info, Mail } from 'lucide-react'
import '../Purchase/PurchaseAudit.css' // Reusing styles from Purchase Audit

const DocumentUpload = ({ title, accepted, onUpload, files, icon: IconComponent }) => {
  const onDrop = useCallback(acceptedFiles => {
    if (acceptedFiles.length > 0) {
      onUpload(prev => [...prev, ...acceptedFiles])
    }
  }, [onUpload])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    accept: accepted,
    multiple: true
  })

  const Icon = IconComponent || File;

  return (
    <div className="upload-box card">
      <h3 className="upload-title flex items-center gap-2">
        <Icon size={18} className="text-primary"/> {title}
      </h3>
      
      <div {...getRootProps()} className={`dropzone ${isDragActive ? 'active' : ''}`} style={{ minHeight: '140px', padding: '1.5rem' }}>
        <input {...getInputProps()} />
        <UploadCloud size={32} className="drop-icon" style={{ marginBottom: '0.5rem' }} />
        <p className="drop-text" style={{ fontSize: '0.9rem' }}>Choose Files</p>
        <span className="drop-subtext">Drag & drop or click</span>
      </div>

      {files && files.length > 0 && (
        <div className="file-list-container" style={{ marginTop: '1rem' }}>
          {files.map((file, idx) => (
            <div key={idx} className="file-preview" style={{ marginBottom: '0.5rem' }}>
              <File className="file-icon" size={20} />
              <div className="file-info">
                <span className="file-name" style={{ fontSize: '0.8rem' }}>{file.name}</span>
                <span className="file-size">{(file.size / 1024).toFixed(2)} KB</span>
              </div>
              <button className="remove-btn" onClick={() => onUpload(files.filter((_, i) => i !== idx))}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const MatchResultRow = ({ label, soVal, invVal, isMatch }) => (
  <tr>
    <td data-label="Field Identity" className="font-medium text-muted">{label}</td>
    <td data-label="Master Sheet (SO)">{soVal || '-'}</td>
    <td data-label="Invoice Data" className={invVal && (soVal !== invVal) ? 'text-error font-medium' : ''}>{invVal || '-'}</td>
    <td data-label="Verification Status">
      {isMatch ? 
        <span className="status-badge success"><CheckCircle size={14}/> Match</span> : 
        <span className="status-badge error"><AlertTriangle size={14}/> Mismatch</span>
      }
    </td>
  </tr>
)

const SALES_WEBHOOK_URL = import.meta.env.VITE_SALES_WEBHOOK_URL || 'https://n8n.srv1010832.hstgr.cloud/webhook/365acab8-8d63-48bc-8ac9-0e079ecba8db'

const SalesAudit = () => {
  const [invoiceFiles, setInvoiceFiles] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [result, setResult] = useState(null)
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
            const pastedFile = new File([blob], `Pasted-Invoice-${Date.now()}.png`, { type: blob.type });
            setInvoiceFiles(prev => [...prev, pastedFile]);
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  const handleSubmit = async () => {
    if (invoiceFiles.length === 0) return
    setIsSubmitting(true)
    setSubmitError(null)
    setWebhookResponse(null)
    setSubmitted(true)

    console.log('[SalesAudit] Preparing upload of', invoiceFiles.length, 'files');

    try {
      const formData = new FormData();
      invoiceFiles.forEach(file => {
        formData.append('Invoice', file);
      });

      const res = await fetch(SALES_WEBHOOK_URL, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'No error detail');
        throw new Error(`Upload failed (${res.status}): ${errorText.slice(0, 100)}`)
      }

      const responseText = await res.text();
      let data;
      try {
        data = responseText ? JSON.parse(responseText) : { status: 'success', message: 'Invoices received' };
      } catch {
        data = { status: 'success', raw: responseText };
      }

      setWebhookResponse(data)
      if (data && data.status && data.data && !data.raw) setResult(data)
    } catch (err) {
      setSubmitError(err.message)
      setSubmitted(false)
    } finally {
      setIsSubmitting(false)
    }
  }



  const renderWebhookResponse = () => {
    if (!webhookResponse) return null;

    let tableData = null;
    let overallStatus = null;
    let confidence = null;
    let notes = null;

    try {
      // Handle array or direct object response
      const dataObj = Array.isArray(webhookResponse) ? webhookResponse[0] : webhookResponse;
      
      // Discovery helper to extract info from an object
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

      // Attempt discovery in order of likelihood
      let results = extractInfo(dataObj);

      // 1. Check direct 'raw' or 'data' objects
      if (!results && dataObj.raw && typeof dataObj.raw === 'object') {
        results = extractInfo(dataObj.raw);
      }
      if (!results && dataObj.data && typeof dataObj.data === 'object') {
        results = extractInfo(dataObj.data);
      }

      // 2. Check stringified fields
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
            
            {/* Real Premium Header with Explicit Flexbox */}
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

                    // Numeric rounding tolerance: strip currency symbols/commas and compare
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
    <div className="audit-module" style={{ marginRight: 0 }}>
      <div className="module-header">
        <div>
          <h1 className="module-title">Sales Audit</h1>
          <p className="module-subtitle">Upload Sales Invoice for AI-powered verification against Sales Order sheet</p>
          <div className="quality-note hover-lift shadow-sm">
            <Info size={16} />
            Accuracy is dependent on the quality of image uploaded
          </div>
        </div>
        {(result || webhookResponse) && (
          <button className="btn btn-outline" onClick={() => {
            setResult(null); setInvoiceFiles([]); setSubmitted(false); setWebhookResponse(null);
          }}>
            Reset Audit
          </button>
        )}
      </div>

      {!result ? (
        <div className="upload-stage animate-fade-in">
          {submitted && (
            <div className="all-done-banner animate-fade-in" style={{ marginBottom: '1.5rem' }}>
              <Mail size={22} />
              <div>
                <p className="all-done-title">Invoice submitted successfully!</p>
                <p className="all-done-sub">Your documents are under process. You'll receive a notification via email once the audit is complete!</p>
              </div>
            </div>
          )}

          {submitError && (
            <div className="submit-error-banner animate-fade-in" style={{ marginBottom: '1.5rem' }}>
              <AlertTriangle size={20} />
              <span>{submitError}</span>
              <button className="error-dismiss" onClick={() => setSubmitError(null)}><X size={14}/></button>
            </div>
          )}

          <div className="upload-grid" style={{ gridTemplateColumns: '1fr' }}>
            <DocumentUpload 
              title="Sales Invoice (Image Upload)" 
              icon={FileText}
              accepted={{'image/*': ['.png', '.jpg', '.jpeg']}}
              onUpload={setInvoiceFiles}
              files={invoiceFiles}
            />
            <div className="paste-hint" style={{ marginTop: '1.5rem' }}>
              <span className="kbd">Ctrl</span> + <span className="kbd">V</span> to paste screenshots directly
            </div>
          </div>
          
          <div className="action-bar card" style={{ display: 'flex', justifyContent: 'flex-end', padding: '2rem' }}>
            <button 
              className="btn btn-primary" 
              style={{ padding: '1rem 4rem', fontSize: '1.1rem', borderRadius: '12px' }}
              onClick={handleSubmit} 
              disabled={invoiceFiles.length === 0 || isSubmitting}
            >
              {isSubmitting ? (
                <><Loader2 size={20} className="spin-icon" /> Sending documents...</>
              ) : (
                <><Send size={20} /> Submit for AI verification</>
              )}
            </button>
          </div>

          {renderWebhookResponse()}
        </div>
      ) : (
        <div className="result-stage animate-fade-in">
          <div className="summary-banner card" style={{ borderLeftColor: 'var(--success)' }}>
            <div className={`summary-icon success`}>
              <CheckCircle size={32} />
            </div>
            <div className="summary-content">
              <h2>Audit Result: <span className="text-success">Match Verified</span></h2>
              <p>All items in the Sales Invoice successfully match the Sales Order sheet.</p>
            </div>
          </div>

          <div className="comparison-table-wrapper card">
            <h3 className="card-title p-6 pb-0 border-b">Extracted Data Comparison</h3>
            <table className="comparison-table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Sales Order (SO)</th>
                  <th>Sales Invoice</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <MatchResultRow label="Order ID" soVal={result.data.orderId.so} invVal={result.data.orderId.inv} isMatch={result.data.orderId.match} />
                <MatchResultRow label="Customer" soVal={result.data.customer.so} invVal={result.data.customer.inv} isMatch={result.data.customer.match} />
                <MatchResultRow label="Product" soVal={result.data.product.so} invVal={result.data.product.inv} isMatch={result.data.product.match} />
                <MatchResultRow label="Quantity" soVal={result.data.quantity.so} invVal={result.data.quantity.inv} isMatch={result.data.quantity.match} />
                <MatchResultRow label="Total Price" soVal={result.data.price.so} invVal={result.data.price.inv} isMatch={result.data.price.match} />
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default SalesAudit
