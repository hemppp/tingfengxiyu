// ============================================================
// dock/CenterGraphPanel.tsx — 中心槽的「关系图 / 图谱」承载（P2 · t3）
//
// D16（冻结）：**不引入任何 C++ / Qt / CMake / QGraphicsView**。
//   用户原话里的 "QGraphicsView" 只是对「可缩放画布」的类比，
//   本项目用**既有依赖** `@xyflow/react` 实现 —— 见 package.json 已声明 `@xyflow/react: ^12.10.2`。
//
// 本组件演示「中心区为可替换插槽」：它作为一个 `dock: { center: true, slot: 'center' }`
// 的面板，打开时抢占中心区，替换默认的章节编辑器出口。
// 真实业务图谱由插件注册自己的 Component；此处只提供**最小可运行**的承载骨架，
// 使「关系图以 @xyflow/react 承载」这一验收项可被静态与运行双重验证。
// ============================================================

import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const initialNodes: Node[] = [
  { id: 'protagonist', position: { x: 60, y: 40 }, data: { label: '主角' }, type: 'default' },
  { id: 'rival', position: { x: 300, y: 40 }, data: { label: '对手' }, type: 'default' },
  { id: 'faction-a', position: { x: 60, y: 190 }, data: { label: '势力甲' }, type: 'default' },
  { id: 'faction-b', position: { x: 300, y: 190 }, data: { label: '势力乙' }, type: 'default' },
];

const initialEdges: Edge[] = [
  { id: 'e1', source: 'protagonist', target: 'faction-a', label: '归属' },
  { id: 'e2', source: 'rival', target: 'faction-b', label: '归属' },
  { id: 'e3', source: 'protagonist', target: 'rival', label: '对立' },
];

/** 关系图中心面板（可替换插槽的默认演示实现）。 */
export function CenterGraphPanel() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  );
  const onConnect = useCallback(
    (connection: Connection) => setEdges((es) => addEdge(connection, es)),
    [],
  );

  const defaultEdgeOptions = useMemo(() => ({ style: { strokeWidth: 1.5 } }), []);

  return (
    <div className="dock-graph-panel">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--vscode-editor-lineHighlight)" gap={20} />
        <MiniMap
          pannable
          zoomable
          style={{ background: 'var(--vscode-editor-background)' }}
          maskColor="var(--vscode-widget-shadow)"
        />
        <Controls
          style={{
            background: 'var(--vscode-editorWidget-background)',
            border: '1px solid var(--vscode-editorWidget-border)',
          }}
        />
      </ReactFlow>
    </div>
  );
}
