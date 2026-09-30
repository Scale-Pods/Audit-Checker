import { readLedgerTable } from './supabase-server.js'

export async function handleSalesRequest(req) {
  return readLedgerTable(req, {
    table: 'Audit Checker Sales',
    configError: 'SALES_CONFIG',
    logPrefix: 'sales',
    errorMessage: 'Unable to load sales audit data'
  })
}
