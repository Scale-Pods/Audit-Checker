import React, { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'audit_session';

const readSession = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.token || !session?.exp) return null;
    if (Date.now() >= session.exp) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
};

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(readSession);

  const login = async (email, password) => {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, pass: password }),
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON error body */
    }

    if (!res.ok) {
      throw new Error(data?.error || 'Invalid credentials. Please verify your access.');
    }

    const next = {
      token: data.token,
      user: data.user,
      exp: Date.now() + (data.expiresIn || 4 * 60 * 60) * 1000,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSession(next);
    return next;
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setSession(null);
  };

  // Sessions expire after 4 hours - drop the moment the clock runs out.
  useEffect(() => {
    if (!session) return undefined;
    const remaining = session.exp - Date.now();
    const timer = setTimeout(logout, Math.max(remaining, 0));
    return () => clearTimeout(timer);
  }, [session]);

  const value = {
    currentUser: session?.user || null,
    accessToken: session?.token || null,
    access: session?.user?.access || null,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
