import { ReactNode, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useStore } from '../store/useStore';

type Props = {
  children: ReactNode;
  title: string;
  subtitle?: string;
};

export function Layout({ children, title, subtitle }: Props) {
  const init = useStore((s) => s.init);
  const initialized = useStore((s) => s.initialized);
  useEffect(() => {
    if (!initialized) init();
  }, [init, initialized]);

  return (
    <div className="min-h-screen flex bg-ink-900 text-ink-100 silk-bg">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col relative">
        <Header title={title} subtitle={subtitle} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
