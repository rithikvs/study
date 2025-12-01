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
    <header className="sticky top-0 z-50 bg-white/70 backdrop-blur border-b border-slate-200">
      <nav className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
        <Link to="/" className="text-xl font-bold text-primary">StudyHub</Link>
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className={`px-3 py-2 rounded hover:bg-slate-100 ${pathname === '/' ? 'text-primary' : 'text-slate-600'}`}
          >Home</Link>
          <Link
            to="/dashboard"
            className={`px-3 py-2 rounded hover:bg-slate-100 ${pathname.startsWith('/dashboard') ? 'text-primary' : 'text-slate-600'}`}
          >Dashboard</Link>
          {authUser ? (
            <>
              <span className="text-sm text-slate-600">
                Logged in as <strong>{authUser.name}</strong>
              </span>
              <button
                onClick={handleSignOut}
                className="px-3 py-2 rounded bg-red-50 text-red-600 hover:bg-red-100"
              >
                Sign Out
              </button>
            </>
          ) : (
            <Link
              to="/auth"
              className={`px-3 py-2 rounded hover:bg-slate-100 ${pathname.startsWith('/auth') ? 'text-primary' : 'text-slate-600'}`}
            >Sign In</Link>
          )}
        </div>
      </nav>
    </header>
  );
}