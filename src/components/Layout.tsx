import { ReactNode, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { useAppStore } from '@store/index';
import { cn } from '@utils/index';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const sidebarOpen = useAppStore(state => state.sidebarOpen);
  const theme = useAppStore(state => state.theme);
  const uiLanguage = useAppStore(state => state.uiLanguage);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = uiLanguage === 'en' ? 'en' : 'zh-CN';
  }, [uiLanguage]);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <div className={cn(
        "flex flex-col flex-1 transition-all duration-300 min-w-0",
        sidebarOpen ? "md:ml-64" : "ml-0"
      )}>
        <Topbar />
        <main className="flex-1 overflow-auto p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
