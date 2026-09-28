import { createClient } from '@supabase/supabase-js'
import { verifyFirebaseToken } from './verify-firebase.js'

let supabase = null

function getSupabase() {
  if (!supabase) {
    const url = process.env.SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceRoleKey) throw new Error('Supabase configuration is missing')
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

export async function handleAuditsRequest(req) {
  if (req.method !== 'GET') return { status: 405, json: { error: 'Method not allowed' } }

  const token = getBearerToken(req)
  if (!token) return { status: 401, json: { error: 'Authentication required' } }
  if (!process.env.FIREBASE_PROJECT_ID) return { status: 500, json: { error: 'Authentication service is not configured' } }

  try {
    await verifyFirebaseToken(token)
  } catch (error) {
    console.error('audits: auth failed', error.message)
    return { status: 401, json: { error: 'Invalid or expired token' } }
  }

  try {
    const { data, error } = await getSupabase()
      .schema('public')
      .from('Audit Checker')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Supabase audits error:', error.message)
      return { status: 500, json: { error: 'Unable to load purchase audit data' } }
    }
    return { status: 200, json: { data: data || [] } }
  } catch (error) {
    console.error('Supabase audits request failed:', error.message)
    return { status: 500, json: { error: 'Unable to load purchase audit data' } }
  }
}
