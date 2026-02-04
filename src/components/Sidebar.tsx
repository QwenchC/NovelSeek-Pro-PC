import { Link, useLocation } from 'react-router-dom';
import { useAppStore } from '@store/index';
import { cn } from '@utils/index';
import { Home, Settings, BookOpen, PanelLeftClose, X } from 'lucide-react';

export function Sidebar() {
  const location = useLocation();
  const { sidebarOpen, toggleSidebar, mobileMenuOpen, setMobileMenuOpen } = useAppStore();

  const navItems = [
    { path: '/', label: '首页', icon: Home },
    { path: '/settings', label: '设置', icon: Settings },
  ];

  const handleNavClick = () => {
    // 移动端点击导航后关闭菜单
    if (mobileMenuOpen) {
      setMobileMenuOpen(false);
    }
  };

  if (!sidebarOpen && !mobileMenuOpen) return null;

  return (
    <>
      {/* 移动端遮罩层 */}
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      
      {/* 侧边栏 */}
      <aside className={cn(
        "fixed left-0 top-0 h-full w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 z-30",
        // 桌面端：根据 sidebarOpen 显示
        "hidden md:block",
        // 移动端：根据 mobileMenuOpen 显示
        mobileMenuOpen && "!block"
      )}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-2 min-w-0">
            <BookOpen className="w-6 h-6 text-primary-600 flex-shrink-0" />
            <h1 className="text-lg md:text-xl font-bold text-gray-900 dark:text-white truncate">NovelSeek Pro</h1>
          </div>
          {/* 桌面端：收起按钮 */}
          <button
            onClick={toggleSidebar}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 hidden md:block"
            title="收起侧边栏"
          >
            <PanelLeftClose className="w-5 h-5" />
          </button>
          {/* 移动端：关闭按钮 */}
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 md:hidden"
            title="关闭菜单"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="p-4 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={handleNavClick}
                className={cn(
                  "flex items-center space-x-3 px-4 py-2 rounded-lg transition-colors",
                  isActive
                    ? "bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                )}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
