// ============================================================
// Web 插件类型 —— 契约来自 @novel/core/web，本地补充具体组件类型
// ============================================================

import type React from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Editor, AnyExtension } from '@tiptap/core';
import type {
  WebPluginContext as CoreWebPluginContext,
  WebCommandDef as CoreCommandDef,
  WebRouteDef as CoreRouteDef,
  WebRouteGuard as CoreRouteGuard,
  SettingsCategory as CoreSettingsCategory,
} from '@novel/core/web';

// ---- 具体化类型（组件层使用，icon/Component 用真实类型）----

/** 项目浮窗面板（对应 ProjectLayout 面板宿主） */
export interface FloatingPanelDef {
  icon: LucideIcon;
  label: string;
  key: string;
  /** any：面板组件可声明自己的 props（如 AI 对话的 controls），宿主按 key 决定是否透传 */
  Component: React.ComponentType<any>;
  width?: number;
  height?: number;
  order?: number;
  /** 'workspace'（缺省）进顶栏按钮组；'editor' 由编辑器内面板栏开关 */
  scope?: 'workspace' | 'editor';
}

export interface CommandDef extends Omit<CoreCommandDef, never> {
  id: string;
  title: string;
  keywords?: string[];
  run: () => void | Promise<void>;
  order?: number;
}

export type RouteGuard = CoreRouteGuard;

export interface PluginRouteDef extends Omit<CoreRouteDef, never> {
  path: string;
  Component: React.ComponentType;
  guard?: RouteGuard;
  inProject?: boolean;
  order?: number;
}

export type SettingsCategory = CoreSettingsCategory;

/** 设置页区块（宿主提供 nm-card 外壳 + 标题，插件只给内容组件） */
export interface SettingsSectionDef {
  key: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  Component: React.ComponentType;
  category?: SettingsCategory;
  order?: number;
}

/** 编辑器 Tiptap 扩展工厂（每个编辑器实例调用一次 create） */
export interface EditorExtensionDef {
  key: string;
  create: () => AnyExtension;
  order?: number;
}

/** 编辑器工具栏条目 */
export interface EditorToolbarItemDef {
  key: string;
  label: string;
  icon?: LucideIcon;
  run: (editor: Editor) => void | Promise<void>;
  isActive?: (editor: Editor) => boolean;
  order?: number;
}

/** 选区菜单动作（icon 可为 Lucide 组件或 emoji 字符串） */
export interface SelectionActionDef {
  key: string;
  label: string;
  icon?: LucideIcon | string;
  color?: string;
  run: (payload: { text: string; editor: Editor }) => void | Promise<void>;
  order?: number;
}

// ---- 插件上下文 / 模块契约（re-export core）----

export type WebPluginContext = CoreWebPluginContext;
export type WebPluginModule = import('@novel/core/web').WebPluginModule;
