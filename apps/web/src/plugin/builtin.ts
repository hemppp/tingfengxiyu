// ============================================================
// Web 内置面板插件 —— 12 个工作台浮窗面板
//
// 原：ProjectLayout.tsx 硬编码 floatingPanelConfigs 数组
// 现：每个面板以"内置插件"形式注册，ProjectLayout 只做渲染宿主。
// 新增面板 = 在这里加一行 registerProjectPanel，无需改宿主组件。
// scope: 'editor' 的面板不进顶栏，由编辑器内的面板栏（EditorPanelRail）开关。
// ============================================================

import React from 'react';
import {
  BookText, StickyNote, BarChart3, AlignLeft, Clock, Users, MapPin, Lightbulb, Database,
  Network, Map, Download,
} from 'lucide-react';
import type { FloatingPanelDef, WebPluginModule } from './types';

// 懒加载保持 chunk 分割（与原 ProjectLayout lazy import 行为一致）
const ReferenceReader = React.lazy(() => import('@/components/editor/ReferenceReader').then((m) => ({ default: m.ReferenceReader })));
const OutlinePage = React.lazy(() => import('@/components/outline/OutlinePage').then((m) => ({ default: m.OutlinePage })));
const CharacterManager = React.lazy(() => import('@/components/knowledge/CharacterManager').then((m) => ({ default: m.CharacterManager })));
const LocationManager = React.lazy(() => import('@/components/knowledge/LocationManager').then((m) => ({ default: m.LocationManager })));
const ItemManager = React.lazy(() => import('@/components/knowledge/ItemManager').then((m) => ({ default: m.ItemManager })));
const StoryMap = React.lazy(() => import('@/components/knowledge/StoryMap').then((m) => ({ default: m.StoryMap })));
const TimelinePage = React.lazy(() => import('@/components/timeline/TimelinePage').then((m) => ({ default: m.TimelinePage })));
const ForeshadowManager = React.lazy(() => import('@/components/foreshadow/ForeshadowManager').then((m) => ({ default: m.ForeshadowManager })));
const NoteManager = React.lazy(() => import('@/components/notes/NoteManager').then((m) => ({ default: m.NoteManager })));
const WritingDashboard = React.lazy(() => import('@/components/stats/WritingDashboard').then((m) => ({ default: m.WritingDashboard })));
const RelationGraph = React.lazy(() => import('@/components/knowledge/RelationGraph').then((m) => ({ default: m.RelationGraph })));
const ExportDialog = React.lazy(() => import('@/components/export/ExportDialog').then((m) => ({ default: m.ExportDialog })));

/** 内置面板定义（与原 floatingPanelConfigs 完全一致） */
export const BUILTIN_PANELS: FloatingPanelDef[] = [
  { icon: BookText, label: '参考书', key: 'reference', Component: ReferenceReader, width: 560, height: 800 },
  { icon: StickyNote, label: '笔记', key: 'notes', Component: NoteManager, width: 1200, height: 800 },
  { icon: BarChart3, label: '统计', key: 'stats', Component: WritingDashboard, width: 1200, height: 800 },
  { icon: AlignLeft, label: '大纲', key: 'outline', Component: OutlinePage, width: 1200, height: 800 },
  { icon: Clock, label: '时间线', key: 'timeline', Component: TimelinePage, width: 1200, height: 800 },
  { icon: Users, label: '角色', key: 'characters', Component: CharacterManager, width: 1200, height: 800 },
  { icon: MapPin, label: '地点', key: 'locations', Component: LocationManager, width: 1200, height: 800 },
  { icon: Lightbulb, label: '伏笔', key: 'foreshadows', Component: ForeshadowManager, width: 1200, height: 800 },
  { icon: Database, label: '物品', key: 'items', Component: ItemManager, width: 1200, height: 800 },
  { icon: Network, label: '关系图', key: 'relationGraph', Component: RelationGraph, width: 1200, height: 800 },
  { icon: Map, label: '地图', key: 'storyMap', Component: StoryMap, width: 1200, height: 800 },
  { icon: Download, label: '导出', key: 'export', Component: ExportDialog, width: 800, height: 700 },
];

/** 内置面板插件：apply 时把所有面板注册进注册表 */
export const builtinPanelsPlugin: WebPluginModule = {
  name: 'novel.builtin-panels',
  apply(ctx) {
    for (const panel of BUILTIN_PANELS) {
      ctx.registerProjectPanel(panel);
    }
  },
};
