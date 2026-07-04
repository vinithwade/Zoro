"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";
import { ExternalLink } from "lucide-react";

export type GraphNode = {
  id: string;
  type: "repo" | "person" | "pull_request" | "issue" | "conversation" | "channel";
  label: string;
  sublabel?: string;
  url?: string | null;
  weight: number;
};
type GraphLink = { source: string; target: string; kind: string };

type SimNode = GraphNode & SimulationNodeDatum;
type SimLink = { source: SimNode; target: SimNode; kind: string };

const COLORS: Record<GraphNode["type"], string> = {
  repo: "#5e6ad2",
  person: "#4cb782",
  pull_request: "#4ea7fc",
  issue: "#f2c94c",
  conversation: "#c084fc",
  channel: "#22d3ee",
};

const TYPE_LABEL: Record<GraphNode["type"], string> = {
  repo: "Repository",
  person: "Person",
  pull_request: "Pull request",
  issue: "Issue",
  conversation: "Conversation",
  channel: "Slack channel",
};

function radius(n: GraphNode): number {
  return Math.min(15, 5 + n.weight * 1.4);
}

export function MemoryGraph({
  nodes: rawNodes,
  links: rawLinks,
}: {
  nodes: GraphNode[];
  links: GraphLink[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const dragRef = useRef<string | null>(null);
  const panRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [, force] = useState(0);
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [transform, setTransform] = useState({ x: 450, y: 300, k: 1 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);

  // Measure the container.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Build the simulation whenever the data changes.
  useEffect(() => {
    const nodes: SimNode[] = rawNodes.map((n) => ({ ...n }));
    const links = rawLinks.map((l) => ({ ...l })) as unknown as SimLink[];
    nodesRef.current = nodes;
    linksRef.current = links;

    const sim = forceSimulation<SimNode>(nodes)
      .force("charge", forceManyBody().strength(-190))
      .force(
        "link",
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(72)
          .strength(0.35),
      )
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<SimNode>().radius((d) => radius(d) + 8))
      .force("x", forceX(0).strength(0.045))
      .force("y", forceY(0).strength(0.045));
    sim.on("tick", () => force((v) => v + 1));
    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [rawNodes, rawLinks]);

  // Center the view once we know the size.
  useEffect(() => {
    setTransform((t) => ({ ...t, x: size.w / 2, y: size.h / 2 }));
  }, [size.w, size.h]);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const l of rawLinks) {
      if (!map.has(l.source)) map.set(l.source, new Set());
      if (!map.has(l.target)) map.set(l.target, new Set());
      map.get(l.source)!.add(l.target);
      map.get(l.target)!.add(l.source);
    }
    return map;
  }, [rawLinks]);

  const active = hovered ?? selected?.id ?? null;
  const isDimmed = (id: string) =>
    active !== null && id !== active && !(neighbors.get(active)?.has(id) ?? false);

  function toGraph(clientX: number, clientY: number) {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - transform.x) / transform.k,
      y: (clientY - rect.top - transform.y) / transform.k,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (dragRef.current) {
      const node = nodesRef.current.find((n) => n.id === dragRef.current);
      if (node) {
        const g = toGraph(e.clientX, e.clientY);
        node.fx = g.x;
        node.fy = g.y;
      }
    } else if (panRef.current) {
      setTransform((t) => ({
        ...t,
        x: panRef.current!.tx + (e.clientX - panRef.current!.x),
        y: panRef.current!.ty + (e.clientY - panRef.current!.y),
      }));
    }
  }

  function endInteraction() {
    if (dragRef.current) {
      const node = nodesRef.current.find((n) => n.id === dragRef.current);
      if (node) {
        node.fx = null;
        node.fy = null;
      }
      simRef.current?.alphaTarget(0);
      dragRef.current = null;
    }
    panRef.current = null;
  }

  function onWheel(e: React.WheelEvent) {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const newK = Math.min(3, Math.max(0.3, transform.k * (1 - e.deltaY * 0.0015)));
    const gx = (sx - transform.x) / transform.k;
    const gy = (sy - transform.y) / transform.k;
    setTransform({ x: sx - gx * newK, y: sy - gy * newK, k: newK });
  }

  const nodes = nodesRef.current;
  const links = linksRef.current;

  return (
    <div className="relative h-full w-full overflow-hidden" ref={containerRef}>
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        className="touch-none select-none"
        onWheel={onWheel}
        onPointerDown={(e) => {
          panRef.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
          setSelected(null);
        }}
        onPointerMove={onPointerMove}
        onPointerUp={endInteraction}
        onPointerLeave={endInteraction}
      >
        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {links.map((l, i) => {
            const s = l.source;
            const t = l.target;
            if (typeof s !== "object" || typeof t !== "object") return null;
            const dim = isDimmed(s.id) || isDimmed(t.id);
            const highlight = active && (s.id === active || t.id === active);
            const isSimilar = l.kind === "similar";
            return (
              <line
                key={i}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={
                  isSimilar
                    ? "rgba(94,106,210,0.5)"
                    : l.kind === "references"
                      ? "rgba(192,132,252,0.35)"
                      : "rgba(255,255,255,0.09)"
                }
                strokeWidth={highlight ? 1.4 : isSimilar ? 1 : 0.8}
                strokeDasharray={isSimilar ? "3 3" : undefined}
                opacity={dim ? 0.15 : 1}
              />
            );
          })}
          {nodes.map((n) => {
            const r = radius(n);
            const dim = isDimmed(n.id);
            const showLabel =
              n.type === "repo" ||
              n.type === "conversation" ||
              n.id === active ||
              (active !== null && (neighbors.get(active)?.has(n.id) ?? false));
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                opacity={dim ? 0.25 : 1}
                style={{ cursor: "pointer" }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  dragRef.current = n.id;
                  simRef.current?.alphaTarget(0.3).restart();
                  n.fx = n.x;
                  n.fy = n.y;
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  if (dragRef.current === n.id) setSelected(n);
                  endInteraction();
                }}
                onPointerEnter={() => setHovered(n.id)}
                onPointerLeave={() => setHovered((h) => (h === n.id ? null : h))}
              >
                <circle
                  r={r}
                  fill={COLORS[n.type]}
                  fillOpacity={0.9}
                  stroke={n.id === active ? "#f7f8f8" : "rgba(0,0,0,0.4)"}
                  strokeWidth={n.id === active ? 1.5 : 1}
                />
                {showLabel ? (
                  <text
                    x={0}
                    y={r + 11}
                    textAnchor="middle"
                    fontSize={10}
                    fill="rgba(247,248,248,0.75)"
                    style={{ pointerEvents: "none" }}
                  >
                    {n.label.length > 22 ? n.label.slice(0, 21) + "…" : n.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend */}
      <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1.5 rounded-md border border-border bg-surface/80 px-3 py-2 text-[11px] backdrop-blur">
        {(Object.keys(COLORS) as GraphNode["type"][]).map((t) => (
          <div key={t} className="flex items-center gap-2 text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: COLORS[t] }} />
            {TYPE_LABEL[t]}
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <svg width="20" height="4">
            <line x1="0" y1="2" x2="20" y2="2" stroke="rgba(94,106,210,0.7)" strokeWidth="1" strokeDasharray="3 3" />
          </svg>
          semantically related (vector similarity)
        </span>
        <span>Drag nodes · scroll to zoom · drag background to pan</span>
      </div>

      {/* Detail panel */}
      {selected ? (
        <div className="absolute right-3 top-3 w-64 rounded-lg border border-border bg-surface p-3 shadow-[0_16px_70px_rgba(0,0,0,0.5)]">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: COLORS[selected.type] }}
            />
            <span className="text-[11px] uppercase tracking-wide text-faint">
              {TYPE_LABEL[selected.type]}
            </span>
          </div>
          <p className="mt-1.5 break-words font-mono text-[13px] text-foreground">
            {selected.label}
          </p>
          {selected.sublabel ? (
            <p className="mt-1 text-xs text-muted">{selected.sublabel}</p>
          ) : null}
          <p className="mt-2 text-xs text-faint">
            {neighbors.get(selected.id)?.size ?? 0} connection
            {(neighbors.get(selected.id)?.size ?? 0) === 1 ? "" : "s"}
          </p>
          {selected.url ? (
            <a
              href={selected.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              Open on GitHub <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
