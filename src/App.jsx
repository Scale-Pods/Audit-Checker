import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import MainLayout from './components/Layout'
import LoginPage from './pages/Auth/LoginPage'
import SignupPage from './pages/Auth/SignupPage'
import Dashboard from './pages/Dashboard/Dashboard'
import PurchaseAudit from './pages/Purchase/PurchaseAudit'
import SalesAudit from './pages/Sales/SalesAudit'
import Analytics from './pages/Analytics/Analytics'
import AuditHistory from './pages/History/AuditHistory'
import Users from './pages/Users/Users'
import SidebarDemo from './pages/SidebarDemo/SidebarDemo'

import { AuthProvider, useAuth } from './context/AuthContext'
import { SyncProvider } from './context/SyncContext'
import { canAccess } from './lib/access'
import Login from './pages/Login/Login'

const ProtectedRoute = ({ children }) => {
  const { currentUser } = useAuth();
  const location = useLocation();

  if (!currentUser) {
    // Carry the full direct link (including ?so=... share params) through the
    // login round-trip instead of dropping everyone on the dashboard.
    const next = `${location.pathname}${location.search}${location.hash}`;
    const loginPath = next && next !== '/login'
      ? `/login?next=${encodeURIComponent(next)}`
      : '/login';
    return <Navigate to={loginPath} replace />;
  }

  return children;
};

// Blocks routes the signed-in user's `access` role does not cover. Everyone
// can reach /dashboard, so an unauthorised hit always lands there safely.
const RoleRoute = ({ path, children }) => {
  const { access } = useAuth();
  if (!canAccess(access, path)) return <Navigate to="/dashboard" replace />;
  return children;
};

const App = () => {
  return (
    <AuthProvider>
      <SyncProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route 
              path="/" 
              element={
                <ProtectedRoute>
                  <MainLayout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Navigate to="/history" replace />} />
              <Route path="dashboard" element={<RoleRoute path="/dashboard"><Dashboard /></RoleRoute>} />
              <Route path="purchase" element={<RoleRoute path="/purchase"><PurchaseAudit /></RoleRoute>} />
              <Route path="sales" element={<RoleRoute path="/sales"><SalesAudit /></RoleRoute>} />
              <Route path="analytics" element={<RoleRoute path="/analytics"><Analytics /></RoleRoute>} />
              <Route path="history" element={<RoleRoute path="/history"><AuditHistory /></RoleRoute>} />
              <Route path="users" element={<RoleRoute path="/users"><Users /></RoleRoute>} />
            </Route>
            <Route path="*" element={<Navigate to="/history" replace />} />
            <Route
              path="/sidebar-demo"
              element={
                <ProtectedRoute>
                  <SidebarDemo />
                </ProtectedRoute>
              }
            />
          </Routes>
        </Router>
      </SyncProvider>
    </AuthProvider>
  )
}

export default App
