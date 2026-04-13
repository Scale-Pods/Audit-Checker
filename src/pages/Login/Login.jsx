import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Mail, Lock, Loader2, AlertCircle } from 'lucide-react';
import './Login.css';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError('Invalid credentials. Please verify your access.');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card animate-slide-up">
        <div className="login-header">
          <div className="login-logo">
            <ShieldCheck size={48} className="logo-icon" />
          </div>
          <h1>Audit Intelligence</h1>
          <p>Global Surveillance & Compliance Portal</p>
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
