import React from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import MainLayout from './components/Layout'
import LoginPage from './pages/Auth/LoginPage'
import SignupPage from './pages/Auth/SignupPage'
import Dashboard from './pages/Dashboard/Dashboard'
import PurchaseAudit from './pages/Purchase/PurchaseAudit'
import SalesAudit from './pages/Sales/SalesAudit'
import Analytics from './pages/Analytics/Analytics'
import AuditHistory from './pages/History/AuditHistory'
import SidebarDemo from './pages/SidebarDemo/SidebarDemo'

import { AuthProvider, useAuth } from './context/AuthContext'
import { SyncProvider } from './context/SyncContext'
import Login from './pages/Login/Login'

const ProtectedRoute = ({ children }) => {
  const { currentUser } = useAuth();
  if (!currentUser) return <Navigate to="/login" replace />;
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
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="purchase" element={<PurchaseAudit />} />
              <Route path="sales" element={<SalesAudit />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="history" element={<AuditHistory />} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
            <Route path="/sidebar-demo" element={<SidebarDemo />} />
          </Routes>
        </Router>
      </SyncProvider>
    </AuthProvider>
  )
}

export default App
