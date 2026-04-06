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

const App = () => {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="purchase" element={<PurchaseAudit />} />
          <Route path="sales" element={<SalesAudit />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="history" element={<AuditHistory />} />
        </Route>
      </Routes>
    </Router>
  )
}

export default App
