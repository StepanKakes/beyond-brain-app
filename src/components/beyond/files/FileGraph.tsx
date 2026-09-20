import { useEffect, useMemo, useRef } from 'react';

import type { Graph } from './api';
import { basename } from './api';

/**
 * Beyond Brain — the brain as a graph, the way Obsidian draws it.
 *
 * A node is a note, an edge is a link one note makes to another. Colour says
 * which top-level folder the note lives in, size says how many notes point at
 * it, and the selected note sits in the middle with its neighbourhood lit up.
 * Plain canvas, a small force simulation, no library: drag a node, drag the
 * background or scroll to pan, pinch or Ctrl + wheel to zoom, click a node to
 * open it. The picture fits itself to the frame while it settles, and stays
 * where the person put it once they touch it.
 */

type SimNode = {
  path: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  group: string;
  deg: number;
  pinned: boolean;
};

const GROUP_TOKEN: Record<string, string> = {
  clients: '--bb-p3',
  system: '--bb-p2',
  '.claude': '--bb-work',
  knowledge: '--bb-p1',
  workspace: '--bb-p4',
  'second-brain': '--bb-warn',
};

export const GROUP_LABEL: Record<string, string> = {
  clients: 'Klienti',
  system: 'Systém',
  '.claude': 'Skilly',
  knowledge: 'Znalosti',
  workspace: 'Workspace',
  'second-brain': 'Druhý mozek',
  '': 'Kořen',
};

export function groupOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.indexOf('/')) : '';
}

/** Which notes are within `depth` hops of `focus`. */
function neighbourhood(graph: Graph, focus: string, depth: number): Set<string> {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };
  for (const e of graph.edges) {
    add(e.from, e.to);
    add(e.to, e.from);
  }
  const seen = new Set<string>([focus]);
  let frontier = [focus];
  for (let d = 0; d < depth; d += 1) {
    const next: string[] = [];
    for (const p of frontier) {
      for (const q of adj.get(p) || []) {
        if (!seen.has(q)) {
          seen.add(q);
          next.push(q);
        }
      }
    }
    frontier = next;
  }
  return seen;
}

