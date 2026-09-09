import { useForeshadowStore, useChapterStore, getForeshadowThreshold } from '@/stores';
import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export function ForeshadowWarning() {
  // 使用 selector 精确订阅
  const getOverdueForeshadows = useForeshadowStore(s => s.getOverdueForeshadows);
  const chapters = useChapterStore(s => s.chapters);
  const currentChapterId = useChapterStore(s => s.currentChapterId);
  const [toastVisible, setToastVisible] = useState(false);

  // 获取当前章节的 order
  const currentChapter = chapters.find((ch) => ch.id === currentChapterId);
  const currentOrder = currentChapter?.order ?? 1;

  // 当切换到新章节时，检测是否有逾期伏笔
  useEffect(() => {
    const overdue = getOverdueForeshadows(currentOrder);
    if (overdue.length > 0) {
      setToastVisible(true);
    }
  }, [currentOrder, currentChapterId, getOverdueForeshadows]);

  const overdue = getOverdueForeshadows(currentOrder);

  return (
    <>
      {/* Toast 弹窗（overdue 级别） */}
      {toastVisible && overdue.length > 0 && (
        <div className="fixed top-4 right-4 z-50 bg-background border border-destructive/30 rounded-lg shadow-lg p-4 max-w-sm transition-opacity">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-destructive mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">伏笔遗忘提醒</p>
              <p className="text-xs text-muted-foreground mt-1">
                有 {overdue.length} 个伏笔超过 {overdue[0] ? getForeshadowThreshold(overdue[0].type).overdue : 0} 章未被提及
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => { window.dispatchEvent(new CustomEvent('nm:open-panel', { detail: { key: 'foreshadows' } })); setToastVisible(false); }}
                  className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded-xl hover:opacity-90"
                >
                  查看
                </button>
                <button
                  onClick={() => setToastVisible(false)}
                  className="text-xs px-2 py-1 border rounded-xl hover:bg-accent"
                >
                  忽略
                </button>
              </div>
            </div>
            <button
              onClick={() => setToastVisible(false)}
              className="text-muted-foreground hover:text-foreground hover:bg-muted/50 shrink-0 p-1 rounded-xl transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}