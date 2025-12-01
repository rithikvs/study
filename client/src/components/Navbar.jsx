import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { useTheme } from '../context/ThemeContext';
import api from '../lib/api';

export default function Navbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { authUser, setAuthUser } = useApp();
  const { theme, toggleTheme } = useTheme();

  async function handleSignOut() {
    try {
      await api.post('/auth/logout');
      setAuthUser(null);
      localStorage.removeItem('token');
      navigate('/');
    } catch (err) {
      console.error('Sign out error:', err);
      // Force sign out locally even if API fails
      setAuthUser(null);
      localStorage.removeItem('token');
      navigate('/');
    }
  }

  return (
    <header className="sticky top-0 z-50 bg-white/70 dark:bg-slate-800/70 backdrop-blur border-b border-slate-200 dark:border-slate-700 transition-colors duration-300">
      <nav className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold text-primary">StudyHub</Link>
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className={`px-3 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${pathname === '/' ? 'text-primary' : 'text-slate-600 dark:text-slate-300'}`}
          >Home</Link>
          <Link
            to="/dashboard"
            className={`px-3 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${pathname.startsWith('/dashboard') ? 'text-primary' : 'text-slate-600 dark:text-slate-300'}`}
          >Dashboard</Link>
          
          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-all duration-300"
            aria-label="Toggle theme"
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? (
              <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            )}
          </button>

          {authUser ? (
            <>
              <span className="text-sm text-slate-600 dark:text-slate-300">
                Logged in as <strong>{authUser.name}</strong>
              </span>
              <button
                onClick={handleSignOut}
                className="px-3 py-2 rounded bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
              >
                Sign Out
              </button>
            </>
          ) : (
            <Link
              to="/auth"
              className={`px-3 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${pathname.startsWith('/auth') ? 'text-primary' : 'text-slate-600 dark:text-slate-300'}`}
            >Sign In</Link>
          )}
        </div>
      </nav>
    </header>
  );
}