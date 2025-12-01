import Navbar from '../components/Navbar';
import { useApp } from '../context/AppContext';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const { userName, groups } = useApp();

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-100">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Your Groups</h1>
          <span className="text-slate-600">Signed in as <strong>{userName || 'Anonymous'}</strong></span>
        </div>

        <div className="mt-6 grid md:grid-cols-3 gap-6">
          {groups.length === 0 && (
            <div className="col-span-3 text-slate-600">No groups yet. Create or join from Home.</div>
          )}
          {groups.map((g) => (
            <Link
              key={g.roomCode}
              to={`/room/${g.roomCode}`}
              className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-glow transition"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{g.name}</h3>
                <span className="text-xs bg-slate-100 px-2 py-1 rounded">{g.roomCode}</span>
              </div>
              <p className="mt-2 text-slate-600">Open room to view and edit notes.</p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}