import Navbar from '../components/Navbar';
import { useApp } from '../context/AppContext';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const { userName, groups } = useApp();

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-100 dark:from-slate-900 dark:to-slate-800 transition-colors duration-300">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Your Groups</h1>
          <span className="text-slate-600 dark:text-slate-300">Signed in as <strong>{userName || 'Anonymous'}</strong></span>
        </div>

        <div className="mt-6 grid md:grid-cols-3 gap-6">
          {groups.length === 0 && (
            <div className="col-span-3 text-slate-600 dark:text-slate-400">No groups yet. Create or join from Home.</div>
          )}
          {groups.map((g) => (
            <Link
              key={g.roomCode}
              to={`/room/${g.roomCode}`}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-5 hover:shadow-glow transition-all duration-300"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{g.name}</h3>
                <span className="text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 px-2 py-1 rounded">{g.roomCode}</span>
              </div>
              <p className="mt-2 text-slate-600 dark:text-slate-400">Open room to view and edit notes.</p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}