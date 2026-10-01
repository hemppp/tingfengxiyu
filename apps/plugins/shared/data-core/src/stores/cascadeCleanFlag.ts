// ============================================================
// 级联清理标志
//
// 问题：cascadeCleanChapterClient 一次性删除多个实体时，
// useEntitySync 的批量删除保护（≥3个同时消失就跳过 DELETE）
// 会阻止后端清理，导致刷新后实体从后端回来。
//
// 解决：cascadeCleanChapterClient 修改 store 前激活标志，
// useEntitySync 检测到标志激活时绕过批量删除保护。
// 标志保持 10 秒，确保异步 handler 有足够时间完成。
// ============================================================

let _active = false;
let _timeout: ReturnType<typeof setTimeout> | null = null;

export const cascadeCleanFlag = {
  get active() {
    return _active;
  },

  /** 激活标志，10 秒后自动失效 */
  activate() {
    _active = true;
    if (_timeout) clearTimeout(_timeout);
    _timeout = setTimeout(() => {
      _active = false;
    }, 10000);
  },
};
