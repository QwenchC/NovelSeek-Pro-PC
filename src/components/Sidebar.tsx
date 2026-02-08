import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAppStore } from '@store/index';
import { projectApi } from '@services/api';
import { cn } from '@utils/index';
import { Home, Settings, BookOpen, PanelLeftClose, X, FolderOpen, Moon, Sun } from 'lucide-react';

export function Sidebar() {
  const location = useLocation();
  const {
    sidebarOpen,
    toggleSidebar,
    mobileMenuOpen,
    setMobileMenuOpen,
    projects,
    setProjects,
    theme,
    toggleTheme,
  } = useAppStore();
  const [loadingProjects, setLoadingProjects] = useState(false);

  const navItems = [
    { path: '/', label: '首页', icon: Home },
    { path: '/settings', label: '设置', icon: Settings },
  ];

  const recentProjects = useMemo(
    () =>
      [...projects]
        .sort((first, second) => {
          const firstTime = new Date(first.updated_at).getTime();
          const secondTime = new Date(second.updated_at).getTime();
          return secondTime - firstTime;
        })
        .slice(0, 8),
    [projects]
  );

  useEffect(() => {
    let mounted = true;
    const loadProjects = async () => {
      setLoadingProjects(true);
      try {
        const data = await projectApi.getAll();
        if (mounted) {
          setProjects(data);
        }
      } catch (error) {
        console.error('Failed to load sidebar projects:', error);
      } finally {
        if (mounted) {
          setLoadingProjects(false);
        }
      }
    };

    loadProjects();
    return () => {
      mounted = false;
    };
  }, [setProjects]);

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
        "fixed left-0 top-0 h-full w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 z-30 flex flex-col",
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

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">导航</p>
            <nav className="space-y-1">
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
          </div>

          <div className="px-4 pb-4 border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">项目</p>
              <Link
                to="/"
                onClick={handleNavClick}
                className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
              >
                查看全部
              </Link>
            </div>
            <div className="space-y-1">
              {recentProjects.map((project) => {
                const isActive =
                  location.pathname.startsWith(`/project/${project.id}`) ||
                  location.pathname === `/editor/${project.id}` ||
                  location.pathname.startsWith(`/editor/${project.id}/`);

                return (
                  <Link
                    key={project.id}
                    to={`/project/${project.id}`}
                    onClick={handleNavClick}
                    className={cn(
                      'flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors',
                      isActive
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    )}
                    title={project.title}
                  >
                    <FolderOpen className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm truncate">{project.title}</span>
                  </Link>
                );
              })}
              {loadingProjects && recentProjects.length === 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 px-3 py-2">加载项目中...</p>
              )}
              {!loadingProjects && recentProjects.length === 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 px-3 py-2">暂无项目</p>
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            onClick={toggleTheme}
            className="w-full flex items-center justify-center space-x-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title={theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            <span className="text-sm">{theme === 'dark' ? '开灯模式' : '关灯模式'}</span>
          </button>
        </div>
      </aside>
    </>
  );
}
