import { useState } from 'react';
import { useChapterStore, useCharacterStore } from '@/stores';
import { checkConsistency, type ConsistencyCheckResult } from '@/services/misc/consistencyService';
import { AlertTriangle, CheckCircle, Info, Search, Loader2, RefreshCw } from 'lucide-react';

export function ConsistencyPanel() {
  const chapters = useChapterStore((s) => s.chapters);
  const currentChapterId = useChapterStore((s) => s.currentChapterId);
  const characters = useCharacterStore((s) => s.characters);
  const [results, setResults] = useState<ConsistencyCheckResult[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkedChapter, setCheckedChapter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentChapter = chapters.find(ch => ch.id === currentChapterId);

  const handleCheck = async () => {
    if (!currentChapter) return;
    setChecking(true);
    setError(null);

    try {
      const characterNames = characters.map(c => c.name);
      const characterTraits: Record<string, string> = {};
      characters.forEach(c => {
        if (c.personality) characterTraits[c.name] = c.personality;
      });

      const previousChapters = chapters
        .filter(ch => ch.order < currentChapter.order)
        .sort((a, b) => a.order - b.order)
        .slice(-3)
        .map(ch => ch.content);

      const issues = await checkConsistency(currentChapter.content, {
        characterNames,
        characterTraits,
        previousChapters,
      });

      setResults(Array.isArray(issues) ? issues : []);
      setCheckedChapter(currentChapter.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : '一致性检查失败，请重试';
      setError(message);
    } finally {
      setChecking(false);
    }
  };

  const severityConfig = {
    error: { icon: AlertTriangle, color: 'text-destructive', bg: 'bg-destructive/10', tagClass: 'mc-tag-error' },
    warning: { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-500/10', tagClass: 'mc-tag-warning' },
    info: { icon: Info, color: 'text-blue-500', bg: 'bg-blue-500/10', tagClass: 'mc-tag-info' },
  };

  return (
    <div className="mc-window h-full flex flex-col">
      <div className="mc-modal-header p-3 border-b flex items-center gap-2">
        <Search size={16} aria-hidden="true" />
        <h2 className="mc-title">一致性检查</h2>
        <div className="flex-1" />
        <button
          onClick={handleCheck}
          disabled={checking || !currentChapter}
          className={`mc-btn mc-btn-primary px-3 py-1 text-xs disabled:opacity-50 flex items-center gap-1 ${checking ? 'animate-mc-xp' : ''}`}
          aria-label="检查本章一致性"
        >
          {checking ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Search size={12} aria-hidden="true" />}
          {checking ? '检查中...' : '检查本章'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 mc-scrollbar">
        {error ? (
          <div className="mc-auth-error p-4 flex items-start gap-2" role="alert">
            <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-destructive">{error}</p>
              <button
                onClick={handleCheck}
                className="mc-hotbar-btn flex items-center gap-1 text-xs mt-2"
              >
                <RefreshCw size={10} aria-hidden="true" />
                重试
              </button>
            </div>
          </div>
        ) : !currentChapter ? (
          <div className="text-center text-muted-foreground p-8">
            <p className="mc-title-sm">请先选择一个章节</p>
          </div>
        ) : checkedChapter !== currentChapter.id ? (
          <div className="text-center text-muted-foreground p-8">
            <p className="mb-2">当前章节：「{currentChapter.title}」</p>
            <button onClick={handleCheck} className="mc-hotbar-btn text-sm">
              点击执行一致性检查
            </button>
          </div>
        ) : results.length === 0 ? (
          <div className="text-center p-8">
            <CheckCircle size={24} className="mx-auto mb-2 text-green-500" aria-hidden="true" />
            <p className="mc-title-sm text-muted-foreground">未发现一致性问题</p>
            <p className="text-xs text-muted-foreground mt-1">章节内容质量良好</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2 mb-3">
              <span className={`mc-tag ${severityConfig.error.tagClass}`}>
                {results.filter(r => r.severity === 'error').length} 错误
              </span>
              <span className={`mc-tag ${severityConfig.warning.tagClass}`}>
                {results.filter(r => r.severity === 'warning').length} 警告
              </span>
              <span className={`mc-tag ${severityConfig.info.tagClass}`}>
                {results.filter(r => r.severity === 'info').length} 提示
              </span>
            </div>

            {results.map((issue) => {
              const config = severityConfig[issue.severity] || severityConfig.info;
              const Icon = config.icon;
              return (
                <div key={`${issue.type}-${issue.message}-${issue.chapter || 'none'}`} className={`mc-card border p-3 ${config.bg}`}>
                  <div className="flex items-start gap-2">
                    <Icon size={14} className={`${config.color} mt-0.5`} aria-hidden="true" />
                    <div className="flex-1">
                      <div className="text-xs font-medium">{issue.message}</div>
                      {issue.suggestion && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {issue.suggestion}
                        </div>
                      )}
                      <div className="flex gap-2 mt-1">
                        <span className="text-xs text-muted-foreground capitalize">{issue.type}</span>
                        {issue.chapter && <span className="text-xs text-muted-foreground">{issue.chapter}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
