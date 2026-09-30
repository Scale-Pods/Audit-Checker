import { readLedgerTable } from './supabase-server.js'

// Quick entries (the SO-vs-PO check) live in their own table. The columns are
// identical to the main sales ledger, so the same reader and the same record
// shape are used — only the table name differs.
export async function handleSalesQuickCheckRequest(req) {
  return readLedgerTable(req, {
    table: 'Audit Checker Sales_QC',
    configError: 'SALES_QC_CONFIG',
    logPrefix: 'sales-qc',
    errorMessage: 'Unable to load sales quick check data'
  })
}
