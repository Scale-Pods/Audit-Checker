import React, { useState, useEffect } from 'react'
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom'
import { 
  LayoutDashboard, 
  ShoppingBag, 
  TrendingUp, 
  FileText, 
  History, 
  LogOut,
  Search,
  User,
  Menu,
  X,
  RefreshCw,
  Calendar,
  Layers
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSync } from '../context/SyncContext'
import { ThemeToggle } from './ui/theme-toggle'
import './Layout.css'

const SidebarItem = ({ to, icon, label, disabled = false, badgeText = null, onClick, className = '' }) => {
  const location = useLocation()
  const Icon = icon
  const isActive = location.pathname === to

  if (disabled) {
    return (
      <div className={`sidebar-item disabled ${className}`}>
        <Icon size={18} />
        <div className="sidebar-item-content">
          <span>{label}</span>
          {badgeText && <span className="dev-badge">{badgeText}</span>}
        </div>
      </div>
    )
  }

  return (
    <Link 
      to={to} 
      className={`sidebar-item ${isActive ? 'active' : ''} ${className}`}
      onClick={onClick}
    >
      <Icon size={18} />
      <span>{label}</span>
    </Link>
  )
}

const Layout = () => {
  const navigate = useNavigate()
  const { currentUser, logout } = useAuth()
  const { isSyncing, syncNow } = useSync()
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isSearchVisible, setIsSearchVisible] = useState(false)
  const [dateRange, setDateRange] = useState('30d')

  useEffect(() => {
    const stored = localStorage.getItem('theme') || 'dark'
    document.documentElement.setAttribute('data-theme', stored)
  }, [])

  const handleLogout = async () => {
    try {
      await logout()
      navigate('/login')
    } catch (error) {
      console.error('Failed to log out', error)
    }
  }

  const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen)
  const closeMobileMenu = () => setIsMobileMenuOpen(false)

  return (
    <div className="app-container">
      {isMobileMenuOpen && <div className="mobile-overlay" onClick={closeMobileMenu}></div>}
      
      {/* ── Left Sidebar ── */}
      <aside className={`sidebar ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="enterprise-brand">
            <div className="brand-logo-wrap">
              <img 
                src="https://zvsteels.com/assets/img/zv_logo.png" 
                alt="ZV Steels" 
                className="zv-logo-img" 
              />
            </div>
          </div>
        </div>

        <div className="sidebar-divider" />
        
        <nav className="sidebar-nav">
          <div className="nav-group">
            <p className="nav-group-title">Overview</p>
            <SidebarItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" onClick={closeMobileMenu} />
            <SidebarItem to="/analytics" icon={TrendingUp} label="Analytics" onClick={closeMobileMenu} />
          </div>

          <div className="nav-group">
            <p className="nav-group-title">Audits</p>
            <SidebarItem to="/purchase" icon={ShoppingBag} label="Purchase Audit" onClick={closeMobileMenu} />
            <SidebarItem to="/sales" icon={FileText} label="Sales Audit" onClick={closeMobileMenu} />
            <SidebarItem 
              to="#" 
              icon={Layers} 
              label="TDC to MTC Checker" 
              disabled={true} 
              badgeText="Future Scope" 
            />
          </div>

          <div className="nav-group">
            <p className="nav-group-title">Records</p>
            <SidebarItem to="/history" icon={History} label="Audit History" onClick={closeMobileMenu} className="sidebar-item-large" />
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-footer-divider" />
          <div className="theme-toggle-slot">
            <ThemeToggle />
          </div>
          <div className="power-tag">
            <span>Powered by Scalepods</span>
          </div>
          <button onClick={handleLogout} className="logout-btn">
            <LogOut size={18} />
            <span>Log out</span>
          </button>
        </div>
      </aside>

      {/* ── Main Top Bar Navigation ── */}
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu-toggle" onClick={toggleMobileMenu}>
              {isMobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <div className={`topbar-search ${isSearchVisible ? 'mobile-visible' : ''}`}>
              <Search size={15} className="search-icon" />
              <input 
                type="text" 
                placeholder="Search invoices, suppliers, audit ID..." 
                id="global-search-input"
              />
              <button className="search-close" onClick={() => setIsSearchVisible(false)}>
                <X size={15} />
              </button>
            </div>
            <button 
              className="mobile-menu-toggle topbar-search-toggle" 
              onClick={() => setIsSearchVisible(v => !v)}
              title="Search"
              aria-label="Toggle search"
            >
              <Search size={18} />
            </button>
          </div>

          <div className="topbar-actions">
            {/* Date Range Picker */}
            <div className="date-picker-wrap">
              <Calendar size={13} className="date-icon" />
              <select 
                value={dateRange} 
                onChange={(e) => setDateRange(e.target.value)}
                className="date-select"
              >
                <option value="30d">Last 30 Days</option>
                <option value="90d">Q3 2026</option>
                <option value="ytd">Year to Date</option>
              </select>
            </div>

            {/* Sync Data Button */}
            <button 
              className={`btn btn-outline sync-btn ${isSyncing ? 'syncing' : ''}`}
              onClick={syncNow}
              disabled={isSyncing}
              title="Synchronize real-time audit ledger"
            >
              <RefreshCw size={13} className={isSyncing ? 'spin' : ''} />
              <span className="sync-label">{isSyncing ? 'Syncing' : 'Sync Data'}</span>
            </button>

            {/* User Profile */}
            <div className="user-profile">
              <div className="user-avatar">
                <User size={15} />
              </div>
              <div className="user-info">
                <span className="user-name">
                  {currentUser?.email?.split('@')[0] || 'Auditor'}
                </span>
                <span className="user-role">Finance Auditor</span>
              </div>
            </div>
          </div>
        </header>

        <div className="content-inner">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export default Layout
