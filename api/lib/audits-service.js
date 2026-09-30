import { readLedgerTable } from './supabase-server.js'

export async function handleAuditsRequest(req) {
  return readLedgerTable(req, {
    table: 'Audit Checker',
    configError: 'AUDITS_CONFIG',
    logPrefix: 'audits',
    errorMessage: 'Unable to load purchase audit data'
  })
}
