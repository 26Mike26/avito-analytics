import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const session = useStore((s) => s.session);
  const bootstrap = useStore((s) => s.bootstrap);
  const location = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    bootstrap().finally(() => setReady(true));
  }, [bootstrap]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-ink-400">
        Загрузка…
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
