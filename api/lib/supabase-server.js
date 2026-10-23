import { createClient } from '@supabase/supabase-js'
import { verifySessionToken } from './verify-session.js'

let supabase = null

export function getSupabase(configError) {
  if (!supabase) {
    const url = process.env.SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const missing = []
    if (!url) missing.push('SUPABASE_URL')
    if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
    if (missing.length) {
      const error = new Error(`Missing server environment variable(s) on the host: ${missing.join(', ')}`)
      error.code = configError
      throw error
    }
    supabase = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  }
  return supabase
}

function getBearerToken(req) {
  const headers = req?.headers || {}
  const header = headers.authorization ?? headers.Authorization ?? ''
  return typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : null
}

const normalizeAccess = (access) => String(access || '').trim().toLowerCase()

// Every audit ledger is read the same way: check the caller, check that the
// caller's role owns this ledger, then select the whole table newest-first.
// Checking a token alone was not enough - a sales-only account could call the
// purchase endpoint directly and read a ledger its UI never showed.
export async function readLedgerTable(req, { table, configError, logPrefix, errorMessage, allowedAccess }) {
  if (req.method !== 'GET') return { status: 405, json: { error: 'Method not allowed' } }

  const token = getBearerToken(req)
  if (!token) return { status: 401, json: { error: 'Authentication required' } }

  let payload
  try {
    payload = await verifySessionToken(token)
  } catch (error) {
    console.error(`${logPrefix}: auth failed`, error.message)
    return { status: 401, json: { error: 'Invalid or expired token' } }
  }

  if (Array.isArray(allowedAccess) && !allowedAccess.includes(normalizeAccess(payload?.access))) {
    return { status: 403, json: { error: 'Your account does not have access to this ledger' } }
  }

  try {
    const { data, error } = await getSupabase(configError)
      .schema('public')
      .from(table)
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error(`Supabase ${logPrefix} error:`, error.message)
      return { status: 500, json: { error: errorMessage } }
    }
    return { status: 200, json: { data: data || [] } }
  } catch (error) {
    console.error(`Supabase ${logPrefix} request failed:`, error.message)
    return {
      status: 500,
      json: {
        error: error.code === configError
          ? error.message
          : errorMessage
      }
    }
  }
}
