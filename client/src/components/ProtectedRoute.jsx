import { Navigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';

export default function ProtectedRoute({ children }) {
  const { authUser, authLoading } = useApp();

  if (authLoading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-slate-600">Loading...</div>
      </div>
    );
  }

  if (!authUser) {
    return <Navigate to="/auth" replace />;
  }

  return children;
}