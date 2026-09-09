// ============================================================
// 获取当前项目 ID 的统一 Hook
// 所有创建实体/标注/伏笔的组件都通过此 Hook 获取 projectId，
// 替代之前硬编码的 '默认'
// ============================================================

import { useProjectStore } from '@/stores';

/**
 * 获取当前选中的项目 ID。
 * 必须在 ProjectLayout 或已加载项目的上下文中使用。
 *
 * @返回 当前项目的 UUID，如果没有项目则返回 null
 */
export function useCurrentProjectId(): string | null {
  const project = useProjectStore((s) => s.currentProject);
  
  // 如果没有当前项目，返回 null 而不是抛出错误
  // 让调用方决定如何处理这种情况
  if (!project?.id) {
    console.warn('[useCurrentProjectId] ⚠️ 当前无项目！请确保在进入需要 projectId 的页面前已选择项目。');
    return null;
  }
  
  return project.id;
}
