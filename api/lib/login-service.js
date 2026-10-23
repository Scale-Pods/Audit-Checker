import { SignJWT } from 'jose'
import { getSupabase } from './supabase-server.js'

const TOKEN_TTL_SECONDS = 12 * 60 * 60 // 12 hours
const USERS_TABLE = 'Users_AC'

function getSecret() {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    const error = new Error('Missing server environment variable on the host: AUTH_SECRET')
    error.code = 'AUTH_SECRET_MISSING'
    throw error
  }
  return new TextEncoder().encode(secret)
}

// Vercel parses JSON bodies into req.body; the vite dev middleware hands over
// an unread stream. Both shapes are accepted so one handler serves both.
export async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object') return req.body
    if (typeof req.body === 'string') {
      try { return req.body ? JSON.parse(req.body) : {} } catch { return {} }
    }
  }
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  try { return raw ? JSON.parse(raw) : {} } catch { return {} }
}

export async function handleLoginRequest(req) {
  if (req.method !== 'POST') return { status: 405, json: { error: 'Method not allowed' } }

  const { email, pass } = await readJsonBody(req)
  if (typeof email !== 'string' || !email.trim() || typeof pass !== 'string' || !pass) {
    return { status: 400, json: { error: 'Email and password are required' } }
  }

  let supabase
  try {
    supabase = getSupabase('SUPABASE_CONFIG_MISSING')
  } catch (error) {
    console.error('login: config failed', error.message)
    return { status: 500, json: { error: error.message } }
  }

  try {
    const { data, error } = await supabase
      .schema('public')
      .from(USERS_TABLE)
      .select('id, email, pass, access')
      .ilike('email', email.trim())
      .limit(1)

    if (error) {
      console.error('login: Users_AC lookup failed', error.message)
      return { status: 500, json: { error: 'Authentication service unavailable' } }
    }

    const user = (data || []).find(
      row => row.email && row.email.toLowerCase() === email.trim().toLowerCase()
    )

    if (!user || user.pass !== pass) {
      return { status: 401, json: { error: 'Invalid credentials. Please verify your access.' } }
    }

    // Best effort - a failed audit-trail write must not block the login.
    const { error: updateError } = await supabase
      .schema('public')
      .from(USERS_TABLE)
      .update({ 'last login': new Date().toISOString() })
      .eq('id', user.id)
    if (updateError) {
      console.error('login: last login update failed', updateError.message)
    }

    const token = await new SignJWT({ email: user.email, access: user.access || '' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(user.id))
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
      .sign(getSecret())

    return {
      status: 200,
      json: {
        token,
        user: { id: user.id, email: user.email, access: user.access || '' },
        expiresIn: TOKEN_TTL_SECONDS,
      },
    }
  } catch (error) {
    if (error.code === 'AUTH_SECRET_MISSING' || error.code === 'SUPABASE_CONFIG_MISSING') {
      return { status: 500, json: { error: error.message } }
    }
    console.error('login: unexpected failure', error.message)
    return { status: 500, json: { error: 'Authentication service unavailable' } }
  }
}
