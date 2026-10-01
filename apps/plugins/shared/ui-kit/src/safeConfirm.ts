/**
 * 安全确认对话框 — 在 确认() 不可用的环境中回退
 *
 * 回退策略：环境异常时默认返回 false（拒绝操作），
 * 避免在无法弹窗时放行删除等破坏性操作。
 */
export function safeConfirm(message: string): boolean {
  try {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      return window.confirm(message);
    }
  } catch {
    // 确认 不可用，默认拒绝操作（保护数据安全）
  }
  return false;
}