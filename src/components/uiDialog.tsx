import { create } from 'zustand';
import { useEffect, useState } from 'react';
import { Button } from '@components/Button';
import { useAppStore } from '@store/index';
import { tx } from '@utils/i18n';

// In-app, centered, properly-titled dialogs replacing the browser-native window.prompt/confirm
// (which render as the ugly "localhost:1420 显示" popups pinned to the top of the webview).

type DialogReq =
  | { kind: 'prompt'; title: string; label?: string; defaultValue?: string; placeholder?: string; multiline?: boolean; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'alert'; title: string; message: string; resolve: () => void };

interface DialogStore { current: DialogReq | null; set: (d: DialogReq | null) => void }
const useDialogStore = create<DialogStore>((set) => ({ current: null, set: (d) => set({ current: d }) }));

/** Centered text-input dialog. Resolves to the entered string, or null if cancelled. */
export function uiPrompt(opts: { title: string; label?: string; defaultValue?: string; placeholder?: string; multiline?: boolean }): Promise<string | null> {
  return new Promise((resolve) => useDialogStore.getState().set({ kind: 'prompt', resolve, ...opts }));
}
/** Centered confirm dialog. Resolves true (confirm) / false (cancel or dismiss). */
export function uiConfirm(opts: { title: string; message: string; confirmText?: string; cancelText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => useDialogStore.getState().set({ kind: 'confirm', resolve, ...opts }));
}
export function uiAlert(opts: { title: string; message: string }): Promise<void> {
  return new Promise((resolve) => useDialogStore.getState().set({ kind: 'alert', resolve, ...opts }));
}

/** Mounted once (in Layout). Renders the active dialog centered over a backdrop. */
export function DialogHost() {
  const current = useDialogStore((s) => s.current);
  const set = useDialogStore((s) => s.set);
  const uiLanguage = useAppStore((s) => s.uiLanguage);
  const [value, setValue] = useState('');

  useEffect(() => {
    if (current?.kind === 'prompt') setValue(current.defaultValue ?? '');
  }, [current]);

  if (!current) return null;
  const close = () => set(null);

  const cancel = () => {
    if (current.kind === 'prompt') current.resolve(null);
    else if (current.kind === 'confirm') current.resolve(false);
    else current.resolve();
    close();
  };
  const confirm = () => {
    if (current.kind === 'prompt') current.resolve(value);
    else if (current.kind === 'confirm') current.resolve(true);
    else current.resolve();
    close();
  };

  const cancelLabel = (current.kind === 'confirm' && current.cancelText) || tx(uiLanguage, '取消', 'Cancel');
  const okLabel = current.kind === 'confirm'
    ? (current.confirmText || tx(uiLanguage, '确定', 'OK'))
    : tx(uiLanguage, '确定', 'OK');

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancel(); }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm p-5" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-3">{current.title}</h3>

        {current.kind === 'prompt' && (
          <div>
            {current.label && <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">{current.label}</label>}
            {current.multiline ? (
              <textarea
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={current.placeholder}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm h-24 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            ) : (
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={current.placeholder}
                onKeyDown={(e) => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') cancel(); }}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            )}
          </div>
        )}

        {(current.kind === 'confirm' || current.kind === 'alert') && (
          <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{current.message}</p>
        )}

        <div className="flex gap-2 justify-end mt-5">
          {current.kind !== 'alert' && (
            <Button variant="outline" onClick={cancel}>{cancelLabel}</Button>
          )}
          <Button
            onClick={confirm}
            className={current.kind === 'confirm' && current.danger ? 'bg-red-600 hover:bg-red-700' : ''}
          >
            {okLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
