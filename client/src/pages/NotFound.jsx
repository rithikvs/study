import Navbar from '../components/Navbar';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-100">
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 py-20 text-center">
        <h1 className="text-3xl font-bold">Page not found</h1>
        <p className="mt-2 text-slate-600">The page you are looking for doesn’t exist.</p>
        <Link to="/" className="mt-6 inline-block bg-primary text-white px-4 py-2 rounded-lg">Go Home</Link>
      </main>
    </div>
  );
}