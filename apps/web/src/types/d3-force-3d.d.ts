// 最小类型声明：d3-force-3d（npm 无 @types 包，手写本项目用到的 API）
// 参考 d3-force 的 @types 结构，扩展为三维坐标
declare module 'd3-force-3d' {
  export interface SimulationNodeDatum3D {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    fx?: number | null;
    fy?: number | null;
    fz?: number | null;
  }

  export interface SimulationLinkDatum3D<NodeDatum extends SimulationNodeDatum3D> {
    source: number | string | NodeDatum;
    target: number | string | NodeDatum;
  }

  export interface Force3D {
    (alpha: number): void;
  }

  export interface Simulation3D<NodeDatum extends SimulationNodeDatum3D, LinkDatum> {
    restart(): this;
    stop(): this;
    tick(iterations?: number): this;
    nodes(): NodeDatum[];
    nodes(nodes: NodeDatum[]): this;
    alpha(): number;
    alpha(alpha: number): this;
    alphaMin(): number;
    alphaMin(alphaMin: number): this;
    alphaDecay(): number;
    alphaDecay(alphaDecay: number): this;
    alphaTarget(): number;
    alphaTarget(alphaTarget: number): this;
    velocityDecay(): number;
    velocityDecay(velocityDecay: number): this;
    force(name: string): Force3D | undefined;
    force(name: string, force: Force3D | null): this;
    on(typenames: string): ((this: Simulation3D<NodeDatum, LinkDatum>) => void) | undefined;
    on(typenames: string, listener: ((this: Simulation3D<NodeDatum, LinkDatum>) => void) | null): this;
  }

  export interface ForceLink3D<NodeDatum extends SimulationNodeDatum3D, LinkDatum>
    extends Force3D {
    links(): LinkDatum[];
    links(links: LinkDatum[]): this;
    id(): (d: NodeDatum) => string;
    id(id: (d: NodeDatum) => string): this;
    distance(): number;
    distance(distance: number | ((d: LinkDatum) => number)): this;
    strength(): number;
    strength(strength: number | ((d: LinkDatum) => number)): this;
  }

  export interface ForceManyBody3D extends Force3D {
    strength(): number;
    strength(strength: number): this;
    theta(): number;
    theta(theta: number): this;
    distanceMin(): number;
    distanceMin(distanceMin: number): this;
    distanceMax(): number;
    distanceMax(distanceMax: number): this;
  }

  export interface ForceCenter3D extends Force3D {
    x(): number;
    x(x: number): this;
    y(): number;
    y(y: number): this;
    z(): number;
    z(z: number): this;
    strength(): number;
    strength(strength: number): this;
  }

  export interface ForceCollide3D<NodeDatum extends SimulationNodeDatum3D>
    extends Force3D {
    radius(): number;
    radius(radius: number | ((d: NodeDatum) => number)): this;
    strength(): number;
    strength(strength: number): this;
    iterations(): number;
    iterations(iterations: number): this;
  }

  // 注意：d3-force-3d 的导出名不带 3D 后缀（forceSimulation/forceLink/...），
  // 其内部实现即三维（x/y/z），与 d3-force 的二维版区分。
  export function forceSimulation<NodeDatum extends SimulationNodeDatum3D, LinkDatum = undefined>(
    nodes?: NodeDatum[],
  ): Simulation3D<NodeDatum, LinkDatum>;

  export function forceLink<NodeDatum extends SimulationNodeDatum3D, LinkDatum>(
    links?: LinkDatum[],
  ): ForceLink3D<NodeDatum, LinkDatum>;

  export function forceManyBody<NodeDatum extends SimulationNodeDatum3D>(): ForceManyBody3D<NodeDatum>;

  export function forceCenter(x?: number, y?: number, z?: number): ForceCenter3D;

  export function forceCollide<NodeDatum extends SimulationNodeDatum3D>(): ForceCollide3D<NodeDatum>;
}
