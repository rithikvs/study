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
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-12">
        <section className="text-center">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 dark:text-white">
            Collaborative Study Platform
          </h1>
          <p className="mt-4 text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">
            Create group rooms, share notes, and collaborate in real-time with your classmates
            using room codes. Fast, simple, and beautifully designed.
          </p>
        </section>

        <section className="mt-10">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-glow border border-slate-200 dark:border-slate-700 max-w-2xl mx-auto">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Create a new group</h2>
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name (e.g., Operating Systems Unit-2)"
              className="mt-3 w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              onClick={createGroup}
              disabled={gated || !groupName.trim() || loadingCreate}
              className="mt-4 w-full bg-primary text-white font-medium py-3 rounded-lg hover:bg-primary-dark disabled:opacity-50">
            >
              {loadingCreate ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </section>

        <section className="mt-6 bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-glow border border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Join with room code</h2>
          <div className="mt-3 flex gap-3">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Enter ROOMCODE"
              className="flex-1 px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              onClick={joinGroup}
              disabled={gated || !joinCode.trim() || loadingJoin}
              className="bg-accent text-white font-medium px-6 rounded-lg hover:opacity-90 disabled:opacity-50">
            >
              {loadingJoin ? 'Joining...' : 'Join'}
            </button>
          </div>
        </section>
        {gated && (
          <div className="mt-6 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200 rounded-xl p-4">
            You must register or sign in to access features.
            <Link to="/auth" className="ml-2 text-primary underline">Go to Sign In</Link>
          </div>
        )}

        {/* Show user's joined rooms */}
        {authUser && groups.length > 0 && (
          <section className="mt-10">
            <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-white">Your Rooms</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {groups.map((group) => (
                <Link
                  key={group.roomCode}
                  to={`/room/${group.roomCode}`}
                  className="bg-white dark:bg-slate-800 rounded-xl p-5 shadow-glow border border-slate-200 dark:border-slate-700 hover:shadow-lg transition-shadow group">
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg text-slate-900 dark:text-white group-hover:text-primary transition">
                        {group.name}
                      </h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Code: <span className="font-mono font-bold text-primary">{group.roomCode}</span>
                      </p>
                    </div>
                    <svg className="w-5 h-5 text-slate-400 dark:text-slate-500 group-hover:text-primary transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
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