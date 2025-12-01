import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import api from '../lib/api';
import { useApp } from '../context/AppContext';

export default function Home() {
  const navigate = useNavigate();
  const { userName, setUserName, groups, setGroups, authUser } = useApp();
  const [groupName, setGroupName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [loadingCreate, setLoadingCreate] = useState(false);
  const [loadingJoin, setLoadingJoin] = useState(false);

  async function createGroup() {
    try {
      setLoadingCreate(true);
      const { data } = await api.post('/groups', { name: groupName.trim() });
      // Add to local state
      setGroups([{ 
        _id: data.group._id,
        name: data.group.name, 
        roomCode: data.group.roomCode,
        createdBy: data.group.createdBy
      }, ...groups]);
      navigate(`/room/${data.group.roomCode}`);
    } catch (err) {
      const msg = err?.response?.data?.message || 'Failed to create group';
      alert(msg);
      console.error(err);
    } finally {
      setLoadingCreate(false);
    }
  }

  async function joinGroup() {
    try {
      setLoadingJoin(true);
      const { data } = await api.post('/groups/join', { roomCode: joinCode.trim().toUpperCase() });
      // Add to local state if not already present
      const exists = groups.some((g) => g.roomCode === data.group.roomCode);
      if (!exists) {
        setGroups([{ 
          _id: data.group._id,
          name: data.group.name, 
          roomCode: data.group.roomCode,
          createdBy: data.group.createdBy
        }, ...groups]);
      }
      navigate(`/room/${data.group.roomCode}`);
    } catch (err) {
      const msg = err?.response?.data?.message || 'Invalid room code';
      alert(msg);
      console.error(err);
    } finally {
      setLoadingJoin(false);
    }
  }

  const gated = !authUser;

  return (
    <div className="min-h-screen relative">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-16 fade-in">
        {/* Hero Section */}
        <section className="text-center mb-16">
          <div className="inline-block mb-4">
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 text-white text-sm font-medium">
              <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              Real-time Collaboration
            </span>
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-white mb-6 animate-float">
            StudyHub
          </h1>
          <p className="text-xl md:text-2xl text-white/90 max-w-3xl mx-auto font-light leading-relaxed">
            Create group rooms, share notes, collaborate with whiteboards, and work together in real-time.
            <br />
            <span className="text-white/70 text-lg">Fast, simple, and beautifully designed.</span>
          </p>
        </section>

        {/* Cards Section */}
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* Create Group Card */}
          <section className="slide-in-left">
            <div className="glass rounded-3xl p-8 shadow-glow card-hover">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold gradient-text">Create Group</h2>
              </div>
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name (e.g., Operating Systems Unit-2)"
                className="w-full px-5 py-4 rounded-xl border-2 border-slate-200 focus:border-purple-500 focus:ring-4 focus:ring-purple-500/20 transition-all outline-none text-slate-700 font-medium"
              />
              <button
                onClick={createGroup}
                disabled={gated || !groupName.trim() || loadingCreate}
                className="mt-4 w-full bg-gradient-to-r from-blue-500 to-purple-600 text-white font-semibold py-4 rounded-xl hover:shadow-xl hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 transition-all duration-300 flex items-center justify-center gap-2"
              >
                {loadingCreate ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Creating...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Create New Group
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Join Group Card */}
          <section className="slide-in-right">
            <div className="glass rounded-3xl p-8 shadow-glow card-hover">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 rounded-xl bg-gradient-to-br from-green-500 to-teal-600">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold gradient-text">Join Group</h2>
              </div>
              <div className="flex gap-3">
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="Enter ROOM CODE"
                  className="flex-1 px-5 py-4 rounded-xl border-2 border-slate-200 focus:border-green-500 focus:ring-4 focus:ring-green-500/20 transition-all outline-none text-slate-700 font-bold tracking-wider text-center text-lg"
                />
                <button
                  onClick={joinGroup}
                  disabled={gated || !joinCode.trim() || loadingJoin}
                  className="bg-gradient-to-r from-green-500 to-teal-600 text-white font-semibold px-8 rounded-xl hover:shadow-xl hover:scale-105 disabled:opacity-50 disabled:hover:scale-100 transition-all duration-300"
                >
                  {loadingJoin ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    'Join'
                  )}
                </button>
              </div>
              <p className="mt-4 text-sm text-slate-600 text-center">
                Enter the 6-character room code to join an existing group
              </p>
            </div>
          </section>
        </div>

        {gated && (
          <div className="mt-8 glass rounded-2xl p-6 max-w-4xl mx-auto border-2 border-yellow-300/50">
            <div className="flex items-center gap-3">
              <svg className="w-6 h-6 text-yellow-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="text-slate-700 font-medium">
                You must register or sign in to access features.
                <Link to="/auth" className="ml-2 text-purple-600 underline font-semibold hover:text-purple-700">Go to Sign In →</Link>
              </span>
            </div>
          </div>
        )}

        {/* Show user's joined rooms */}
        {authUser && groups.length > 0 && (
          <section className="mt-12 fade-in">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-3xl font-bold text-white">Your Rooms</h2>
              <span className="text-white/70">{groups.length} {groups.length === 1 ? 'room' : 'rooms'}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {groups.map((group, idx) => (
                <Link
                  key={group.roomCode}
                  to={`/room/${group.roomCode}`}
                  className="glass rounded-2xl p-6 shadow-glow card-hover group"
                  style={{ animationDelay: `${idx * 100}ms` }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="font-bold text-xl text-slate-800 group-hover:gradient-text transition">
                        {group.name}
                      </h3>
                      <p className="text-sm text-slate-500 mt-2 flex items-center gap-2">
                        <span className="inline-block px-3 py-1 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 text-white font-mono font-bold text-xs">
                          {group.roomCode}
                        </span>
                      </p>
                    </div>
                    <div className="p-2 rounded-lg bg-gradient-to-br from-blue-100 to-purple-100 group-hover:scale-110 transition-transform">
                      <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-slate-600">
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                      </svg>
                      Collaborative
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
                      </svg>
                      Real-time
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}