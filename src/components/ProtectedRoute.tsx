import { ReactNode, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { isClientUser } from '../lib/clientAccess';

export function ProtectedRoute({
  children,
  access = 'all',
}: {
  children: ReactNode;
  access?: 'all' | 'platform';
}) {
  const session = useStore((s) => s.session);
  const user = useStore((s) => s.currentUser);
  const bootstrap = useStore((s) => s.bootstrap);
  const initialized = useStore((s) => s.initialized);
  const location = useLocation();
  const [ready, setReady] = useState(() => initialized || (!!session && !!user));

  useEffect(() => {
    if (initialized || (session && user)) {
      setReady(true);
      return;
    }
    let alive = true;
    bootstrap().finally(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [bootstrap, initialized, session, user]);

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
  if (access === 'platform' && isClientUser(user)) {
    return <Navigate to="/client" replace />;
  }
  return <>{children}</>;
}
