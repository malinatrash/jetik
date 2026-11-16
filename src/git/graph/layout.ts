export interface GraphEdge {
  from: number;
  to: number;
  color: number;
}

/**
 * Drawing instructions for one log row. A row is self-contained: `top` edges run from the
 * row's upper border to its middle, `bottom` edges from the middle to the lower border.
 */
export interface GraphRow {
  column: number;
  color: number;
  top: GraphEdge[];
  bottom: GraphEdge[];
  /** Number of lanes this row occupies. */
  width: number;
}

interface Lane {
  /** Commit this lane is heading to. */
  hash: string;
  color: number;
}

/**
 * Incremental lane assignment for a commit stream ordered children-before-parents.
 * Feed commits one by one; state carries over, so pages can be laid out as they load.
 */
export class GraphLayouter {
  private lanes: (Lane | null)[] = [];
  private nextColor = 0;

  next(hash: string, parents: readonly string[]): GraphRow {
    const lanes = this.lanes;
    const top: GraphEdge[] = [];
    const bottom: GraphEdge[] = [];

    let column = lanes.findIndex((lane) => lane?.hash === hash);
    const continuesLane = column !== -1;
    let color: number;
    if (!continuesLane) {
      column = this.allocate();
      color = this.nextColor++;
    } else {
      color = lanes[column]!.color;
    }

    // Upper half: lanes waiting for this commit converge on it, the rest pass straight through.
    lanes.forEach((lane, index) => {
      if (!lane) return;
      if (lane.hash === hash) {
        top.push({ from: index, to: column, color: lane.color });
        lanes[index] = null;
      } else {
        top.push({ from: index, to: index, color: lane.color });
        bottom.push({ from: index, to: index, color: lane.color });
      }
    });
    let width = Math.max(lanes.length, column + 1);

    // Lower half: fan out to parents. The first parent inherits the commit's lane and color.
    parents.forEach((parent, index) => {
      const existing = lanes.findIndex((lane) => lane?.hash === parent);
      // A branch tip listed earlier may have reserved a lane further right for the same parent.
      // An ongoing lane then goes straight on and that lane converges on the parent's row,
      // rather than this one bending into it and handing over its column and color.
      const keepsLane = index === 0 && continuesLane && existing > column;
      if (existing !== -1 && !keepsLane) {
        bottom.push({ from: column, to: existing, color: index === 0 ? color : lanes[existing]!.color });
        return;
      }
      const slot = index === 0 ? column : this.allocate();
      lanes[slot] = { hash: parent, color: index === 0 ? color : this.nextColor++ };
      bottom.push({ from: column, to: slot, color: lanes[slot]!.color });
    });

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    width = Math.max(width, lanes.length);
    return { column, color, top, bottom, width };
  }

  private allocate(): number {
    const free = this.lanes.indexOf(null);
    if (free !== -1) return free;
    this.lanes.push(null);
    return this.lanes.length - 1;
  }
}
