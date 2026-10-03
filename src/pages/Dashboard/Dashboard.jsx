import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts'
import {
  FileText,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Loader2,
  X,
  Info,
  Search,
  Filter,
  Eye,
  ArrowUpDown,
  FileCheck2,
  Gauge,
  Users,
  Boxes,
  ReceiptIndianRupee
} from 'lucide-react'
import { fetchSalesRecords, salesLedgerSource } from '../../api/sales.js'
import { fetchPurchaseRecords } from '../../api/audits.js'
import { useSyncRefresh } from '../../context/SyncContext'
import { SquareWaveLoader } from '@/components/ui/square-wave-loader'
import './Dashboard.css'

const COLOR_VERIFIED = '#18A66A'
const COLOR_MISMATCH = '#D99A22'
const COLOR_PENDING = '#718096'
const COLOR_NA = '#D9534F'

const STATUS_DEFINITIONS = [
  { key: 'verified', name: 'Verified', color: COLOR_VERIFIED },
  { key: 'mismatch', name: 'Mismatch', color: COLOR_MISMATCH },
  { key: 'pending', name: 'Pending', color: COLOR_PENDING },
  { key: 'unavailable', name: 'Not Available', color: COLOR_NA }
]

const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== ''

const firstValue = (...values) => values.find(hasValue)

const asText = (value) => hasValue(value) ? String(value).trim() : ''

const parseJson = (value) => {
  if (value !== null && typeof value === 'object') return value
  if (!hasValue(value)) return null

  try {
    return JSON.parse(String(value))
  } catch {
    return null
  }
}

