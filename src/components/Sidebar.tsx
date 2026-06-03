import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { useAppStore } from '@store/index';
import type { ProjectFolder } from '@store/index';
import { projectApi } from '@services/api';
import { cn } from '@utils/index';
import { tx } from '@utils/i18n';
import {
  ScrollText,
  BookOpen,
  Bot,
  Settings,
  PanelLeftClose,
  X,
  FolderPlus,
  Moon,
  Sun,
  Languages,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  FolderInput,
} from 'lucide-react';

// ── Emoji picker data ──────────────────────────────────────────
const EMOJI_LIST = [
  '📚','📖','✍️','📝','🔖','🗒️','📃','🖊️',
  '⚔️','🏰','🗡️','👑','🧙','🧝','🐉','🦄',
  '🚀','🌌','🤖','🛸','💫','⚡','🌙','👾',
  '💕','❤️','💔','🌹','🌸','💌','👫','💒',
  '👻','💀','🦇','🔮','🕵️','🎭','🌑','🕯️',
  '🌿','🌺','🌲','🌴','🌻','🌷','🍀','🌾',
  '🏔️','🌋','🏜️','🌃','🌆','✨','🎉','🏷️',
  '🎨','🎬','🎵','🎶','🎸','🏆','🎯','🎪',
];

// ── Folder modal ───────────────────────────────────────────────
interface FolderModalProps {
  mode: 'create' | 'edit';
  initialName: string;
  initialEmoji: string;
  uiLanguage: 'zh' | 'en';
  onClose: () => void;
  onConfirm: (name: string, emoji: string) => void;
}

function FolderModal({ mode, initialName, initialEmoji, uiLanguage, onClose, onConfirm }: FolderModalProps) {
  const [name, setName] = useState(initialName);
  const [emoji, setEmoji] = useState(initialEmoji);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed, emoji);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-80 p-5">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
          {mode === 'create'
            ? tx(uiLanguage, '新建文件夹', 'New Folder')
            : tx(uiLanguage, '编辑文件夹', 'Edit Folder')}
        </h3>

        {/* Preview + name input */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-3xl leading-none select-none">{emoji}</span>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); if (e.key === 'Escape') onClose(); }}
            placeholder={tx(uiLanguage, '文件夹名称', 'Folder name')}
            maxLength={20}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {/* Emoji picker */}
        <div className="grid grid-cols-8 gap-0.5 p-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 mb-4 max-h-40 overflow-y-auto">
          {EMOJI_LIST.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => setEmoji(e)}
              className={cn(
                'text-xl rounded p-1 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors leading-none',
                emoji === e && 'bg-primary-100 dark:bg-primary-900/40 ring-1 ring-primary-500'
              )}
            >
              {e}
            </button>
          ))}
        </div>

        {/* Buttons */}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {tx(uiLanguage, '取消', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!name.trim()}
            className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {tx(uiLanguage, '确认', 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Move-to-folder dropdown ────────────────────────────────────
interface MoveDropdownProps {
  projectId: string;
  folders: ProjectFolder[];
  currentFolderId: string | null;
  uiLanguage: 'zh' | 'en';
  anchorRect: { x: number; y: number; bottom: number };
  onMove: (folderId: string | null) => void;
  onClose: () => void;
}

function MoveDropdown({ folders, currentFolderId, uiLanguage, anchorRect, onMove, onClose }: MoveDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // slight delay so the opening click itself doesn't immediately close
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', handleClick); };
  }, [onClose]);

  // Compute vertical position: prefer below anchor, flip up if near bottom of viewport
  const dropdownHeight = Math.min(folders.length * 36 + 80, 280);
  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const top = spaceBelow >= dropdownHeight
    ? anchorRect.bottom + 4
    : anchorRect.y - dropdownHeight - 4;
  const left = anchorRect.x + 4;

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', top, left }}
      className="z-[9999] w-48 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-2xl py-1 text-sm"
    >
      <p className="px-3 py-1 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
        {tx(uiLanguage, '移至文件夹', 'Move to folder')}
      </p>
      <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
      {folders.map((folder) => (
        <button
          key={folder.id}
          type="button"
          onClick={() => { onMove(folder.id); onClose(); }}
          className={cn(
            'w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left',
            currentFolderId === folder.id && 'text-primary-600 dark:text-primary-400'
          )}
        >
          <span className="text-base leading-none">{folder.emoji}</span>
          <span className="truncate">{folder.name}</span>
          {currentFolderId === folder.id && <span className="ml-auto text-xs">✓</span>}
        </button>
      ))}
      {folders.length > 0 && <div className="border-t border-gray-100 dark:border-gray-700 my-1" />}
      {currentFolderId !== null && (
        <button
          type="button"
          onClick={() => { onMove(null); onClose(); }}
          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left text-gray-500 dark:text-gray-400"
        >
          <X className="w-3.5 h-3.5" />
          <span>{tx(uiLanguage, '移出文件夹', 'Remove from folder')}</span>
        </button>
      )}
      {folders.length === 0 && (
        <p className="px-3 py-2 text-xs text-gray-400">
          {tx(uiLanguage, '暂无文件夹', 'No folders yet')}
        </p>
      )}
    </div>,
    document.body
  );
}

