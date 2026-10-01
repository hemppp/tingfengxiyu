// ============================================================
// 手写台内置面板定义（12 个浮窗面板）
//
// 原 kernel `apps/web/src/plugin/builtin.ts`（t4 迁入模块，D1/D35）：
//   · 面板定义改由 manual 模块自持，kernel 不再静态 import 手写台内部实现
//   · 懒加载保持 chunk 分割（与原 ProjectLayout lazy import 行为一致）
//   · 全部 modes: ['manual'] —— AI 写作模式有自己的一套面板（auto 模块）
// ============================================================

import React from 'react';
import {
  BookText, StickyNote, BarChart3, AlignLeft, Clock, Users, MapPin, Lightbulb, Database,
  Network, Map, Download,
} from 'lucide-react';
import type { FloatingPanelDef } from '@/plugin/types';

// 懒加载保持 chunk 分割（模块内相对路径）
const ReferenceReader = React.lazy(() => import('./editor/ReferenceReader').then((m) => ({ default: m.ReferenceReader })));
const OutlinePage = React.lazy(() => import('./outline/OutlinePage').then((m) => ({ default: m.OutlinePage })));
const CharacterManager = React.lazy(() => import('./knowledge/CharacterManager').then((m) => ({ default: m.CharacterManager })));
const LocationManager = React.lazy(() => import('./knowledge/LocationManager').then((m) => ({ default: m.LocationManager })));
const ItemManager = React.lazy(() => import('./knowledge/ItemManager').then((m) => ({ default: m.ItemManager })));
const StoryMap = React.lazy(() => import('./knowledge/StoryMap').then((m) => ({ default: m.StoryMap })));
const TimelinePage = React.lazy(() => import('./timeline/TimelinePage').then((m) => ({ default: m.TimelinePage })));
const ForeshadowManager = React.lazy(() => import('./foreshadow/ForeshadowManager').then((m) => ({ default: m.ForeshadowManager })));
const NoteManager = React.lazy(() => import('./notes/NoteManager').then((m) => ({ default: m.NoteManager })));
const WritingDashboard = React.lazy(() => import('./stats/WritingDashboard').then((m) => ({ default: m.WritingDashboard })));
const RelationGraph = React.lazy(() => import('./knowledge/RelationGraph').then((m) => ({ default: m.RelationGraph })));
const ExportDialog = React.lazy(() => import('./export/ExportDialog').then((m) => ({ default: m.ExportDialog })));

/**
 * 内置面板定义（与原 kernel builtin.ts 完全一致）。
 * 12 个工作台面板均属**手写台**（modes: ['manual']）。
 */
export const BUILTIN_PANELS: FloatingPanelDef[] = [
  { icon: BookText, label: '参考书', key: 'reference', Component: ReferenceReader, width: 560, height: 800, modes: ['manual'] },
  { icon: StickyNote, label: '笔记', key: 'notes', Component: NoteManager, width: 900, height: 800, modes: ['manual'] },
  { icon: BarChart3, label: '统计', key: 'stats', Component: WritingDashboard, width: 900, height: 800, modes: ['manual'] },
  { icon: AlignLeft, label: '大纲', key: 'outline', Component: OutlinePage, width: 900, height: 800, modes: ['manual'] },
  { icon: Clock, label: '时间线', key: 'timeline', Component: TimelinePage, width: 900, height: 800, modes: ['manual'] },
  { icon: Users, label: '角色', key: 'characters', Component: CharacterManager, width: 900, height: 800, modes: ['manual'] },
  { icon: MapPin, label: '地点', key: 'locations', Component: LocationManager, width: 900, height: 800, modes: ['manual'] },
  { icon: Lightbulb, label: '伏笔', key: 'foreshadows', Component: ForeshadowManager, width: 900, height: 800, modes: ['manual'] },
  { icon: Database, label: '物品', key: 'items', Component: ItemManager, width: 900, height: 800, modes: ['manual'] },
  { icon: Network, label: '关系图', key: 'relationGraph', Component: RelationGraph, width: 900, height: 800, modes: ['manual'] },
  { icon: Map, label: '地图', key: 'storyMap', Component: StoryMap, width: 900, height: 800, modes: ['manual'] },
  { icon: Download, label: '导出', key: 'export', Component: ExportDialog, width: 800, height: 700, modes: ['manual'] },
] as FloatingPanelDef[];