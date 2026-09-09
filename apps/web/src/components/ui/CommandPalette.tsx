import { useState, useEffect, useRef } from 'react';
import { useCharacterStore, useChapterStore, useForeshadowStore, useNoteStore } from '@/stores';
import { Search, FileText, Users, Bookmark, StickyNote, Command as CommandIcon } from 'lucide-react';
import { usePluginRegistry } from '@/plugin/registry';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

export function CommandPalette({ isOpen, onClose, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const characters = useCharacterStore((s) => s.characters);
  const chapters = useChapterStore((s) => s.chapters);
  const setCurrentChapter = useChapterStore((s) => s.setCurrentChapter);
  const foreshadows = useForeshadowStore((s) => s.foreshadows);
  const notes = useNoteStore((s) => s.notes);
  // ★ 插件化：订阅插件注册的命令
  const pluginCommands = usePluginRegistry((s) => s.commands);

  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    if (isOpen) {
      setQuery('');
      focusTimerRef.current = setTimeout(() => inputRef.current?.focus(), 50);
    }
    return () => {
      if (focusTimerRef.current) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    };
  }, [isOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const q = query.toLowerCase();

  const results = [
    ...chapters
      .filter((ch) => ch.title.toLowerCase().includes(q))
      .map((ch) => ({
        type: 'chapter' as const,
        icon: FileText,
        label: ch.title,
        sublabel: `${ch.wordCount} 字`,
        action: () => {
          setCurrentChapter(ch.id);
          onNavigate('/project');
          onClose();
        },
      })),
    ...characters
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.aliases?.some((a) => a.toLowerCase().includes(q))
      )
      .map((c) => ({
        type: 'character' as const,
        icon: Users,
        label: c.name,
        sublabel: c.aliases?.join(', ') || '角色',
        action: () => {
          onNavigate('/project');
          onClose();
        },
      })),
    ...foreshadows
      .filter((fs) => fs.description.toLowerCase().includes(q))
      .map((fs) => ({
        type: 'foreshadow' as const,
        icon: Bookmark,
        label: fs.description.slice(0, 50),
        sublabel: fs.status,
        action: () => {
          onNavigate('/project');
          onClose();
        },
      })),
    ...notes
      .filter(
        (n) =>
          n.title?.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q)
      )
      .map((n) => ({
        type: 'note' as const,
        icon: StickyNote,
        label: n.title || '无标题笔记',
        sublabel: n.content.slice(0, 30),
        action: () => {
          onNavigate('/project');
          onClose();
        },
      })),
    ...pluginCommands
      .filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.keywords?.some((k) => k.toLowerCase().includes(q))
      )
      .map((c) => ({
        type: 'plugin' as const,
        icon: CommandIcon,
        label: c.title,
        sublabel: c.keywords?.join(' · ') || '插件命令',
        action: () => {
          c.run();
          onClose();
        },
      })),
  ].slice(0, 10);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-background border rounded-2xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Search size={16} className="text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索章节、角色、伏笔、笔记..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <kbd className="text-xs text-muted-foreground border rounded px-1">ESC</kbd>
        </div>

        <div className="max-h-64 overflow-y-auto">
          {results.length === 0 && query && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              无匹配结果
            </div>
          )}
          {results.length === 0 && !query && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              输入关键词搜索...
            </div>
          )}
          {results.map((result, i) => (
            <button
              key={i}
              onClick={result.action}
              className="w-full flex items-center gap-3 px-4 py-2 hover:bg-accent text-left"
            >
              <result.icon size={16} className="text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{result.label}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {result.sublabel}
                </div>
              </div>
              <span className="text-xs text-muted-foreground capitalize">
                {result.type === 'chapter' && '章节'}
                {result.type === 'character' && '角色'}
                {result.type === 'foreshadow' && '伏笔'}
                {result.type === 'note' && '笔记'}
                {result.type === 'plugin' && '插件'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
