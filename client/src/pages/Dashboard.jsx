import Navbar from '../components/Navbar';
import { useApp } from '../context/AppContext';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const { userName, groups } = useApp();

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 sm:py-8 lg:py-10">
        <div className="glass rounded-xl sm:rounded-2xl p-4 sm:p-6 mb-6 sm:mb-8 animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold gradient-text mb-2">Your Study Groups</h1>
              <p className="text-sm sm:text-base text-slate-600">Manage and access your collaborative spaces</p>
            </div>
            <div className="glass px-3 py-2 sm:px-4 rounded-lg sm:rounded-xl">
              <span className="text-xs sm:text-sm text-slate-600">Signed in as </span>
              <strong className="text-sm sm:text-base text-purple-600">{userName || 'Anonymous'}</strong>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {groups.length === 0 && (
            <div className="col-span-full glass rounded-xl sm:rounded-2xl p-8 sm:p-12 text-center animate-fadeIn">
              <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 bg-purple-500 rounded-xl sm:rounded-2xl mb-4">
                <svg className="w-7 h-7 sm:w-8 sm:h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <h3 className="text-lg sm:text-xl font-semibold text-slate-800 mb-2">No Groups Yet</h3>
              <p className="text-sm sm:text-base text-slate-600 mb-4">Create or join a study group from the Home page</p>
              <Link to="/" className="inline-flex items-center gap-2 bg-purple-500 hover:bg-purple-600 text-white px-5 sm:px-6 py-2.5 sm:py-2 rounded-xl shadow-md hover:shadow-lg transition text-sm sm:text-base min-h-[44px]">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Go to Home
              </Link>
            </div>
          )}
          {groups.map((g, idx) => (
            <Link
              key={g.roomCode}
              to={`/room/${g.roomCode}`}
              className="glass rounded-xl sm:rounded-2xl p-4 sm:p-6 hover:shadow-glow transition card-hover group animate-fadeIn min-h-[120px]"
              style={{ animationDelay: `${idx * 100}ms` }}
            >
              <div className="flex items-start justify-between mb-3 sm:mb-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg sm:text-xl font-semibold text-slate-800 group-hover:gradient-text transition mb-2 truncate">{g.name}</h3>
                  <span className="inline-flex items-center gap-1 text-xs bg-purple-400 text-white px-3 py-1 rounded-full font-medium">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    {g.roomCode}
                  </span>
                </div>
                <div className="flex items-center justify-center w-10 h-10 bg-purple-500 rounded-xl group-hover:scale-110 transition">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
              <p className="text-slate-600 text-sm mb-3">Collaborative notes, files, and whiteboard</p>
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                    <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                  </svg>
                  Notes
                </span>
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                  </svg>
                  Files
                </span>
                <span className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                  </svg>
                  Board
                </span>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}