import { getSupabase } from './supabase-server.js'
import { verifySessionToken } from './verify-session.js'
import { readJsonBody } from './login-service.js'

const USERS_TABLE = 'Users_AC'
const ACCESS_ROLES = ['Admin', 'developer', 'sales', 'purchase', 'both']
const MANAGER_ROLES = ['admin', 'developer']

function getBearerToken(req) {
  const headers = req?.headers || {}
  const header = headers.authorization ?? headers.Authorization ?? ''
  return typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : null
}

const normalizeAccess = (access) => {
  const value = String(access || '').trim()
  const match = ACCESS_ROLES.find(role => role.toLowerCase() === value.toLowerCase())
  return match || null
}

// Keeps emails case-insensitive: the login lookup is .ilike + lowercase match,
// so a stored address and a typed address must be compared the same way.
const sameEmail = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

const parseId = (value) => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

const toId = (id) => (id === null || id === undefined ? id : Number(id))

async function authManager(req) {
  const token = getBearerToken(req)
  if (!token) return { status: 401, json: { error: 'Authentication required' } }

  let payload = null
  try {
    payload = await verifySessionToken(token)
  } catch (error) {
    console.error('users: auth failed', error.message)
    return { status: 401, json: { error: 'Invalid or expired token' } }
  }

  const access = normalizeAccess(payload.access)
  if (!access || !MANAGER_ROLES.includes(access.toLowerCase())) {
    return { status: 403, json: { error: 'Access denied' } }
  }
  return { payload }
}

async function findEmailConflicts(supabase, email, excludeId = null) {
  const { data, error } = await supabase
    .schema('public')
    .from(USERS_TABLE)
    .select('id, email')
    .ilike('email', email.trim())
    .limit(1)
  if (error) return { error }
  const row = (data || []).find(r => sameEmail(r.email, email))
  if (row && toId(row.id) !== toId(excludeId)) return { conflict: row }
  return {}
}

const listQuery = (supabase) =>
  supabase
    .schema('public')
    .from(USERS_TABLE)
    .select('id, email, access, "last login"')
    .order('created_at', { ascending: true })

async function handleList() {
  const { data, error } = await listQuery(getSupabase('SUPABASE_CONFIG_MISSING'))
  if (error) {
    console.error('users: list failed', error.message)
    return { status: 500, json: { error: 'Failed to load users' } }
  }
  return { status: 200, json: { data: data || [] } }
}

async function handleCreate(body) {
  const email = String(body?.email || '').trim()
  const pass = String(body?.pass || '')
  const access = normalizeAccess(body?.access)

  if (!email || !email.includes('@')) return { status: 400, json: { error: 'A valid email is required' } }
  if (!pass) return { status: 400, json: { error: 'A password is required' } }
  if (!access) return { status: 400, json: { error: 'Access must be one of: Admin, developer, sales, purchase' } }
  if (access.toLowerCase() === 'developer') {
    return { status: 400, json: { error: 'Developer accounts are provisioned in the database and cannot be added here' } }
  }

  const supabase = getSupabase('SUPABASE_CONFIG_MISSING')
  const dupes = await findEmailConflicts(supabase, email)
  if (dupes.error) {
    console.error('users: duplicate check failed', dupes.error.message)
    return { status: 500, json: { error: 'Failed to create user' } }
  }
  if (dupes.conflict) return { status: 409, json: { error: 'A user with this email already exists' } }

  const { data, error } = await supabase
    .schema('public')
    .from(USERS_TABLE)
    .insert({ email, pass, access })
    .select('id, email, access, "last login"')
    .single()
  if (error) {
    console.error('users: create failed', error.message)
    return { status: 500, json: { error: 'Failed to create user' } }
  }
  return { status: 201, json: { data } }
}

async function handleUpdate(body) {
  const id = parseId(body?.id)
  if (!id) return { status: 400, json: { error: 'A valid user id is required' } }

  const updates = {}
  if (body?.email !== undefined) {
    const email = String(body.email).trim()
    if (!email.includes('@')) return { status: 400, json: { error: 'A valid email is required' } }
    updates.email = email
  }
  if (body?.pass !== undefined && String(body.pass) !== '') {
    updates.pass = String(body.pass)
  }
  if (body?.access !== undefined) {
    const access = normalizeAccess(body.access)
    if (!access) return { status: 400, json: { error: 'Access must be one of: Admin, developer, sales, purchase' } }
    if (access.toLowerCase() === 'developer') {
      return { status: 400, json: { error: 'Developer accounts are provisioned in the database and cannot be added here' } }
    }
    updates.access = access
  }
  if (Object.keys(updates).length === 0) {
    return { status: 400, json: { error: 'Nothing to update' } }
  }

  const supabase = getSupabase('SUPABASE_CONFIG_MISSING')

  if (updates.email) {
    const dupes = await findEmailConflicts(supabase, updates.email, id)
    if (dupes.error) {
      console.error('users: duplicate check failed', dupes.error.message)
      return { status: 500, json: { error: 'Failed to update user' } }
    }
    if (dupes.conflict) return { status: 409, json: { error: 'A user with this email already exists' } }
  }

  const { data, error } = await supabase
    .schema('public')
    .from(USERS_TABLE)
    .update(updates)
    .eq('id', id)
    .select('id, email, access, "last login"')
    .maybeSingle()
  if (error) {
    console.error('users: update failed', error.message)
    return { status: 500, json: { error: 'Failed to update user' } }
  }
  if (!data) return { status: 404, json: { error: 'User not found' } }
  return { status: 200, json: { data } }
}

async function handleDelete(body, payload) {
  const id = parseId(body?.id)
  if (!id) return { status: 400, json: { error: 'A valid user id is required' } }

  // Protect the account behind the token - a manager deleting themselves
  // would lock the remaining managers out of this screen with no recovery.
  const subjectId = parseId(payload?.sub)
  if (subjectId === id) {
    return { status: 400, json: { error: 'You cannot delete your own account' } }
  }

  const supabase = getSupabase('SUPABASE_CONFIG_MISSING')
  const { data, error } = await supabase
    .schema('public')
    .from(USERS_TABLE)
    .delete()
    .eq('id', id)
    .select('id')
    .single()
  if (error) {
    console.error('users: delete failed', error.message)
    return { status: 500, json: { error: 'Failed to delete user' } }
  }
  if (!data) return { status: 404, json: { error: 'User not found' } }
  return { status: 200, json: { ok: true } }
}

export async function handleUsersRequest(req) {
  try {
    const auth = await authManager(req)
    if (auth.status) return auth

    const body = req.method === 'GET' ? {} : await readJsonBody(req)

    switch (req.method) {
      case 'GET':
        return await handleList()
      case 'POST':
        return await handleCreate(body)
      case 'PATCH':
        return await handleUpdate(body)
      case 'DELETE':
        return await handleDelete(body, auth.payload)
      default:
        return { status: 405, json: { error: 'Method not allowed' } }
    }
  } catch (error) {
    console.error('users: unexpected failure', error.message)
    return { status: 500, json: { error: 'User management service unavailable' } }
  }
}