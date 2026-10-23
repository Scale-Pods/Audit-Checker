import React, { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Users as UsersIcon, ShieldCheck, Loader2, X, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { fetchUsers, createUser, updateUser, deleteUser } from '../../api/users'
import { PebbleSelect } from '@/components/ui/pebble-select'
import { SquareWaveLoader } from '@/components/ui/square-wave-loader'
import './Users.css'

// Developer accounts are provisioned directly in the database, so the
// dropdown only offers the roles a manager can assign from here.
const ROLE_OPTIONS = [
  { value: 'Admin', label: 'Admin' },
  { value: 'sales', label: 'Sales' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'both', label: 'Sales + Purchase' },
]

const formatTimestamp = (val) => {
  if (val === null || val === undefined || val === '') return '—';
  const date = new Date(val);
  if (Number.isNaN(date.getTime())) return String(val);
  return date.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};

const roleTone = (access) => {
  const role = String(access || '').toLowerCase();
  if (role === 'admin') return { bg: 'rgba(239,68,68,0.12)', text: '#ef4444', border: 'rgba(239,68,68,0.25)' };
  if (role === 'developer') return { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6', border: 'rgba(59,130,246,0.25)' };
  if (role === 'sales') return { bg: 'rgba(16,185,129,0.12)', text: '#10b981', border: 'rgba(16,185,129,0.25)' };
  if (role === 'purchase') return { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.25)' };
  if (role === 'both') return { bg: 'rgba(139,92,246,0.12)', text: '#a78bfa', border: 'rgba(139,92,246,0.25)' };
  return { bg: 'rgba(100,116,139,0.12)', text: '#94a3b8', border: 'rgba(100,116,139,0.25)' };
};

const emptyForm = () => ({ email: '', pass: '', access: 'sales' });

const Users = () => {
  const { currentUser } = useAuth();
  const myId = currentUser?.id ? Number(currentUser.id) : null;

  const [users, setUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [modal, setModal] = useState(null); // null | { mode: 'create' } | { mode: 'edit', user }
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError('');
    try {
      setUsers(await fetchUsers());
    } catch (err) {
      setError(err?.message || 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3500);
  };

  const openCreate = () => {
    setForm(emptyForm());
    setFormError('');
    setModal({ mode: 'create' });
  };

  const openEdit = (user) => {
    setForm({ email: user.email || '', pass: '', access: user.access || 'sales' });
    setFormError('');
    setModal({ mode: 'edit', user });
  };

  const closeModal = () => {
    if (saving) return;
    setModal(null);
    setFormError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (modal.mode === 'create') {
        await createUser({ email: form.email, pass: form.pass, access: form.access });
        showNotice('User created.');
      } else {
        // A role never selected in the modal (e.g. developer) is kept unless
        // the manager actually picked a different one.
        const accessChanged = form.access !== (modal.user.access || 'sales');
        await updateUser({
          id: modal.user.id,
          email: form.email || undefined,
          pass: form.pass,
          access: accessChanged ? form.access : undefined,
        });
        showNotice('User updated.');
      }
      setModal(null);
      await load(true);
    } catch (err) {
      setFormError(err?.message || 'Could not save the user');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (user) => {
    if (myId !== null && myId === Number(user.id)) {
      alert('You cannot delete your own account.');
      return;
    }
    if (!window.confirm(`Delete user ${user.email || ''}? This cannot be undone.`)) return;
    try {
      await deleteUser(user.id);
      showNotice('User deleted.');
      await load(true);
    } catch (err) {
      setError(err?.message || 'Failed to delete user');
    }
  };

  return (
    <div className="history-page users-page animate-fade-in">
      <div className="page-header mb-8">
        <div className="flex-between ledger-heading-row mb-2">
          <div>
            <h1 className="page-title">User Management</h1>
            <p className="page-subtitle">Control access to the audit workspace &amp; assign roles</p>
          </div>
          <button className="pebble-btn add-user-btn" onClick={openCreate}>
            <Plus size={15} className="pebble-btn-icon" />
            <span>Add User</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="users-notice animate-fade-in">
          <CheckCircle2 size={16} />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="users-error animate-fade-in">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)' }}>
        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem 0' }}>
            <SquareWaveLoader />
          </div>
        ) : users.length === 0 ? (
          <div className="users-empty">
            <UsersIcon size={36} style={{ opacity: 0.4 }} />
            <p>No users yet. Add the first account to get started.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="comparison-table users-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Access</th>
                  <th>Last Login</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const tone = roleTone(user.access);
                  const isMe = myId !== null && myId === Number(user.id);
                  return (
                    <tr key={user.id}>
                      <td className="data-cell" data-label="Email">
                        <span className="user-email-cell">
                          <span className="user-email-icon"><UsersIcon size={13} /></span>
                          {user.email || '—'}
                          {isMe && <span className="me-tag">You</span>}
                        </span>
                      </td>
                      <td className="data-cell" data-label="Access">
                        <span className="role-chip" style={{ ...tone }}>
                          <ShieldCheck size={11} />
                          {user.access || '—'}
                        </span>
                      </td>
                      <td className="data-cell" data-label="Last Login" style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {formatTimestamp(user['last login'] || user.last_login)}
                      </td>
                      <td className="status-cell" data-label="Actions" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="row-action-btn" onClick={() => openEdit(user)} title="Edit user" aria-label={`Edit ${user.email}`}>
                          <Pencil size={14} />
                        </button>
                        <button className="row-action-btn danger" onClick={() => handleDelete(user)} disabled={isMe} title={isMe ? 'You cannot delete your own account' : 'Delete user'} aria-label={`Delete ${user.email}`}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <div className="users-modal-overlay" onClick={closeModal}>
          <div className="users-modal" onClick={(e) => e.stopPropagation()}>
            <div className="users-modal-head">
              <h3>{modal.mode === 'create' ? 'Add User' : 'Edit User'}</h3>
              <button className="users-modal-close" onClick={closeModal} aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              {formError && (
                <div className="users-error animate-fade-in">
                  <AlertCircle size={15} />
                  <span>{formError}</span>
                </div>
              )}

              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  className="user-input"
                  placeholder="name@company.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label>{modal.mode === 'create' ? 'Password' : 'New Password (leave blank to keep current)'}</label>
                <input
                  type="password"
                  className="user-input"
                  placeholder="••••••••••••"
                  value={form.pass}
                  onChange={(e) => setForm({ ...form, pass: e.target.value })}
                  required={modal.mode === 'create'}
                />
              </div>

              <div className="form-group">
                <label>Access Role</label>
                <PebbleSelect
                  value={form.access}
                  options={ROLE_OPTIONS}
                  onChange={(value) => setForm({ ...form, access: value })}
                  icon={ShieldCheck}
                  ariaLabel="Access role"
                />
                {modal.mode === 'edit' && (modal.user.access || '').toLowerCase() === 'developer' && (
                  <p className="role-hint role-hint-warn">Current role: Developer &#8212; leave the dropdown untouched to keep it, or pick another role to change it.</p>
                )}
                <p className="role-hint">Admin &amp; Developer get full access; Sales + Purchase combines both audit areas. Developer accounts are provisioned in the database.</p>
              </div>

              <div className="users-modal-actions">
                <button type="button" className="pebble-btn" onClick={closeModal}>Cancel</button>
                <button type="submit" className="pebble-btn add-user-btn solid" disabled={saving}>
                  {saving ? (<><Loader2 size={15} className="spin-icon" /> Saving...</>) : (modal.mode === 'create' ? 'Create User' : 'Save Changes')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Users;