const getAuditResult = (item) => {
  const values = [
    item?.inv_audit_result,
    item?.inv_result,
    item?.Audit_Result,
    item?.Audit_Intelligence,
    item?.audit_result
  ]

  for (const value of values) {
    const parsed = parseJson(value)
    if (Array.isArray(parsed)) {
      const candidate = parsed.find((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      if (candidate) return candidate
    } else if (parsed && typeof parsed === 'object') {
      return parsed
    }
  }

  return null
}

const statusText = (value) => {
  if (value && typeof value === 'object') {
    return asText(value.status || value.overall_status || value.result || value.value)
  }

  return asText(value)
}

const classifyStatus = (value) => {
  const text = statusText(value).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return null

  if (/not available|unavailable|not applicable|unknown|unverified|no data|\bna\b|\bn\/a\b/.test(text)) {
    return 'unavailable'
  }
  if (/mismatch|fail|reject|error|violation|discrep|invalid|not match|high mismatch/.test(text)) {
    return 'mismatch'
  }
  if (/pending|processing|in progress|running|awaiting|queued/.test(text)) {
    return 'pending'
  }
  if (/partial|needs review|review required|deviation/.test(text)) {
    return 'mismatch'
  }
  if (/pass|verified|approve|success|good match|compliant|matched|^match$|^ok$|^yes$/.test(text)) {
    return 'verified'
  }

  return null
}

const resolveStatus = (candidates, issues, score) => {
  for (const candidate of candidates) {
    const status = classifyStatus(candidate)
    if (status) return status
  }

  if (issues.length > 0) return 'mismatch'
  if (score !== null) return score >= 85 ? 'verified' : 'mismatch'
  return 'pending'
}

const getStatusCandidates = (item, result) => [
  item?.inv_audit_status,
  item?.inv_status,
  item?.audit_status,
  result?.overall?.status,
  result?.overall_summary?.overall_status,
  result?.output?.overall_summary?.overall_status,
  result?.output?.overall?.status,
  item?.['Status'],
  item?.Result,
  item?.result,
  item?.status,
  result?.status,
  result?.result
]

const formatIssue = (value) => {
  if (value === null || value === undefined || value === '') return ''

  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return value.trim()

  if (Array.isArray(value)) {
    return value.map(formatIssue).filter(Boolean).join('; ')
  }

  if (typeof value === 'object') {
    const message = firstValue(value.message, value.reason, value.description, value.title)
    if (message) return formatIssue(message)

    const nested = firstValue(value.key_issues, value.issues, value.problems)
    if (nested) return formatIssue(nested)

    const field = asText(value.field || value.name || value.key)
    const expected = asText(value.expected ?? value.invoice ?? value.invoice_value)
    const actual = asText(value.actual ?? value.received ?? value.eway ?? value.eway_value)
    if (field && (expected || actual)) return `${field}: ${expected || '—'} vs ${actual || '—'}`
    if (field) return field

    return ''
  }

  return ''
}

const flattenIssues = (value, depth = 0) => {
  if (depth > 4 || !hasValue(value)) return []

  const parsed = parseJson(value)
  if (Array.isArray(parsed)) {
    return parsed.flatMap((entry) => flattenIssues(entry, depth + 1))
  }

  if (parsed && typeof parsed === 'object') {
    return formatIssue(parsed) ? [formatIssue(parsed)] : Object.values(parsed).flatMap((entry) => flattenIssues(entry, depth + 1))
  }

  const text = asText(parsed)
  return text ? [text] : []
}

const uniqueIssues = (issues) => {
  const seen = new Set()
  return issues.filter((issue) => {
    const normalized = issue.toLowerCase()
    if (seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

const isMismatchValue = (value) => {
  if (value === false) return true
  if (!hasValue(value)) return false
  if (typeof value === 'object') return Object.values(value).some(isMismatchValue)

  const text = String(value).toLowerCase().trim()
  return /mismatch|fail|reject|error|violation|discrep|invalid|not match|false|^no$/.test(text)
}

const humanizeMatchKey = (key) => key
  .replace(/_match$/i, '')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (character) => character.toUpperCase())

const collectMatchIssues = (source) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return []

  const issues = []
  for (const [key, value] of Object.entries(source)) {
    if (!key.toLowerCase().includes('match')) continue
    if (isMismatchValue(value)) {
      issues.push(humanizeMatchKey(key))
    } else if (value && typeof value === 'object') {
      issues.push(...collectMatchIssues(value))
    }
  }
  return issues
}

const getIssueTexts = (item, result) => {
  const sources = [
    item?.critical_mismatches,
    item?.warnings,
    item?.missing_documents,
    item?.inv_issues,
    item?.inv_warnings,
    item?.inv_missing_documents,
    result?.critical_mismatches,
    result?.warnings,
    result?.missing_documents,
    result?.issues,
    result?.output?.detailed_issues,
    result?.output?.field_issues,
    result?.output?.overall_summary?.key_issues
  ]

  const issues = sources.flatMap((source) => flattenIssues(source))
  issues.push(...collectMatchIssues(item))
  issues.push(...collectMatchIssues(result))
  return uniqueIssues(issues.map((issue) => issue.trim()).filter(Boolean))
}

const parseScore = (value) => {
  if (!hasValue(value)) return null
  const numericText = String(value).replace('%', '').replace(/[^0-9.-]/g, '')
  if (!numericText || !/[0-9]/.test(numericText)) return null
  const number = Number(numericText)
  return Number.isFinite(number) ? number : null
}

const parseAmount = (value) => {
  if (!hasValue(value)) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null

  const text = String(value).trim().toLowerCase()
  if (['n/a', 'na', '-', '--'].includes(text)) return null

  const multiplier = /crore|\bcr\b/.test(text)
    ? 10000000
    : /lakh|lac|\bl\b/.test(text)
      ? 100000
      : /thousand|\bk\b/.test(text)
        ? 1000
        : 1
  const numericText = text.replace(/[^0-9.-]/g, '')
  const number = Number(numericText)
  return Number.isFinite(number) ? number * multiplier : null
}

const parseDateValue = (value) => {
  if (!hasValue(value)) return null

  const date = new Date(value)
  if (!Number.isNaN(date.getTime())) return date

  const text = asText(value)
  const match = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  if (!match) return null

  const parsed = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const formatDate = (date) => date
  ? date.toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  : '—'

const formatCurrency = (value) => {
  if (value === null || value === undefined) return '—'
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(2)} Cr`
  if (value >= 100000) return `₹${(value / 100000).toFixed(2)} L`
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
}

const getPurchaseAmount = (item) => parseAmount(firstValue(
  item?.Total_Amount_Invoice,
  item?.Total_Amount_EWay,
  item?.Amount,
  item?.amount
))

const getSalesAmount = (item) => {
  const directAmount = parseAmount(firstValue(
    item?.inv_final_amount,
    item?.inv_taxable_value,
    item?.po_total_amount
  ))
  if (directAmount !== null) return directAmount

  const rate = parseScore(firstValue(item?.inv_rate, item?.so_rate, item?.po_rate))
  const quantity = parseScore(firstValue(item?.inv_quantity, item?.so_quantity, item?.po_quantity))
  return rate !== null && quantity !== null ? rate * quantity : null
}

const getSalesQuantity = (item) => parseScore(firstValue(
  item?.inv_quantity,
  item?.so_quantity,
  item?.po_quantity,
  item?.gp_quantity,
  item?.ws_net_weight
))

const getSalesUnit = (item) => asText(firstValue(
  item?.inv_unit,
  item?.so_unit,
  item?.po_unit,
  item?.gp_unit,
  item?.ws_unit
))

const getSalesTaxTotal = (item) => {
  const taxes = [item?.inv_cgst_amount, item?.inv_sgst_amount, item?.inv_igst_amount]
    .map(parseAmount)
    .filter((value) => value !== null)

  return taxes.length > 0 ? taxes.reduce((sum, value) => sum + value, 0) : null
}

const getSalesDocumentState = (item) => {
  const documentGroups = [
    [item?.inv_number, item?.inv_invoice_number, item?.tax_invoice_number, item?.invoice_number, item?.['Invoice Number']],
    [item?.inv_party_order_number, item?.inv_po_number, item?.po_number, item?.so_po_number],
    [item?.inv_order_number, item?.so_number, item?.order_number],
    [item?.gp_number],
    [item?.ws_number]
  ]
  const available = documentGroups.filter((group) => group.some(hasValue)).length

  return {
    available,
    total: documentGroups.length,
    complete: available === documentGroups.length
  }
}

const formatNumber = (value, maximumFractionDigits = 1) => value === null || value === undefined
  ? '—'
  : value.toLocaleString('en-IN', { maximumFractionDigits })

const formatQuantity = (value, unit) => {
  if (value === null || value === undefined) return '—'
  return `${formatNumber(value)}${unit ? ` ${unit}` : ''}`
}

const getReference = (item, isPurchase) => {
  if (isPurchase) {
    return {
      primaryLabel: 'Batch',
      primary: asText(firstValue(item?.Batch_Code_Invoice)) || '—',
      secondaryLabel: 'EWB',
      secondary: asText(firstValue(item?.EWB_Number_EWay, item?.Invoice_Number_EWay)) || '—'
    }
  }

  return {
    primaryLabel: 'Coil / Order',
    primary: asText(firstValue(
      item?.inv_number,
      item?.inv_invoice_number,
      item?.inv_coil_number,
      item?.inv_order_number,
      item?.so_coil_number,
      item?.gp_coil_number,
      item?.so_number,
      item?.po_number
    )) || '—',
      secondaryLabel: 'PO / Order',
      secondary: asText(firstValue(
        item?.inv_party_order_number,
        item?.inv_po_number,
        item?.po_number,
        item?.so_po_number,
        item?.gp_po_number,
        item?.gp_so_number,
        item?.ws_number
      )) || '—',
    gatePassLabel: 'Gate Pass',
    gatePass: asText(firstValue(
      item?.gp_number,
      item?.gp_gate_pass_number,
      item?.gate_pass_number
    )) || '—'
  }
}

const getPurchaseDocumentState = (item) => {
  const documentGroups = [
    [item?.Invoice_Number_Invoice, item?.inv_number, item?.tax_invoice_number, item?.invoice_number],
    [item?.EWB_Number_EWay, item?.Invoice_Number_EWay, item?.ewb_number],
    [item?.Batch_Code_Invoice, item?.batch_code, item?.batch_number],
    [item?.Supplier_Name_Invoice, item?.supplier_name, item?.vendor_name]
  ]
  const available = documentGroups.filter((group) => group.some(hasValue)).length

  return {
    available,
    total: documentGroups.length,
    complete: available === documentGroups.length
  }
}

const getPurchaseTaxTotal = (item) => {
  const taxes = [
    item?.CGST_Invoice,
    item?.SGST_Invoice,
    item?.IGST_Invoice,
    item?.Tax_Amount,
    item?.cgst_amount,
    item?.sgst_amount,
    item?.igst_amount
  ]
    .map(parseAmount)
    .filter((value) => value !== null)

  return taxes.length > 0 ? taxes.reduce((sum, value) => sum + value, 0) : null
}

const getPurchaseQuantity = (item) => parseScore(firstValue(
  item?.Quantity_Invoice,
  item?.Billed_Quantity,
  item?.Net_Weight,
  item?.Quantity,
  item?.qty
))

const getPurchaseUnit = (item) => asText(firstValue(
  item?.Unit_Invoice,
  item?.Quantity_Unit,
  item?.unit
))

const normalizeRecord = (item, side, index) => {
  const isPurchase = side === 'purchase'
  const result = getAuditResult(item)
  const issues = getIssueTexts(item, result)
  const score = parseScore(firstValue(
    item?.inv_audit_score,
    item?.audit_score,
    result?.overall?.final_score,
    result?.overall_summary?.average_score,
    result?.score,
    item?.Score,
    item?.score
  ))
  const status = resolveStatus(getStatusCandidates(item, result), issues, score)
  const identity = asText(firstValue(
    isPurchase ? item?.Invoice_Number_Invoice : item?.inv_number,
    isPurchase ? undefined : item?.inv_invoice_number,
    isPurchase ? undefined : item?.inv_coil_number,
    isPurchase ? undefined : item?.inv_order_number,
    isPurchase ? undefined : item?.so_number,
    isPurchase ? undefined : item?.so_coil_number,
    isPurchase ? undefined : item?.po_number,
    item?.id
  )) || `${isPurchase ? 'PUR' : 'SAL'}-${index + 1}`
  const party = asText(firstValue(
    isPurchase ? item?.Supplier_Name_Invoice : item?.inv_bill_to_name,
    isPurchase ? undefined : item?.inv_customer_name,
    isPurchase ? undefined : item?.inv_party_name,
    isPurchase ? undefined : item?.so_customer_name,
    isPurchase ? undefined : item?.po_customer_name,
    isPurchase ? undefined : item?.po_supplier_name,
    isPurchase ? undefined : item?.sheet_bill_to_name
  )) || 'Unknown party'
  const reference = getReference(item, isPurchase)
  const date = parseDateValue(firstValue(
    isPurchase ? item?.created_at : item?.inv_date,
    isPurchase ? item?.Invoice_Date_Invoice : item?.inv_invoice_date,
    isPurchase ? undefined : item?.created_at,
    isPurchase ? undefined : item?.so_date,
    isPurchase ? undefined : item?.po_date
  ))
  const amount = isPurchase ? getPurchaseAmount(item) : getSalesAmount(item)
  const quantity = isPurchase ? getPurchaseQuantity(item) : getSalesQuantity(item)
  const quantityUnit = isPurchase ? getPurchaseUnit(item) : getSalesUnit(item)
  const documentState = isPurchase ? getPurchaseDocumentState(item) : getSalesDocumentState(item)
  const taxTotal = isPurchase ? getPurchaseTaxTotal(item) : getSalesTaxTotal(item)
  const summary = asText(firstValue(
    item?.inv_audit_summary,
    item?.audit_summary,
    result?.audit_summary,
    result?.summary,
    result?.output?.overall_summary?.summary
  ))
  const displayIssues = issues.length > 0
    ? `${summary ? `${summary}: ` : ''}${issues.slice(0, 5).join('; ')}`
    : summary || (status === 'verified'
      ? 'All parameters verified against the available documents.'
      : status === 'unavailable'
        ? 'No audit status is available for this record.'
        : 'Audit is pending completion.')

  return {
    // The sales and quick-check ledgers have independent id sequences, so the
    // key is table-qualified to stay unique once both are merged.
    key: `${side}-${asText(item?.__uid || item?.id) || index}`,
    identity,
    party,
    partyLabel: isPurchase ? 'Supplier' : 'Customer / Party',
    amount,
    amountLabel: isPurchase ? 'Invoice amount' : 'Invoice value',
    quantity,
    quantityUnit,
    documentAvailable: documentState?.available || 0,
    documentTotal: documentState?.total || 0,
    documentComplete: documentState?.complete || false,
    taxTotal,
    reference,
    date,
    timestamp: date ? date.getTime() : 0,
    status,
    issuesCount: issues.length || (status === 'mismatch' ? 1 : 0),
    issuesText: displayIssues,
    score,
    raw: item
  }
}

const buildDashboardStats = (rows) => {
  const total = rows.length
  const statusCounts = rows.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1
    return counts
  }, {})
  const totalValue = rows.reduce((sum, row) => sum + (row.amount ?? 0), 0)
  const monthMap = new Map()

  rows.forEach((row) => {
    const date = row.date
    const monthKey = date
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      : 'unknown'
    const existing = monthMap.get(monthKey) || {
      month: date ? date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'Unknown',
      totalAudits: 0,
      verifiedMatches: 0,
      sort: date ? date.getFullYear() * 100 + date.getMonth() : Number.MAX_SAFE_INTEGER
    }
    existing.totalAudits += 1
    if (row.status === 'verified') existing.verifiedMatches += 1
    monthMap.set(monthKey, existing)
  })

  return {
    total,
    matchRate: total ? Math.round((statusCounts.verified || 0) / total * 100) : 0,
    discrepancyCount: statusCounts.mismatch || 0,
    totalValue,
    monthlyActivity: Array.from(monthMap.values()).sort((a, b) => a.sort - b.sort).slice(-8),
    statusData: STATUS_DEFINITIONS.map((definition) => ({
      ...definition,
      count: statusCounts[definition.key] || 0,
      percentage: total ? Math.round((statusCounts[definition.key] || 0) / total * 100) : 0
    }))
  }
}

const buildSalesStats = (rows) => {
  const pricedRows = rows.filter((row) => row.amount !== null)
  const scoredRows = rows.filter((row) => row.score !== null)
  const quantityRows = rows.filter((row) => row.quantity !== null)
  const taxRows = rows.filter((row) => row.taxTotal !== null)
  const unitCounts = new Map()

  quantityRows.forEach((row) => {
    if (row.quantityUnit) unitCounts.set(row.quantityUnit, (unitCounts.get(row.quantityUnit) || 0) + 1)
  })

  const quantityUnit = [...unitCounts.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] || 'units'
  const documentChecks = rows.reduce((sum, row) => sum + row.documentAvailable, 0)
  const possibleDocumentChecks = rows.reduce((sum, row) => sum + row.documentTotal, 0)
  const totalQuantity = quantityRows.length > 0
    ? quantityRows.reduce((sum, row) => sum + row.quantity, 0)
    : null
  const totalTax = taxRows.length > 0
    ? taxRows.reduce((sum, row) => sum + row.taxTotal, 0)
    : null

  return {
    averageOrderValue: pricedRows.length > 0
      ? pricedRows.reduce((sum, row) => sum + row.amount, 0) / pricedRows.length
      : null,
    averageScore: scoredRows.length > 0
      ? scoredRows.reduce((sum, row) => sum + row.score, 0) / scoredRows.length
      : null,
    customerCount: new Set(rows.filter((row) => row.party !== 'Unknown party').map((row) => row.party)).size,
    documentCoverageRate: possibleDocumentChecks > 0
      ? Math.round(documentChecks / possibleDocumentChecks * 100)
      : 0,
    completeDocumentCount: rows.filter((row) => row.documentComplete).length,
    totalQuantity,
    quantityUnit,
    quantityCount: quantityRows.length,
    totalTax,
    taxCount: taxRows.length,
    pricedCount: pricedRows.length,
    scoredCount: scoredRows.length
  }
}

const buildPurchaseStats = (rows) => {
  const pricedRows = rows.filter((row) => row.amount !== null)
  const scoredRows = rows.filter((row) => row.score !== null)
  const quantityRows = rows.filter((row) => row.quantity !== null)
  const taxRows = rows.filter((row) => row.taxTotal !== null)
  const unitCounts = new Map()

  quantityRows.forEach((row) => {
    if (row.quantityUnit) unitCounts.set(row.quantityUnit, (unitCounts.get(row.quantityUnit) || 0) + 1)
  })

  const quantityUnit = [...unitCounts.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0] || 'units'
  const documentChecks = rows.reduce((sum, row) => sum + row.documentAvailable, 0)
  const possibleDocumentChecks = rows.reduce((sum, row) => sum + row.documentTotal, 0)
  const totalQuantity = quantityRows.length > 0
    ? quantityRows.reduce((sum, row) => sum + row.quantity, 0)
    : null
  const totalTax = taxRows.length > 0
    ? taxRows.reduce((sum, row) => sum + row.taxTotal, 0)
    : null

  return {
    averageInvoiceValue: pricedRows.length > 0
      ? pricedRows.reduce((sum, row) => sum + row.amount, 0) / pricedRows.length
      : null,
    averageScore: scoredRows.length > 0
      ? scoredRows.reduce((sum, row) => sum + row.score, 0) / scoredRows.length
      : null,
    supplierCount: new Set(rows.filter((row) => row.party !== 'Unknown party').map((row) => row.party)).size,
    documentCoverageRate: possibleDocumentChecks > 0
      ? Math.round(documentChecks / possibleDocumentChecks * 100)
      : 0,
    completeDocumentCount: rows.filter((row) => row.documentComplete).length,
    totalQuantity,
    quantityUnit,
    quantityCount: quantityRows.length,
    totalTax,
    taxCount: taxRows.length,
    pricedCount: pricedRows.length,
    scoredCount: scoredRows.length
  }
}

const statusBadgeClass = (status) => {
  if (status === 'verified') return 'tag-verified'
  if (status === 'mismatch') return 'tag-mismatch'
  return 'tag-pending'
}

const SalesMetricCard = ({ icon, title, value, detail, tone = 'blue' }) => {
  const Icon = icon

  return (
    <div className={`sales-metric-card tone-${tone}`}>
      <div className="sales-metric-head">
        <span>{title}</span>
        <span className="sales-metric-icon"><Icon size={14} /></span>
      </div>
      <div className="sales-metric-value">{value}</div>
      <div className="sales-metric-detail">{detail}</div>
    </div>
  )
}

const Dashboard = () => {
  const [activeSide, setActiveSide] = useState('purchase')
  const [audits, setAudits] = useState([])
  const [salesAudits, setSalesAudits] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [tableSearch, setTableSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortOrder, setSortOrder] = useState('newest')
  const [rowLimit, setRowLimit] = useState('5')
  const [selectedAuditModal, setSelectedAuditModal] = useState(null)
  const requestIdRef = useRef(0)

  const loadData = useCallback(async (refresh = false) => {
    const side = activeSide
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId

    if (refresh) setIsRefreshing(true)
    else setIsLoading(true)
    setLoadError('')

    try {
      // The dashboard only reports the normal sales ledger — quick checks live
      // in their own table and are read from the History ledger toggle.
      const data = side === 'purchase' ? await fetchPurchaseRecords() : await fetchSalesRecords(salesLedgerSource(false))
      if (requestId !== requestIdRef.current) return

      if (side === 'purchase') setAudits(Array.isArray(data) ? data : [])
      else setSalesAudits(Array.isArray(data) ? data : [])
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      if (side === 'purchase') setAudits([])
      else setSalesAudits([])
      setLoadError(error instanceof Error ? error.message : 'Unable to load the audit ledger.')
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false)
        setIsRefreshing(false)
      }
    }
  }, [activeSide])

  useEffect(() => {
    loadData()
  }, [loadData])

  useSyncRefresh(() => loadData(true))

  const handleSideChange = (side) => {
    if (side === activeSide) return
    requestIdRef.current += 1
    setActiveSide(side)
    setStatusFilter('all')
    setTableSearch('')
    setSelectedAuditModal(null)
    setLoadError('')
  }

  const activeRecords = activeSide === 'purchase' ? audits : salesAudits
  const normalizedRows = useMemo(
    () => activeRecords.map((item, index) => normalizeRecord(item, activeSide, index)),
    [activeRecords, activeSide]
  )
  const isSales = activeSide === 'sales'
  
  const { tableRows, totalFilteredCount } = useMemo(() => {
    const query = tableSearch.trim().toLowerCase()

    const filtered = query
      ? normalizedRows.filter((row) => [row.identity, row.party, row.reference.primary, row.reference.secondary, row.reference.gatePass, row.issuesText]
        .some((value) => asText(value).toLowerCase().includes(query)))
      : normalizedRows

    const statusFiltered = statusFilter === 'all'
      ? filtered
      : filtered.filter((row) => row.status === statusFilter)

    const sortedRows = [...statusFiltered].sort((left, right) => {
      const difference = left.timestamp - right.timestamp
      return sortOrder === 'newest' ? -difference : difference
    })

    const limit = rowLimit === '5' ? 5 : sortedRows.length
    return {
      tableRows: sortedRows.slice(0, limit),
      totalFilteredCount: sortedRows.length
    }
  }, [normalizedRows, statusFilter, sortOrder, rowLimit, tableSearch])

  const dashboardStats = useMemo(() => buildDashboardStats(normalizedRows), [normalizedRows])
  const salesStats = useMemo(
    () => isSales ? buildSalesStats(normalizedRows) : null,
    [isSales, normalizedRows]
  )
  const purchaseStats = useMemo(
    () => !isSales ? buildPurchaseStats(normalizedRows) : null,
    [isSales, normalizedRows]
  )
  const tableTitle = isSales ? 'Recent Sales Audits' : 'Recent Purchase Audits'
  const tableSubtitle = isSales 
    ? 'Latest sales order, invoice, and logistics compliance records' 
    : 'Latest purchase invoice, e-way bill, and GRN compliance records'
  const searchPlaceholder = isSales ? 'Search order, customer, reference...' : 'Search invoice, supplier, reference...'
  const sourceLabel = isSales
    ? 'public."Audit Checker Sales"'
    : 'public."Audit Checker"'

  return (
    <div className="dashboard-wrapper">
      <div className="executive-header">
        <div className="header-text-block">
          <div className="header-meta-row">
            <span className="corp-name">ZV STEELS PVT. LTD.</span>
            <span className="meta-bullet">•</span>
            <span className="module-badge">{isSales ? 'SALES COMPLIANCE' : 'PURCHASE COMPLIANCE'}</span>
          </div>
          <h1 className="main-title">Executive Overview</h1>
          <p className="main-subtitle">Live {isSales ? 'sales' : 'purchase'} compliance data from the audit ledger</p>
        </div>

        <div className="header-action-block">
          <div className="audit-segment-control">
            <button
              type="button"
              className={`segment-btn ${!isSales ? 'active' : ''}`}
              onClick={() => handleSideChange('purchase')}
            >
              Purchase Audit
            </button>
            <button
              type="button"
              className={`segment-btn ${isSales ? 'active' : ''}`}
              onClick={() => handleSideChange('sales')}
            >
              Sales Audit
            </button>
          </div>

          <button
            type="button"
            className="btn btn-outline ledger-refresh-btn"
            onClick={() => loadData(true)}
            disabled={isRefreshing || isLoading}
          >
            {isRefreshing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
            <span>Refresh Ledger</span>
          </button>
        </div>
      </div>

      <div className="kpi-row-grid">
        <div className="kpi-panel">
          <div className="kpi-panel-head">
            <span className="kpi-title">{isSales ? 'Sales Orders Audited' : 'Invoices Audited'}</span>
            <FileText size={15} className="kpi-ico" />
          </div>
          <div className="kpi-num">{dashboardStats.total.toLocaleString('en-IN')}</div>
          <div className="kpi-sub">Active ledger entries</div>
        </div>

        <div className="kpi-panel">
          <div className="kpi-panel-head">
            <span className="kpi-title">Compliance Match Rate</span>
            <CheckCircle size={15} className="kpi-ico ico-success" />
          </div>
          <div className="kpi-num">{dashboardStats.matchRate}%</div>
          <div className="kpi-sub">Verified records across all documents</div>
        </div>

        <div className="kpi-panel">
          <div className="kpi-panel-head">
            <span className="kpi-title">Audit Discrepancies</span>
            <AlertTriangle size={15} className="kpi-ico ico-warning" />
          </div>
          <div className="kpi-num">{dashboardStats.discrepancyCount.toLocaleString('en-IN')}</div>
          <div className="kpi-sub">Requires review or action</div>
        </div>

        <div className="kpi-panel">
          <div className="kpi-panel-head">
            <span className="kpi-title">Total Audit Value</span>
            <span className="kpi-currency">₹</span>
          </div>
          <div className="kpi-num">{formatCurrency(dashboardStats.totalValue)}</div>
          <div className="kpi-sub">Live transactional volume</div>
        </div>
      </div>

      {isSales && salesStats && (
        <section className="sales-insights-section">
          <div className="section-heading-row">
            <div>
              <h2 className="section-title">Sales intelligence</h2>
              <p className="section-subtitle">Operational, financial, and document coverage signals</p>
            </div>
            <span className="section-data-note">Based on {dashboardStats.total.toLocaleString('en-IN')} sales records</span>
          </div>

          <div className="sales-metric-grid">
            <SalesMetricCard
              icon={ReceiptIndianRupee}
              title="Average order value"
              value={formatCurrency(salesStats.averageOrderValue)}
              detail={`${salesStats.pricedCount.toLocaleString('en-IN')} priced orders`}
              tone="blue"
            />
            <SalesMetricCard
              icon={Gauge}
              title="Average audit score"
              value={salesStats.averageScore === null ? '—' : `${formatNumber(salesStats.averageScore)}%`}
              detail={`${salesStats.scoredCount.toLocaleString('en-IN')} scored orders`}
              tone="green"
            />
            <SalesMetricCard
              icon={Users}
              title="Active customers"
              value={salesStats.customerCount.toLocaleString('en-IN')}
              detail="Distinct sales customers"
              tone="purple"
            />
            <SalesMetricCard
              icon={FileCheck2}
              title="Document coverage"
              value={`${salesStats.documentCoverageRate}%`}
              detail={`${salesStats.completeDocumentCount.toLocaleString('en-IN')} complete document sets`}
              tone="teal"
            />
            <SalesMetricCard
              icon={Boxes}
              title="Billed volume"
              value={formatQuantity(salesStats.totalQuantity, salesStats.quantityUnit)}
              detail={`${salesStats.quantityCount.toLocaleString('en-IN')} orders with quantity`}
              tone="blue"
            />
            <SalesMetricCard
              icon={ReceiptIndianRupee}
              title="Tax captured"
              value={formatCurrency(salesStats.totalTax)}
              detail={`${salesStats.taxCount.toLocaleString('en-IN')} tax records`}
              tone="green"
            />
          </div>
        </section>
      )}

      {!isSales && purchaseStats && (
        <section className="sales-insights-section">
          <div className="section-heading-row">
            <div>
              <h2 className="section-title">Purchase intelligence</h2>
              <p className="section-subtitle">Supplier, financial, and procurement compliance signals</p>
            </div>
            <span className="section-data-note">Based on {dashboardStats.total.toLocaleString('en-IN')} purchase records</span>
          </div>

          <div className="sales-metric-grid">
            <SalesMetricCard
              icon={ReceiptIndianRupee}
              title="Average invoice value"
              value={formatCurrency(purchaseStats.averageInvoiceValue)}
              detail={`${purchaseStats.pricedCount.toLocaleString('en-IN')} priced invoices`}
              tone="blue"
            />
            <SalesMetricCard
              icon={Gauge}
              title="Average audit score"
              value={purchaseStats.averageScore === null ? '—' : `${formatNumber(purchaseStats.averageScore)}%`}
              detail={`${purchaseStats.scoredCount.toLocaleString('en-IN')} scored invoices`}
              tone="green"
            />
            <SalesMetricCard
              icon={Users}
              title="Active suppliers"
              value={purchaseStats.supplierCount.toLocaleString('en-IN')}
              detail="Distinct purchase suppliers"
              tone="purple"
            />
            <SalesMetricCard
              icon={FileCheck2}
              title="Document coverage"
              value={`${purchaseStats.documentCoverageRate}%`}
              detail={`${purchaseStats.completeDocumentCount.toLocaleString('en-IN')} complete document sets`}
              tone="teal"
            />
            <SalesMetricCard
              icon={Boxes}
              title="Procured volume"
              value={formatQuantity(purchaseStats.totalQuantity, purchaseStats.quantityUnit)}
              detail={`${purchaseStats.quantityCount.toLocaleString('en-IN')} items with quantity`}
              tone="blue"
            />
            <SalesMetricCard
              icon={ReceiptIndianRupee}
              title="Tax captured"
              value={formatCurrency(purchaseStats.totalTax)}
              detail={`${purchaseStats.taxCount.toLocaleString('en-IN')} tax records`}
              tone="green"
            />
          </div>
        </section>
      )}

      <div className="charts-flex-grid">
        <div className="panel-box chart-panel-left">
          <div className="panel-box-header">
            <div>
              <h3 className="panel-title">Audit Activity</h3>
              <p className="panel-sub">Total audits vs verified matches</p>
            </div>
            <div className="chart-legend">
              <span className="leg-item"><span className="leg-dot slate"></span> Total Audits</span>
              <span className="leg-item"><span className="leg-dot green"></span> Verified Matches</span>
            </div>
          </div>

          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={dashboardStats.monthlyActivity} margin={{ top: 15, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" stroke="var(--text-muted)" tickLine={false} fontSize={11} />
                <YAxis stroke="var(--text-muted)" tickLine={false} fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                    borderRadius: '6px',
                    color: 'var(--text)',
                    fontSize: '11px'
                  }}
                  cursor={{ fill: 'rgba(127, 127, 127, 0.04)' }}
                />
                <Bar dataKey="totalAudits" name="Total Audits" fill="#718096" maxBarSize={32} />
                <Bar dataKey="verifiedMatches" name="Verified Matches" fill={COLOR_VERIFIED} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel-box chart-panel-right">
          <div className="panel-box-header">
            <div>
              <h3 className="panel-title">Verification Status</h3>
              <p className="panel-sub">Compliance distribution across ledger</p>
            </div>
          </div>

          <div className="donut-panel-content">
            <div className="donut-graphics">
              <ResponsiveContainer width={150} height={150}>
                <PieChart>
                  <Pie
                    data={dashboardStats.statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="count"
                    stroke="var(--surface)"
                  >
                    {dashboardStats.statusData.map((entry) => (
                      <Cell key={entry.key} fill={entry.color} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-center">
                <span className="donut-pct">{dashboardStats.matchRate}%</span>
                <span className="donut-lbl">Verified</span>
              </div>
            </div>

            <div className="status-legend-stack">
              {dashboardStats.statusData.map((item) => (
                <div key={item.key} className="status-legend-row">
                  <div className="status-legend-left">
                    <span className="sq-indicator" style={{ backgroundColor: item.color }}></span>
                    <span className="status-name">{item.name}</span>
                  </div>
                  <div className="status-legend-right">
                    <span className="status-count">{item.count.toLocaleString('en-IN')}</span>
                    <span className="status-pct">({item.percentage}%)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="panel-box table-panel">
        <div className="table-toolbar">
          <div>
            <h3 className="panel-title">{tableTitle}</h3>
            <p className="panel-sub">{tableSubtitle}</p>
          </div>

          <div className="table-toolbar-actions">
            <div className="toolbar-search-box">
              <Search size={13} className="search-ico" />
              <input
                type="text"
                placeholder={searchPlaceholder}
                value={tableSearch}
                onChange={(event) => setTableSearch(event.target.value)}
              />
              {tableSearch && (
                <button type="button" className="clear-btn" onClick={() => setTableSearch('')}>
                  <X size={11} />
                </button>
              )}
            </div>

            <div className="toolbar-select-box">
              <Filter size={12} className="select-ico" />
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="toolbar-select"
                aria-label="Filter by status"
              >
                <option value="all">All Statuses</option>
                <option value="verified">Verified</option>
                <option value="mismatch">Discrepancies</option>
                <option value="pending">Pending</option>
                <option value="unavailable">Not Available</option>
              </select>
            </div>

            <button
              type="button"
              className="btn btn-outline sort-toggle-btn"
              onClick={() => setSortOrder((current) => current === 'newest' ? 'oldest' : 'newest')}
              title="Toggle sort direction"
            >
              <ArrowUpDown size={12} />
              <span>{sortOrder === 'newest' ? 'Newest' : 'Oldest'}</span>
            </button>

            <button
              type="button"
              className={`btn btn-outline limit-toggle-btn ${rowLimit === '5' ? 'active-limit' : ''}`}
              onClick={() => setRowLimit((current) => current === '5' ? 'all' : '5')}
              title="Toggle rows display limit"
            >
              <span>{rowLimit === '5' ? 'Top 5' : 'All'}</span>
            </button>
          </div>
        </div>

        <div className="table-scroll-container">
          <table className="dense-audit-table">
            <thead>
              <tr>
                <th style={{ width: '16%' }}>{isSales ? 'Invoice / Order' : 'Invoice ID'}</th>
                <th style={{ width: '32%' }}>{isSales ? 'Customer / Party' : 'Supplier'}</th>
                <th style={{ width: '20%' }}>Reference Tracking</th>
                <th style={{ width: '12%' }}>Audit Value</th>
                <th style={{ width: '12%' }}>Audit Date</th>
                <th style={{ width: '8%' }}>Status</th>
                <th style={{ width: '0%', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="state-cell">
                    <SquareWaveLoader count={5} size={7} gap={4} className="text-primary" />
                    <span>Querying {isSales ? 'sales' : 'purchase'} ledger...</span>
                  </td>
                </tr>
              ) : loadError ? (
                <tr>
                  <td colSpan={7} className="state-cell">{loadError}</td>
                </tr>
              ) : tableRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="state-cell">No matching audit entries found.</td>
                </tr>
              ) : (
                tableRows.map((row) => (
                  <tr key={row.key}>
                    <td className="cell-id"><span>{row.identity}</span></td>
                    <td className="cell-party"><span title={row.party}>{row.party}</span></td>
                    <td className="cell-ref">
                      <div className="ref-lines">
                        <span>{row.reference.primaryLabel}: <strong>{row.reference.primary}</strong></span>
                        <span className="muted">{row.reference.secondaryLabel}: <strong>{row.reference.secondary}</strong></span>
                        {row.reference.gatePass && (
                          <span className="muted">{row.reference.gatePassLabel}: <strong>{row.reference.gatePass}</strong></span>
                        )}
                      </div>
                    </td>
                    <td className="cell-val"><span>{formatCurrency(row.amount)}</span></td>
                    <td className="cell-date"><span>{formatDate(row.date)}</span></td>
                    <td className="cell-badge">
                      <span className={`badge-tag ${statusBadgeClass(row.status)}`}>
                        {row.status === 'verified' && '✓ Verified'}
                        {row.status === 'mismatch' && `⚠ ${row.issuesCount} Issue${row.issuesCount === 1 ? '' : 's'}`}
                        {row.status === 'pending' && 'Pending'}
                        {row.status === 'unavailable' && 'Not Available'}
                      </span>
                    </td>
                    <td className="cell-act" style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="eye-btn"
                        onClick={() => setSelectedAuditModal(row)}
                        title="View audit details"
                        aria-label={`View details for ${row.identity}`}
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer">
          <span>Showing {tableRows.length} of {totalFilteredCount} {isSales ? 'sales' : 'purchase'} audit entries</span>
          <span>Data source: {sourceLabel}</span>
        </div>
      </div>

      {selectedAuditModal && (
        <div className="modal-backdrop" onClick={() => setSelectedAuditModal(null)}>
          <div className="modal-content-box" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header-row">
              <div>
                <span className="modal-kicker">AUDIT DISCREPANCY REPORT</span>
                <h3 className="modal-title-text">{selectedAuditModal.identity}</h3>
              </div>
              <button type="button" className="modal-close" onClick={() => setSelectedAuditModal(null)} aria-label="Close details">
                <X size={16} />
              </button>
            </div>

            <div className="modal-body-area">
              <div className="modal-info-grid">
                <div className="info-block">
                  <span className="info-lbl">{selectedAuditModal.partyLabel}</span>
                  <span className="info-val">{selectedAuditModal.party}</span>
                </div>
                <div className="info-block">
                  <span className="info-lbl">{selectedAuditModal.amountLabel}</span>
                  <span className="info-val">{formatCurrency(selectedAuditModal.amount)}</span>
                </div>
                <div className="info-block">
                  <span className="info-lbl">{selectedAuditModal.reference.primaryLabel}</span>
                  <span className="info-val">{selectedAuditModal.reference.primary}</span>
                </div>
                <div className="info-block">
                  <span className="info-lbl">{selectedAuditModal.reference.secondaryLabel}</span>
                  <span className="info-val">{selectedAuditModal.reference.secondary}</span>
                </div>
                {selectedAuditModal.reference.gatePass && (
                  <div className="info-block">
                    <span className="info-lbl">{selectedAuditModal.reference.gatePassLabel}</span>
                    <span className="info-val">{selectedAuditModal.reference.gatePass}</span>
                  </div>
                )}
                <div className="info-block">
                  <span className="info-lbl">Audit Date</span>
                  <span className="info-val">{formatDate(selectedAuditModal.date)}</span>
                </div>
                <div className="info-block">
                  <span className="info-lbl">Status</span>
                  <span className={`info-val ${selectedAuditModal.status === 'verified' ? 'clr-success' : 'clr-warning'}`}>
                    {selectedAuditModal.status === 'verified' && '✓ Verified'}
                    {selectedAuditModal.status === 'mismatch' && `⚠ ${selectedAuditModal.issuesCount} issue${selectedAuditModal.issuesCount === 1 ? '' : 's'}`}
                    {selectedAuditModal.status === 'pending' && 'Pending'}
                    {selectedAuditModal.status === 'unavailable' && 'Not available'}
                  </span>
                </div>
              </div>

              <div className={`modal-remarks-card ${selectedAuditModal.status === 'verified' ? 'verified' : ''}`}>
                <div className="remarks-top">
                  <Info size={13} />
                  <span>Audit Remarks & Discrepancy Log</span>
                </div>
                <p className="remarks-text">
                  {selectedAuditModal.score !== null ? `Compliance score: ${selectedAuditModal.score}%. ` : ''}
                  {selectedAuditModal.issuesText}
                </p>
              </div>
            </div>

            <div className="modal-footer-row">
              <button type="button" className="btn btn-outline" onClick={() => setSelectedAuditModal(null)}>
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard
