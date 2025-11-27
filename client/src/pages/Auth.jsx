import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import api from '../lib/api';
import { useApp } from '../context/AppContext';

export default function Auth() {
  const navigate = useNavigate();
  const { setAuthUser } = useApp();
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      let data;
      if (mode === 'register') {
        ({ data } = await api.post('/auth/register', { name, email, password }));
        alert(`Welcome, ${data.user.name}`);
      } else {
        ({ data } = await api.post('/auth/login', { email, password }));
        alert(`Welcome back, ${data.user.name}`);
      }
      // Ensure context has the logged-in user
      try {
        const me = await api.get('/auth/me');
        setAuthUser(me.data.user || null);
      } catch {}
      navigate('/dashboard');
    } catch (err) {
      const msg = err?.response?.data?.message || 'Auth failed';
      alert(msg);
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-100">
      <Navbar />
      <main className="mx-auto max-w-md px-4 py-12">
        <div className="bg-white rounded-2xl p-6 shadow-glow border border-slate-200">
          <div className="flex gap-2 mb-4">
            <button
              className={`flex-1 px-4 py-2 rounded-lg border ${mode === 'login' ? 'border-primary text-primary' : 'border-slate-200'}`}
              onClick={() => setMode('login')}
            >Login</button>
            <button
              className={`flex-1 px-4 py-2 rounded-lg border ${mode === 'register' ? 'border-primary text-primary' : 'border-slate-200'}`}
              onClick={() => setMode('register')}
            >Register</button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'register' && (
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                className="w-full px-4 py-3 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            )}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full px-4 py-3 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-4 py-3 rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-white font-medium py-3 rounded-lg hover:bg-primary-dark disabled:opacity-50"
            >
              {loading ? 'Please wait...' : (mode === 'login' ? 'Login' : 'Create Account')}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}