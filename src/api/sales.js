import { auth } from '../firebase'

export const fetchSalesRecords = async () => {
  let token = null
  if (auth.currentUser) {
    try {
      token = await auth.currentUser.getIdToken()
    } catch (e) {
      console.warn('Could not get auth token:', e)
    }
  }

  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  const res = await fetch('/api/sales', { headers })

  if (!res.ok) {
    let message = `Failed to load sales data (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      /* keep default message */
    }
    throw new Error(message)
  }

  const json = await res.json()
  return Array.isArray(json.data) ? json.data : []
}