import type { GraphEdge, GraphRow } from '../../src/git/graph/layout';

export const ROW_HEIGHT = 24;
const LANE = 14;
const MAX_LANES = 14;
const PALETTE = ['#3d8fe0', '#e39a3c', '#56b35b', '#a970d6', '#e0625f', '#30b3a4', '#c7ad2b', '#e070ad'];

const laneX = (lane: number) => LANE / 2 + lane * LANE;
export const laneColor = (color: number) => PALETTE[color % PALETTE.length];
export const graphWidth = (graph: GraphRow | undefined) => (graph ? Math.min(graph.width, MAX_LANES) * LANE + 4 : 8);

function edgePath(edge: GraphEdge, fromY: number, toY: number): string {
  const x1 = laneX(edge.from);
  const x2 = laneX(edge.to);
  if (x1 === x2) return `M${x1},${fromY}V${toY}`;
  const midY = (fromY + toY) / 2;
  return `M${x1},${fromY}C${x1},${midY} ${x2},${midY} ${x2},${toY}`;
}

/** One row's slice of the commit graph: incoming edges, the node, outgoing edges. */
export function GraphCell({ graph, isHead }: { graph: GraphRow; isHead: boolean }) {
  const middle = ROW_HEIGHT / 2;
  const color = laneColor(graph.color);
  return (
    <svg class="graph" width={graphWidth(graph)} height={ROW_HEIGHT}>
      {graph.top.map((edge) => (
        <path d={edgePath(edge, 0, middle)} stroke={laneColor(edge.color)} />
      ))}
      {graph.bottom.map((edge) => (
        <path d={edgePath(edge, middle, ROW_HEIGHT)} stroke={laneColor(edge.color)} />
      ))}
      {isHead ? (
        <circle cx={laneX(graph.column)} cy={middle} r={4.5} fill="var(--vscode-editor-background)" stroke={color} stroke-width={2.5} />
      ) : (
        <circle cx={laneX(graph.column)} cy={middle} r={4} fill={color} />
      )}
    </svg>
  );
}
