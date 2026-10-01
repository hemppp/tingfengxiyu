// ============================================================
// @novel-plugins/ui-graph — 共享图元语（无业务状态）
//
// 由 kernel / manual / auto 共同消费：关系图、时间线流程图、
// 流水线图谱、记忆图谱都复用同一套图元（GraphShell + 节点 + 力导向 + 3D）。
// 归属见设计 §2.3 / §3.2：`components/knowledge/graph/*` 下沉至此，
// 从而消除 auto 三面板对 manual 域 `@/components/knowledge/graph/*` 的跨域依赖。
// ============================================================

export { GraphShell, RelationTypeDialog } from './GraphShell';
export type { GraphShellProps, RelationTypeOption } from './GraphShell';

export { StageNode, statusInk, statusText } from './StageNode';
export type { StageNodeData, StageVisualStatus } from './StageNode';

export { EntityNode, kindInk } from './EntityNode';
export type { EntityKind, EntityNodeData } from './EntityNode';

export { BubbleNode } from './BubbleNode';
export type { BubbleNodeData } from './BubbleNode';

export {
  applyMultiEdgeCurvature,
  applyEdgeLabelVisibility,
  enhancedEdgeTypes,
  BubbleEdge,
  SelfLoopEdge,
} from './enhancedEdges';

export { Graph3D } from './Graph3D';
export type { Graph3DProps, Graph3DHandle } from './Graph3D';

export { useForceLayout } from './useForceLayout';
