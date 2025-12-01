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
      <main className="mx-auto max-w-6xl px-4 py-8 fade-in">
        {/* Hero Section */}
        <section className="text-center mb-10">
          <div className="inline-block mb-3">
            <span className="inline-flex items-center px-4 py-2 rounded-full bg-white/20 backdrop-blur-sm border border-white/30 text-white text-sm font-medium">
              <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              Real-time Collaboration
            </span>
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-white mb-4 animate-float">
            StudyHub
          </h1>
          <p className="text-lg md:text-xl text-white/90 max-w-2xl mx-auto font-light">
            Create group rooms, share notes, collaborate with whiteboards in real-time
          </p>
        </section>

        {/* Single Column Card */}
        <div className="max-w-xl mx-auto mb-8">
          <section>
            <div className="glass rounded-2xl p-6 shadow-glow">
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2.5 rounded-xl bg-purple-500">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <h2 className="text-xl font-bold gradient-text">Create or Join Room</h2>
              </div>
              
              {/* Group Name Input */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">Group Name</label>
                <input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="e.g., Operating Systems Unit-2"
                  className="w-full px-5 py-4 rounded-xl border-2 border-slate-200 focus:border-purple-400 focus:ring-4 focus:ring-purple-400/20 transition-all outline-none text-slate-700 font-medium"
                />
                <button
                  onClick={createGroup}
                  disabled={gated || !groupName.trim() || loadingCreate}
                  className="mt-3 w-full bg-purple-500 hover:bg-purple-600 text-white font-semibold py-3 rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 transition flex items-center justify-center gap-2"
                >
                  {loadingCreate ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Creating...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Create Group
                    </>
                  )}
                </button>
              </div>

              {/* Divider */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-300"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-4 bg-white/80 text-slate-600 font-medium">OR</span>
                </div>
              </div>

              {/* Room Code Input */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Enter Room Code</label>
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="6-CHARACTER CODE"
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-purple-400 focus:ring-4 focus:ring-purple-400/20 transition-all outline-none text-slate-700 font-bold tracking-wider text-center mb-3"
                  maxLength={6}
                />
                <button
                  onClick={joinGroup}
                  disabled={gated || !joinCode.trim() || loadingJoin}
                  className="w-full bg-purple-500 hover:bg-purple-600 text-white font-semibold py-3 rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 transition flex items-center justify-center gap-2"
                >
                  {loadingJoin ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Joining...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                      </svg>
                      Enter Code
                    </>
                  )}
                </button>
              </div>
            </div>
          </section>
        </div>

        {gated && (
          <div className="glass rounded-2xl p-4 max-w-5xl mx-auto border border-purple-300/50 mb-6">
            <div className="flex items-center gap-3 justify-center">
              <svg className="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <span className="text-slate-700 text-sm">
                Please <Link to="/auth" className="text-purple-600 font-semibold hover:underline">sign in</Link> to create or join groups
              </span>
            </div>
          </div>
        )}

        {/* Show user's joined rooms */}
        {authUser && groups.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-4 max-w-5xl mx-auto">
              <h2 className="text-2xl font-bold text-white">Your Rooms</h2>
              <span className="text-white/80 text-sm">{groups.length} {groups.length === 1 ? 'room' : 'rooms'}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
              {groups.map((group) => (
                <Link
                  key={group.roomCode}
                  to={`/room/${group.roomCode}`}
                  className="glass rounded-2xl p-5 shadow-glow hover:shadow-xl transition group"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h3 className="font-bold text-lg text-slate-800 group-hover:text-purple-600 transition">
                        {group.name}
                      </h3>
                      <span className="inline-block mt-2 px-2.5 py-1 rounded-full bg-purple-400 text-white font-mono font-bold text-xs">
                        {group.roomCode}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-purple-100 group-hover:bg-purple-500 group-hover:scale-110 transition">
                      <svg className="w-4 h-4 text-purple-600 group-hover:text-white transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-600">
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
                      </svg>
                      Team
                    </span>
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
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