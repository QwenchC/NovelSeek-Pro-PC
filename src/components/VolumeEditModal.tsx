import { useState } from 'react';
import { Button } from '@components/Button';
import { Library } from 'lucide-react';
import { tx } from '@utils/i18n';

/** Edit a 副本 (Volume)'s name + description (副本简介), shared by the hub and outline pages. */
export function VolumeEditModal({
  initialName, initialDescription, uiLanguage, onClose, onSave,
}: {
  initialName: string;
  initialDescription: string;
  uiLanguage: 'zh' | 'en';
  onClose: () => void;
  onSave: (name: string, description: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Library className="w-5 h-5 text-purple-500" />
          {tx(uiLanguage, '编辑副本', 'Edit Volume')}
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '副本名称 *', 'Volume name *')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tx(uiLanguage, '副本简介', 'Volume description')}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 h-28 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
              placeholder={tx(uiLanguage, '本副本的阶段目标、核心矛盾、收束…', "This volume's stage goal, core conflict, outcome…")}
            />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1">{tx(uiLanguage, '取消', 'Cancel')}</Button>
          <Button
            onClick={() => { if (name.trim()) onSave(name.trim(), description.trim()); }}
            disabled={!name.trim()}
            className="flex-1 bg-purple-600 hover:bg-purple-700"
          >
            {tx(uiLanguage, '保存', 'Save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
