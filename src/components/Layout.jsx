import React, { useState, useEffect } from 'react'
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom'
import { 
  LayoutDashboard, 
  ShoppingBag, 
  TrendingUp, 
  FileText, 
  History, 
  LogOut,
  Bell,
  Search,
  User,
  Sun,
  Moon,
  Menu,
  X
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import './Layout.css'

const SidebarItem = ({ to, icon, label, onClick }) => {
  const location = useLocation()
  const Icon = icon
  const isActive = location.pathname === to

  return (
    <Link 
      to={to} 
      className={`sidebar-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
    >
      <Icon size={20} />
      <span>{label}</span>
    </Link>
  )
}

const Layout = () => {
  const navigate = useNavigate()
  const { currentUser, logout } = useAuth()
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isSearchVisible, setIsSearchVisible] = useState(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light')
  }

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
      
      <aside className={`sidebar ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-container" style={{ flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '15px', width: '100%', padding: '1rem 0' }}>
            <img src="https://zvsteels.com/assets/img/zv_logo.png" alt="ZV Steels" style={{ height: '80px', objectFit: 'contain', filter: 'var(--zv-filter)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>
              <span>Powered By</span>
              <div style={{ height: '24px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '3px' }}>
                <img src="https://framerusercontent.com/images/sTvMZBHEzwH4fTjPgKO2PS3htho.png?scale-down-to=2048&width=2363&height=2363" alt="Scalepods" style={{ width: '90px', filter: 'var(--scalepods-filter)' }} />
              </div>
            </div>
          </div>
        </div>
        
        <nav className="sidebar-nav">
          <div className="nav-group">
            <p className="nav-group-title">MAIN</p>
            <SidebarItem to="/dashboard" icon={LayoutDashboard} label="Dashboard" onClick={closeMobileMenu} />
            <SidebarItem to="/analytics" icon={TrendingUp} label="Analytics" onClick={closeMobileMenu} />
          </div>

          <div className="nav-group">
            <p className="nav-group-title">AUDIT MODULES</p>
            <SidebarItem to="/purchase" icon={ShoppingBag} label="Purchase Audit" onClick={closeMobileMenu} />
            <SidebarItem to="/sales" icon={FileText} label="Sales Audit" onClick={closeMobileMenu} />
          </div>

          <div className="nav-group">
            <p className="nav-group-title">RECORDS</p>
            <SidebarItem to="/history" icon={History} label="Audit History" onClick={closeMobileMenu} />
          </div>
        </nav>

        <div className="sidebar-footer">
          <button onClick={handleLogout} className="logout-btn">
            <LogOut size={20} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-menu-toggle" onClick={toggleMobileMenu}>
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
            <div className={`topbar-search ${isSearchVisible ? 'mobile-visible' : ''}`}>
              <Search size={18} className="search-icon" />
              <input type="text" placeholder="Search audits..." />
              <button className="search-close" onClick={() => setIsSearchVisible(false)}><X size={18} /></button>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="action-btn mobile-only" onClick={() => setIsSearchVisible(true)}>
              <Search size={20} />
            </button>
            <button className="action-btn" onClick={toggleTheme}>
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
            <button className="action-btn"><Bell size={20} /></button>
            <div className="user-profile">
              <div className="user-avatar" style={{ overflow: 'hidden' }}>
                {currentUser?.photoURL ? (
                  <img src={currentUser.photoURL} alt="User profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <User size={18} />
                )}
              </div>
              <span className="user-name" style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentUser?.email?.split('@')[0] || 'Auditor'}
              </span>
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