export default function FileGraph({
  graph,
  focus,
  mode,
  depth = 1,
  onSelect,
}: {
  graph: Graph;
  focus: string | null;
  mode: 'local' | 'all';
  depth?: number;
  onSelect: (path: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<{
    nodes: SimNode[];
    edges: Array<[number, number]>;
    byPath: Map<string, number>;
    alpha: number;
    scale: number;
    tx: number;
    ty: number;
    hover: number;
    drag: { node: number; moved: boolean } | { pan: true; x: number; y: number; moved: boolean } | null;
    raf: number;
    /** Fit the view to the graph until the person moves it themselves. */
    autoFit: boolean;
    size: { w: number; h: number };
  }>({ nodes: [], edges: [], byPath: new Map(), alpha: 1, scale: 1, tx: 0, ty: 0, hover: -1, drag: null, raf: 0, autoFit: true, size: { w: 0, h: 0 } });

  const focusRef = useRef(focus);
  focusRef.current = focus;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // The visible subgraph: everything, or the neighbourhood of the focus.
  const sub = useMemo(() => {
    if (mode === 'all' || !focus) return graph;
    const keep = neighbourhood(graph, focus, depth);
    return {
      nodes: graph.nodes.filter((n) => keep.has(n.path)),
      edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
    };
  }, [graph, focus, mode, depth]);

  // (Re)build the simulation when the subgraph changes; keep positions of
  // nodes that survive so the picture does not jump.
  useEffect(() => {
    const st = stateRef.current;
    const prev = new Map(st.nodes.map((n) => [n.path, n]));
    const deg = new Map<string, number>();
    for (const e of sub.edges) deg.set(e.to, (deg.get(e.to) || 0) + 1);
    const n = sub.nodes.length;
    const spread = Math.sqrt(n) * 26;
    const nodes: SimNode[] = sub.nodes.map((g, i) => {
      const old = prev.get(g.path);
      const d = deg.get(g.path) || 0;
      const a = (i / Math.max(1, n)) * Math.PI * 2;
      return {
        path: g.path,
        x: old ? old.x : Math.cos(a) * spread * (0.4 + Math.random() * 0.6),
        y: old ? old.y : Math.sin(a) * spread * (0.4 + Math.random() * 0.6),
        vx: 0,
        vy: 0,
        r: 3 + Math.sqrt(d) * 1.6,
        group: groupOf(g.path),
        deg: d,
        pinned: false,
      };
    });
    const byPath = new Map(nodes.map((x, i) => [x.path, i]));
    const edges: Array<[number, number]> = [];
    for (const e of sub.edges) {
      const a = byPath.get(e.from);
      const b = byPath.get(e.to);
      if (a != null && b != null) edges.push([a, b]);
    }
    st.nodes = nodes;
    st.edges = edges;
    st.byPath = byPath;
    st.alpha = 1;
    st.hover = -1;
    st.autoFit = true;
    const f = focusRef.current ? byPath.get(focusRef.current) : undefined;
    if (f != null) {
      nodes[f].x = 0;
      nodes[f].y = 0;
      nodes[f].pinned = true;
    }
  }, [sub]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const st = stateRef.current;
    let w = 0;
    let h = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      w = rect.width;
      h = rect.height;
      st.size = { w, h };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const css = () => getComputedStyle(canvas);
    const token = (name: string) => css().getPropertyValue(name).trim();

    /** Scale and pan so every node is inside the frame with a margin. */
    const fitView = () => {
      const { nodes } = st;
      if (!nodes.length || !w || !h) return;
      let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
      for (const nd of nodes) {
        if (nd.x < minX) minX = nd.x;
        if (nd.x > maxX) maxX = nd.x;
        if (nd.y < minY) minY = nd.y;
        if (nd.y > maxY) maxY = nd.y;
      }
      const gw = Math.max(1, maxX - minX);
      const gh = Math.max(1, maxY - minY);
      const scale = Math.min(3, Math.max(0.15, Math.min((w - 48) / gw, (h - 48) / gh)));
      st.scale = scale;
      st.tx = -((minX + maxX) / 2) * scale;
      st.ty = -((minY + maxY) / 2) * scale;
    };

    const step = () => {
      const { nodes, edges } = st;
      if (st.alpha > 0.002) {
        const k = st.alpha;
        // Repulsion between every pair, with a floor on the distance so two
        // notes on top of each other push apart instead of launching into
        // orbit. The graph is a few hundred notes, so every pair is fine.
        for (let i = 0; i < nodes.length; i += 1) {
          const a = nodes[i];
          for (let j = i + 1; j < nodes.length; j += 1) {
            const b = nodes[j];
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 1) { dx = (Math.random() - 0.5) * 2; dy = (Math.random() - 0.5) * 2; d2 = dx * dx + dy * dy; }
            const f = (1400 * k) / Math.max(d2, 400);
            const fx = dx * f;
            const fy = dy * f;
            a.vx += fx; a.vy += fy;
            b.vx -= fx; b.vy -= fy;
          }
        }
        // Springs along links.
        for (const [i, j] of edges) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const want = 40 + a.r + b.r;
          const f = ((d - want) / d) * 0.05 * k;
          a.vx += dx * f; a.vy += dy * f;
          b.vx -= dx * f; b.vy -= dy * f;
        }
        // Gravity to the middle, damping, a speed limit, integrate.
        const maxV = 4 + 20 * k;
        for (const nd of nodes) {
          if (nd.pinned) { nd.vx = 0; nd.vy = 0; continue; }
          nd.vx -= nd.x * 0.02 * k;
          nd.vy -= nd.y * 0.02 * k;
          nd.vx *= 0.6;
          nd.vy *= 0.6;
          const sp = Math.sqrt(nd.vx * nd.vx + nd.vy * nd.vy);
          if (sp > maxV) { nd.vx = (nd.vx / sp) * maxV; nd.vy = (nd.vy / sp) * maxV; }
          nd.x += nd.vx;
          nd.y += nd.vy;
        }
        st.alpha *= 0.99;
        if (st.autoFit) fitView();
      }
      draw();
      st.raf = requestAnimationFrame(step);
    };

    const draw = () => {
      const { nodes, edges } = st;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(w / 2 + st.tx, h / 2 + st.ty);
      ctx.scale(st.scale, st.scale);

      const ink = token('--bb-ink');
      const ink3 = token('--bb-ink3');
      const line = token('--bb-line');
      const accent = token('--bb-accent');
      const focusIdx = focusRef.current ? st.byPath.get(focusRef.current) ?? -1 : -1;
      const lit = new Set<number>();
      const centre = st.hover >= 0 ? st.hover : focusIdx;
      if (centre >= 0) {
        lit.add(centre);
        for (const [i, j] of edges) {
          if (i === centre) lit.add(j);
          if (j === centre) lit.add(i);
        }
      }

      ctx.lineWidth = 1 / st.scale;
      for (const [i, j] of edges) {
        const a = nodes[i];
        const b = nodes[j];
        const hot = centre >= 0 && (i === centre || j === centre);
        ctx.strokeStyle = hot ? ink3 : line;
        ctx.globalAlpha = hot ? 0.9 : 1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      const showAllLabels = st.scale > 1.3 || nodes.length <= 40;
      // Hubs get a name at any zoom, so the big picture reads without hovering.
      let hubDeg = Infinity;
      if (!showAllLabels && nodes.length > 40) {
        const degs = nodes.map((n) => n.deg).sort((a, b) => b - a);
        hubDeg = Math.max(2, degs[Math.min(degs.length - 1, 14)] || 2);
      }
      for (let i = 0; i < nodes.length; i += 1) {
        const nd = nodes[i];
        const colour = token(GROUP_TOKEN[nd.group] || '--bb-ink3') || ink3;
        const dim = centre >= 0 && !lit.has(i);
        ctx.globalAlpha = dim ? 0.28 : 1;
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(nd.x, nd.y, nd.r, 0, Math.PI * 2);
        ctx.fill();
        if (i === focusIdx) {
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2 / st.scale;
          ctx.beginPath();
          ctx.arc(nd.x, nd.y, nd.r + 3 / st.scale, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (showAllLabels || lit.has(i) || nd.deg >= hubDeg) {
          ctx.font = `${Math.max(9, 11 / st.scale)}px ${token('--bb-font') || 'system-ui'}`;
          ctx.fillStyle = lit.has(i) || !dim ? ink : ink3;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(basename(nd.path).replace(/\.md$/, ''), nd.x, nd.y + nd.r + 3 / st.scale);
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    };

    const toWorld = (ev: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (ev.clientX - rect.left - w / 2 - st.tx) / st.scale,
        y: (ev.clientY - rect.top - h / 2 - st.ty) / st.scale,
      };
    };
    const hit = (ev: MouseEvent) => {
      const p = toWorld(ev);
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < st.nodes.length; i += 1) {
        const nd = st.nodes[i];
        const dx = nd.x - p.x;
        const dy = nd.y - p.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < Math.max(nd.r + 4 / st.scale, 7 / st.scale) && d < bestD) { best = i; bestD = d; }
      }
      return best;
    };

    const onDown = (ev: MouseEvent) => {
      st.autoFit = false;
      const i = hit(ev);
      if (i >= 0) {
        st.drag = { node: i, moved: false };
        st.nodes[i].pinned = true;
      } else {
        st.drag = { pan: true, x: ev.clientX, y: ev.clientY, moved: false };
      }
    };
    const onMove = (ev: MouseEvent) => {
      if (st.drag && 'node' in st.drag) {
        const p = toWorld(ev);
        const nd = st.nodes[st.drag.node];
        nd.x = p.x;
        nd.y = p.y;
        st.drag.moved = true;
        st.alpha = Math.max(st.alpha, 0.3);
        return;
      }
      if (st.drag && 'pan' in st.drag) {
        st.tx += ev.clientX - st.drag.x;
        st.ty += ev.clientY - st.drag.y;
        st.drag.x = ev.clientX;
        st.drag.y = ev.clientY;
        st.drag.moved = true;
        return;
      }
      const i = hit(ev);
      st.hover = i;
      canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
    };
    const onUp = (ev: MouseEvent) => {
      const d = st.drag;
      st.drag = null;
      if (!d) return;
      if ('node' in d) {
        const nd = st.nodes[d.node];
        if (!d.moved) onSelectRef.current(nd.path);
        // A node stays where it was dropped, unless it is the focus.
        if (nd.path !== focusRef.current) nd.pinned = d.moved;
      } else if (!d.moved) {
        const i = hit(ev);
        if (i >= 0) onSelectRef.current(st.nodes[i].path);
      }
    };
    const onLeave = () => { st.hover = -1; st.drag = null; };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      st.autoFit = false;
      // A trackpad scroll pans, like a map; pinch (which browsers report with
      // ctrlKey) or Ctrl + wheel zooms.
      if (!ev.ctrlKey && !ev.metaKey) {
        st.tx -= ev.deltaX;
        st.ty -= ev.deltaY;
        return;
      }
      const factor = Math.exp(-ev.deltaY * 0.01);
      const next = Math.min(4, Math.max(0.2, st.scale * factor));
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left - w / 2;
      const my = ev.clientY - rect.top - h / 2;
      // Zoom around the cursor.
      st.tx = mx - (mx - st.tx) * (next / st.scale);
      st.ty = my - (my - st.ty) * (next / st.scale);
      st.scale = next;
    };

    const onDouble = () => { st.autoFit = true; fitView(); };
    canvas.addEventListener('dblclick', onDouble);
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    st.raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(st.raf);
      ro.disconnect();
      canvas.removeEventListener('dblclick', onDouble);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <div className="bb-fx__gwrap">
      <canvas ref={canvasRef} className="bb-fx__canvas" aria-label="Graf odkazů mezi soubory" />
      <p className="bb-fx__hint">Posun prstem nebo tažením, zoom pinch nebo Ctrl + kolečko, dvojklik srovná</p>
    </div>
  );
}
