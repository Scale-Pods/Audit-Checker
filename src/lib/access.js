// Role -> route map for the Users_AC `access` column (Admin, developer, sales,
// purchase, both). Access values are compared case-insensitively.
//
//   admin / developer  → everything, including user management
//   both               → both audit areas (dashboard, purchase, sales, history)
//   sales              → sales dashboard, sales audit, sales history
//   purchase           → purchase dashboard, purchase audit, purchase history
//
// Anything the table does not recognise falls back to the dashboard alone so a
// bad row can never leak an audit area or lock the user in a redirect loop.

const ALL_ROUTES = ['/dashboard', '/purchase', '/sales', '/analytics', '/history', '/users']
const BOTH_ROUTES = ['/dashboard', '/purchase', '/sales', '/analytics', '/history']
const SALES_ROUTES = ['/dashboard', '/sales', '/history']
const PURCHASE_ROUTES = ['/dashboard', '/purchase', '/history']
const FALLBACK_ROUTES = ['/dashboard']

const ROLE_ROUTES = {
  admin: ALL_ROUTES,
  developer: ALL_ROUTES,
  both: BOTH_ROUTES,
  sales: SALES_ROUTES,
  purchase: PURCHASE_ROUTES,
}

export const normalizeAccess = (access) => String(access || '').trim().toLowerCase()

export const allowedRoutes = (access) =>
  ROLE_ROUTES[normalizeAccess(access)] || FALLBACK_ROUTES

export const canAccess = (access, path) => allowedRoutes(access).includes(path)

export const formatAccess = (access) => {
  const value = String(access || '').trim()
  if (!value) return 'Auditor'
  return value.charAt(0).toUpperCase() + value.slice(1)
}