// ── Main Sidebar ───────────────────────────────────────────────
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
    uiLanguage,
    toggleUiLanguage,
    folders,
    addFolder,
    updateFolder,
    deleteFolder,
    moveProjectToFolder,
    novelTypeByProject,
    agentRunSessionId,
  } = useAppStore();

  const [loadingProjects, setLoadingProjects] = useState(false);

  // Folder expand state (id → expanded)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  // Folder modal state
  const [folderModal, setFolderModal] = useState<{
    mode: 'create' | 'edit';
    folderId?: string;
    name: string;
    emoji: string;
  } | null>(null);

  // Move-dropdown: which project is showing the move menu + anchor position
  const [moveMenu, setMoveMenu] = useState<{
    id: string;
    rect: { x: number; y: number; bottom: number };
  } | null>(null);

  const navItems = [
    { path: '/short-novels', label: tx(uiLanguage, '短篇小说', 'Short Stories'), icon: ScrollText },
    { path: '/long-novels', label: tx(uiLanguage, '长篇小说', 'Long Novels'), icon: BookOpen },
    { path: '/agent', label: tx(uiLanguage, '智能体', 'Agent'), icon: Bot },
  ];

  useEffect(() => {
    let mounted = true;
    const loadProjects = async () => {
      setLoadingProjects(true);
      try {
        const data = await projectApi.getAll();
        if (mounted) setProjects(data);
      } catch (error) {
        console.error('Failed to load sidebar projects:', error);
      } finally {
        if (mounted) setLoadingProjects(false);
      }
    };
    loadProjects();
    return () => { mounted = false; };
  }, [setProjects]);

  // Build a Set of all project IDs that belong to any folder
  const folderedProjectIds = useMemo(() => {
    const set = new Set<string>();
    for (const folder of folders) {
      for (const pid of folder.projectIds) set.add(pid);
    }
    return set;
  }, [folders]);

  // Uncategorized projects (most-recently-updated first). NO recency cap: a flat top-N would hide
  // whole novel types when one type dominates recent edits (e.g. all long novels), which made short
  // novels disappear from the list. The container scrolls, so showing every uncategorized project is fine.
  const uncategorizedProjects = useMemo(
    () =>
      [...projects]
        .filter((p) => !folderedProjectIds.has(p.id))
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [projects, folderedProjectIds]
  );

  // Projects by id map for quick lookup
  const projectMap = useMemo(() => {
    const map = new Map(projects.map((p) => [p.id, p]));
    return map;
  }, [projects]);

  const handleNavClick = () => {
    if (mobileMenuOpen) setMobileMenuOpen(false);
  };

  const toggleFolder = (id: string) =>
    setExpandedFolders((prev) => ({ ...prev, [id]: !prev[id] }));

  const isFolderExpanded = (id: string) =>
    id in expandedFolders ? expandedFolders[id] : true; // default expanded

  const handleFolderConfirm = (name: string, emoji: string) => {
    if (!folderModal) return;
    if (folderModal.mode === 'create') {
      const newId = addFolder(name, emoji);
      setExpandedFolders((prev) => ({ ...prev, [newId]: true }));
    } else if (folderModal.folderId) {
      updateFolder(folderModal.folderId, name, emoji);
    }
    setFolderModal(null);
  };

  const handleDeleteFolder = (folder: ProjectFolder) => {
    deleteFolder(folder.id);
  };

  const handleMoveProject = (projectId: string, folderId: string | null) => {
    moveProjectToFolder(projectId, folderId);
  };

  // Which folder does a project currently belong to?
  const getProjectFolderId = (projectId: string): string | null => {
    const folder = folders.find((f) => f.projectIds.includes(projectId));
    return folder?.id ?? null;
  };

  const getProjectPath = (projectId: string) =>
    (novelTypeByProject[projectId] || 'short') === 'long'
      ? `/long-novel/${projectId}`
      : `/project/${projectId}`;

  const isProjectActive = (projectId: string) => {
    const basePath = getProjectPath(projectId);
    return (
      location.pathname.startsWith(basePath) ||
      location.pathname === `/editor/${projectId}` ||
      location.pathname.startsWith(`/editor/${projectId}/`)
    );
  };

  if (!sidebarOpen && !mobileMenuOpen) return null;

  return (
    <>
      {folderModal && (
        <FolderModal
          mode={folderModal.mode}
          initialName={folderModal.name}
          initialEmoji={folderModal.emoji}
          uiLanguage={uiLanguage}
          onClose={() => setFolderModal(null)}
          onConfirm={handleFolderConfirm}
        />
      )}

      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 h-full w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 z-30 flex flex-col',
          'hidden md:flex',
          mobileMenuOpen && '!flex'
        )}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center space-x-2 min-w-0">
            <BookOpen className="w-6 h-6 text-primary-600 flex-shrink-0" />
            <h1 className="text-lg md:text-xl font-bold text-gray-900 dark:text-white truncate">
              NovelSeek Ultra
            </h1>
          </div>
          <button
            onClick={toggleSidebar}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 hidden md:block"
            title={tx(uiLanguage, '收起侧边栏', 'Collapse sidebar')}
          >
            <PanelLeftClose className="w-5 h-5" />
          </button>
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 md:hidden"
            title={tx(uiLanguage, '关闭菜单', 'Close menu')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Scrollable content ── */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Navigation */}
          <div className="p-4">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              {tx(uiLanguage, '导航', 'Navigation')}
            </p>
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
                      'flex items-center space-x-3 px-4 py-2 rounded-lg transition-colors',
                      isActive
                        ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{item.label}</span>
                    {item.path === '/agent' && agentRunSessionId && (
                      <span className="ml-auto w-2 h-2 rounded-full bg-purple-500 animate-pulse" title={tx(uiLanguage, '智能体运行中', 'Agent running')} />
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Projects + Folders */}
          <div className="px-4 pb-4 border-t border-gray-200 dark:border-gray-700 pt-4">
            {/* Section header */}
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                {tx(uiLanguage, '项目', 'Projects')}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFolderModal({ mode: 'create', name: '', emoji: '📁' })}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                  title={tx(uiLanguage, '新建文件夹', 'New Folder')}
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
                <Link
                  to="/short-novels"
                  onClick={handleNavClick}
                  className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 ml-1"
                >
                  {tx(uiLanguage, '全部', 'All')}
                </Link>
              </div>
            </div>

            {/* Folder list */}
            <div className="space-y-1">
              {folders.map((folder) => {
                const folderProjects = folder.projectIds
                  .map((pid) => projectMap.get(pid))
                  .filter(Boolean) as typeof projects;
                const expanded = isFolderExpanded(folder.id);

                return (
                  <div key={folder.id}>
                    {/* Folder header row */}
                    <div className="group flex items-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                      <button
                        type="button"
                        className="flex-1 flex items-center gap-1.5 px-2 py-1.5 min-w-0 text-left"
                        onClick={() => toggleFolder(folder.id)}
                      >
                        {expanded
                          ? <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          : <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />}
                        <span className="text-base leading-none">{folder.emoji}</span>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                          {folder.name}
                        </span>
                        {folderProjects.length > 0 && (
                          <span className="ml-auto text-xs text-gray-400 flex-shrink-0 mr-1">
                            {folderProjects.length}
                          </span>
                        )}
                      </button>
                      {/* Folder actions (visible on hover) */}
                      <div className="flex items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() =>
                            setFolderModal({
                              mode: 'edit',
                              folderId: folder.id,
                              name: folder.name,
                              emoji: folder.emoji,
                            })
                          }
                          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                          title={tx(uiLanguage, '重命名', 'Rename')}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteFolder(folder)}
                          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-red-500"
                          title={tx(uiLanguage, '删除文件夹', 'Delete folder')}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Projects inside folder */}
                    {expanded && (
                      <div className="ml-4 mt-0.5 space-y-0.5">
                        {folderProjects.map((project) => {
                          const isActive = isProjectActive(project.id);

                          return (
                            <div key={project.id} className="group relative flex items-center">
                              <Link
                                to={getProjectPath(project.id)}
                                onClick={handleNavClick}
                                className={cn(
                                  'flex-1 flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors min-w-0',
                                  isActive
                                    ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                                )}
                                title={project.title}
                              >
                                {(novelTypeByProject[project.id] || 'short') === 'long'
                                  ? <BookOpen className="w-3.5 h-3.5 flex-shrink-0 text-purple-500" />
                                  : <ScrollText className="w-3.5 h-3.5 flex-shrink-0" />}
                                <span className="text-sm truncate">{project.title}</span>
                              </Link>
                              {/* Move button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                  setMoveMenu((prev) =>
                                    prev?.id === project.id ? null : { id: project.id, rect: { x: r.right, y: r.top, bottom: r.bottom } }
                                  );
                                }}
                                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-all flex-shrink-0"
                                title={tx(uiLanguage, '移至文件夹', 'Move to folder')}
                              >
                                <FolderInput className="w-3 h-3" />
                              </button>
                              {moveMenu?.id === project.id && (
                                <MoveDropdown
                                  projectId={project.id}
                                  folders={folders}
                                  currentFolderId={getProjectFolderId(project.id)}
                                  uiLanguage={uiLanguage}
                                  anchorRect={moveMenu.rect}
                                  onMove={(fid) => handleMoveProject(project.id, fid)}
                                  onClose={() => setMoveMenu(null)}
                                />
                              )}
                            </div>
                          );
                        })}
                        {folderProjects.length === 0 && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 px-2 py-1">
                            {tx(uiLanguage, '暂无项目', 'No projects')}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Uncategorized projects */}
              {uncategorizedProjects.length > 0 && (
                <>
                  {folders.length > 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 px-2 pt-2 pb-1">
                      {tx(uiLanguage, '未归类', 'Uncategorized')}
                    </p>
                  )}
                  {uncategorizedProjects.map((project) => {
                    const isActive = isProjectActive(project.id);

                    return (
                      <div key={project.id} className="group relative flex items-center">
                        <Link
                          to={getProjectPath(project.id)}
                          onClick={handleNavClick}
                          className={cn(
                            'flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors min-w-0',
                            isActive
                              ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400'
                              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          )}
                          title={project.title}
                        >
                          {(novelTypeByProject[project.id] || 'short') === 'long'
                            ? <BookOpen className="w-4 h-4 flex-shrink-0 text-purple-500" />
                            : <ScrollText className="w-4 h-4 flex-shrink-0" />}
                          <span className="text-sm truncate">{project.title}</span>
                        </Link>
                        {/* Move button */}
                        {folders.length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                setMoveMenu((prev) =>
                                  prev?.id === project.id ? null : { id: project.id, rect: { x: r.right, y: r.top, bottom: r.bottom } }
                                );
                              }}
                              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-all flex-shrink-0"
                              title={tx(uiLanguage, '移至文件夹', 'Move to folder')}
                            >
                              <FolderInput className="w-3.5 h-3.5" />
                            </button>
                            {moveMenu?.id === project.id && (
                              <MoveDropdown
                                projectId={project.id}
                                folders={folders}
                                currentFolderId={getProjectFolderId(project.id)}
                                uiLanguage={uiLanguage}
                                anchorRect={moveMenu.rect}
                                onMove={(fid) => handleMoveProject(project.id, fid)}
                                onClose={() => setMoveMenu(null)}
                              />
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {loadingProjects && projects.length === 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 px-3 py-2">
                  {tx(uiLanguage, '加载项目中...', 'Loading projects...')}
                </p>
              )}
              {!loadingProjects && projects.length === 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400 px-3 py-2">
                  {tx(uiLanguage, '暂无项目', 'No projects')}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Fixed bottom: settings + theme + language ── */}
        <div className="flex-shrink-0 p-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-around gap-1">
            <Link
              to="/settings"
              onClick={handleNavClick}
              className={cn(
                'flex-1 flex items-center justify-center p-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors',
                location.pathname === '/settings' && 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 border-primary-200 dark:border-primary-700'
              )}
              title={tx(uiLanguage, '设置', 'Settings')}
            >
              <Settings className="w-4 h-4" />
            </Link>
            <button
              type="button"
              onClick={toggleTheme}
              className="flex-1 flex items-center justify-center p-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={theme === 'dark' ? tx(uiLanguage, '切换到亮色模式', 'Switch to light mode') : tx(uiLanguage, '切换到暗色模式', 'Switch to dark mode')}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={toggleUiLanguage}
              className="flex-1 flex items-center justify-center p-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={tx(uiLanguage, '切换界面语言', 'Switch UI language')}
            >
              <Languages className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

