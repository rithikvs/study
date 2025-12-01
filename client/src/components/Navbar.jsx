import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import api from '../lib/api';

export default function Navbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { authUser, setAuthUser } = useApp();

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
    <header className="sticky top-0 z-50 glass border-b border-white/20">
      <nav className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="w-10 h-10 bg-purple-600 rounded-xl flex items-center justify-center group-hover:scale-110 transition">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <span className="text-xl font-bold gradient-text">StudyHub</span>
        </Link>
        
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className={`px-4 py-2 rounded-xl font-medium transition ${
              pathname === '/' 
                ? 'bg-purple-600 text-white shadow-md' 
                : 'text-slate-700 hover:bg-white/50'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
              Home
            </span>
          </Link>
          
          <Link
            to="/dashboard"
            className={`px-4 py-2 rounded-xl font-medium transition ${
              pathname.startsWith('/dashboard') 
                ? 'bg-purple-600 text-white shadow-md' 
                : 'text-slate-700 hover:bg-white/50'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zM14 13a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z" />
              </svg>
              Dashboard
            </span>
          </Link>
          
          {authUser ? (
            <>
              <div className="glass px-4 py-2 rounded-xl ml-2">
                <span className="text-sm text-slate-600">Welcome, </span>
                <strong className="text-purple-600">{authUser.name}</strong>
              </div>
              <button
                onClick={handleSignOut}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium shadow-md hover:shadow-lg transition flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign Out
              </button>
            </>
          ) : (
            <Link
              to="/auth"
              className="px-4 py-2 rounded-xl font-medium transition ml-2 bg-purple-600 hover:bg-purple-700 text-white shadow-md hover:shadow-lg"
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                Sign In
              </span>
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}