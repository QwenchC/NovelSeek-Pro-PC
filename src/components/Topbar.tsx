import { useAppStore } from '@store/index';
import { Menu, Loader2 } from 'lucide-react';

export function Topbar() {
  const { sidebarOpen, toggleSidebar, isGenerating, generationProgress, setMobileMenuOpen } = useAppStore();

  return (
    <header className="h-14 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center justify-between px-4">
      <div className="flex items-center space-x-4">
        {/* 移动端菜单按钮 - 始终显示 */}
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 md:hidden"
          title="打开菜单"
        >
          <Menu className="w-5 h-5" />
        </button>
        
        {/* 桌面端：侧边栏收起时显示展开按钮 */}
        {!sidebarOpen && (
          <button
            onClick={toggleSidebar}
            className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 hidden md:block"
            title="展开侧边栏"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
      </div>

      {isGenerating && (
        <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="truncate max-w-[200px] md:max-w-none">{generationProgress || '生成中...'}</span>
        </div>
      )}
    </header>
  );
}
