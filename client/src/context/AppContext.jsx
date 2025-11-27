import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import api from '../lib/api';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [userName, setUserName] = useState(() => localStorage.getItem('userName') || '');
  const [groups, setGroups] = useState([]);

  const [authUser, setAuthUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    localStorage.setItem('userName', userName || '');
  }, [userName]);

  // Fetch user data and their rooms from database
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          if (mounted) {
            setAuthUser(null);
            setGroups([]);
            setAuthLoading(false);
          }
          return;
        }
        
        // Get user info
        const { data } = await api.get('/auth/me');
        if (!mounted) return;
        
        if (!data.user) {
          // Token is invalid
          localStorage.removeItem('token');
          setAuthUser(null);
          setGroups([]);
          setAuthLoading(false);
          return;
        }
        
        setAuthUser(data.user);
        
        // Get user's rooms from database
        try {
          const roomsRes = await api.get('/auth/my-rooms');
          if (mounted) setGroups(roomsRes.data.groups || []);
        } catch (roomErr) {
          console.error('Failed to fetch rooms:', roomErr);
          // Don't fail auth if rooms fetch fails
          if (mounted) setGroups([]);
        }
      } catch (err) {
        console.error('Auth check failed:', err);
        // If token is invalid, clear it
        localStorage.removeItem('token');
        if (mounted) {
          setAuthUser(null);
          setGroups([]);
        }
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