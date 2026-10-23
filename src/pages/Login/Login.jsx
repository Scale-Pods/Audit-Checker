import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, Loader2, AlertCircle } from 'lucide-react';
import './Login.css';

const LOGO_URL = 'https://www.zvsteels.com/assets/img/zv_logo.png';
const DEFAULT_LANDING = '/history';

// Only same-site absolute paths are accepted. This keeps ?next= from being
// used as an open redirect while preserving direct links like
// /history?so=INV-123 through the login round-trip.
const safeNextPath = (value) => {
  if (typeof value !== 'string') return DEFAULT_LANDING;
  const next = value.trim();
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return DEFAULT_LANDING;
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) return DEFAULT_LANDING;
  return next;
};

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchParams] = useSearchParams();
  const { login, currentUser } = useAuth();
  const navigate = useNavigate();
  const target = safeNextPath(searchParams.get('next'));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate(target, { replace: true });
    } catch (err) {
      setError(err?.message || 'Invalid credentials. Please verify your access.');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (currentUser) return <Navigate to={target} replace />;

  return (
    <div className="login-container">
      <div className="login-card animate-slide-up">
        <div className="login-header">
          <div className="login-logo">
            <img src={LOGO_URL} alt="ZV Steels" />
          </div>
          <h1>Audit Intelligence</h1>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error animate-fade-in">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="input-group">
            <label>Authorized Email</label>
            <div className="input-field">
              <Mail size={18} className="field-icon" />
              <input
                type="email"
                placeholder="identity@audit-checker.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="input-group">
            <label>Security Key</label>
            <div className="input-field">
              <Lock size={18} className="field-icon" />
              <input
                type="password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <button type="submit" className="login-btn" disabled={isSubmitting}>
            {isSubmitting ? (
              <><Loader2 size={20} className="spin-icon" /> Authenticating...</>
            ) : (
              'Enter Command Center'
            )}
          </button>
        </form>

        <div className="login-footer">
          <p>Access restricted to authorized auditors only.</p>
          <p>© 2026 Audit Checker Intelligence</p>
        </div>
      </div>
    </div>
  );
};

export default Login;
