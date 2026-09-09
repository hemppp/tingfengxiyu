import { useState } from 'react';
import { nanoid } from 'nanoid';
import { BookOpen, Link, Trash2 } from 'lucide-react';
import { safeConfirm } from '@/utils/safeConfirm';

interface SeriesItem {
  id: string;
  name: string;
  description: string;
  projectIds: string[];
  createdAt: number;
}

/**
 * 系列管理 — 关联多本书，共享角色/地点
 */
export function SeriesManager() {
  const [series, setSeries] = useState<SeriesItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');

  const handleCreate = () => {
    const item: SeriesItem = {
      id: nanoid(),
      name: '新系列',
      description: '',
      projectIds: [],
      createdAt: Date.now(),
    };
    setSeries((prev) => [...prev, item]);
    setEditingId(item.id);
    setName(item.name);
    setDesc(item.description);
  };

  const handleSave = (id: string) => {
    setSeries((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, name, description: desc } : s
      )
    );
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    if (!safeConfirm('删除此系列？')) return;
    setSeries((prev) => prev.filter((s) => s.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const selected = series.find((s) => s.id === editingId);

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b flex items-center gap-2">
        <BookOpen size={16} />
        <h2 className="font-semibold text-sm">系列管理</h2>
        <div className="flex-1" />
        <button
          onClick={handleCreate}
          className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded"
        >
          + 新系列
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 列表 */}
        <div className="w-56 border-r overflow-y-auto">
          {series.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              <p>暂无系列</p>
              <p className="mt-1">系列用于管理多本书的共享设定</p>
            </div>
          ) : (
            series.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  setEditingId(s.id);
                  setName(s.name);
                  setDesc(s.description);
                }}
                className={`w-full text-left px-3 py-2 text-sm border-b hover:bg-accent/50 ${
                  editingId === s.id ? 'bg-accent' : ''
                }`}
              >
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">
                  {s.projectIds.length} 本书
                </div>
              </button>
            ))
          )}
        </div>

        {/* 详情 */}
        <div className="flex-1 overflow-y-auto p-4">
          {selected ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">系列名称</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => handleSave(selected.id)}
                  className="w-full mt-1 px-3 py-2 border rounded bg-transparent text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">描述</label>
                <textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  onBlur={() => handleSave(selected.id)}
                  className="w-full mt-1 px-3 py-2 border rounded bg-transparent text-sm"
                  rows={4}
                />
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">
                  关联项目
                </label>
                <div className="border rounded-2xl p-3 text-xs text-muted-foreground">
                  <p>系列中的每本书是一个独立项目</p>
                  <p className="mt-1">共享的角色和地点会在所有书中同步</p>
                  <button className="mt-2 text-xs text-primary hover:underline flex items-center gap-1">
                    <Link size={10} /> 关联项目
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">
                  共享角色
                </label>
                <div className="border rounded-2xl p-3 text-xs text-muted-foreground">
                  跨书共享的角色（如系列主角）
                </div>
              </div>

              <button
                onClick={() => handleDelete(selected.id)}
                className="text-xs text-destructive hover:underline flex items-center gap-1"
              >
                <Trash2 size={12} /> 删除系列
              </button>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              选择或创建系列
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
