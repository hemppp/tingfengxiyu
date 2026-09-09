import { useEffect, useRef } from 'react';
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type Simulation,
  type SimulationNodeDatum,
} from 'd3-force';
import type { Node, Edge } from '@xyflow/react';

// 标准力导向布局 hook —— 三个关系图共用同一套参数
//
// 设计目标：
//   1. 三个图谱视觉一致 —— 同样的斥力、引力、碰撞、衰减
//   2. 节点尺寸参与碰撞计算，避免重叠
//   3. 仅在节点数量变化时重新启动仿真，避免每次数据更新都重排
//
// 参数说明（统一基准）：
//   linkDistance    150     连线长度
//   chargeStrength  -500    节点斥力
//   centerStrength  0.06    向心力
//   collideStrength 0.85    碰撞硬度
//   alphaDecay      0.04    降温速度（越大越快静止）
//   velocityDecay   0.45    速度衰减

interface SimNode extends SimulationNodeDatum {
  id: string;
}

interface UseForceLayoutOptions {
  nodes: Node[];
  edges: Edge[];
  sizeMap: Map<string, number>; // 节点 id -> 碰撞半径
  centerX?: number;
  centerY?: number;
  // 依赖项：仅当此值变化时重启仿真（通常传 nodes.length）
  trigger: unknown;
  onTick: (positions: Map<string, { x: number; y: number }>) => void;
}

export function useForceLayout({
  nodes,
  edges,
  sizeMap,
  centerX = 450,
  centerY = 320,
  trigger,
  onTick,
}: UseForceLayoutOptions) {
  const simulationRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const runningRef = useRef(false);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (nodes.length < 2 || runningRef.current) return;

    runningRef.current = true;

    const simNodes: SimNode[] = nodes.map((n) => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
    }));

    const simLinks = edges.map((e) => ({
      source: e.source,
      target: e.target,
    }));

    const simulation = forceSimulation<SimNode>(simNodes)
      .force('link', forceLink(simLinks).id((d: any) => d.id).distance(150).strength(0.4))
      .force('charge', forceManyBody().strength(-500))
      .force('center', forceCenter(centerX, centerY).strength(0.06))
      .force('collide', forceCollide().radius((d: any) => sizeMap.get(d.id) || 35).strength(0.85))
      .alphaDecay(0.04)
      .velocityDecay(0.45)
      .on('tick', () => {
        const posMap = new Map<string, { x: number; y: number }>();
        for (const sn of simNodes) {
          if (sn.x !== undefined && sn.y !== undefined) {
            posMap.set(sn.id, { x: sn.x, y: sn.y });
          }
        }
        onTickRef.current(posMap);
      })
      .on('end', () => {
        runningRef.current = false;
      });

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
      runningRef.current = false;
    };
  }, [trigger]);
}
