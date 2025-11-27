import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '../lib/api';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [userName, setUserName] = useState(() => localStorage.getItem('userName') || '');
  const [groups, setGroups] = useState(() => {
    const saved = localStorage.getItem('groups');
    return saved ? JSON.parse(saved) : [];
  });

  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    localStorage.setItem('userName', userName || '');
  }, [userName]);

  useEffect(() => {
    localStorage.setItem('groups', JSON.stringify(groups || []));
  }, [groups]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          if (mounted) {
            setAuthUser(null);
            setAuthLoading(false);
          }
          return;
        }
        const { data } = await api.get('/auth/me');
        if (mounted) setAuthUser(data.user || null);
      } catch (err) {
        console.error('Auth check failed:', err);
        // If token is invalid, clear it
        localStorage.removeItem('token');
        if (mounted) setAuthUser(null);
      } finally {
        if (mounted) setAuthLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const value = useMemo(() => ({
    userName,
    setUserName,
    groups,
    setGroups,
    authUser,
    setAuthUser,
    authLoading,
  }), [userName, groups, authUser, authLoading]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  return useContext(AppContext);
}