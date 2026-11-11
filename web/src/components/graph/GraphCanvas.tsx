'use client';

// GraphCanvas - reusable tree + free-form (vector-board) renderer used by
// org chart, project mind maps, and process maps.
//
// Two layouts:
//   - 'tree'   - hierarchical auto-layout from parent_id chain (Lucidchart-like)
//   - 'manual' - free-form vector board; each node has explicit x/y; drag to
//                move; click empty canvas to add (when onCreateNode is provided)
//
// Inputs: array of nodes (parent_id + optional x/y) and optional edges for
// non-tree relations. Edges support solid/dashed/dotted and a curvature.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	ZoomIn,
	ZoomOut,
	Maximize2,
	Plus,
	GitBranch,
	Move,
	Trash2,
	Link as LinkIcon,
} from 'lucide-react';
import { FALLBACK_COLOR } from '@/lib/colors';

export interface GraphNode {
	id: string;
	parentId: string | null;
	label: string;
	subtitle?: string | null;
	color?: string | null;
	icon?: string | null;
	shape?: 'rect' | 'rounded' | 'circle' | 'diamond' | 'pill';
	avatarUrl?: string | null;
	href?: string;
	x?: number | null;
	y?: number | null;
	width?: number | null;
	height?: number | null;
	collapsed?: boolean;
	meta?: Record<string, unknown>;
}

export interface GraphEdge {
	source: string;
	target: string;
	type?: string;
	label?: string;
	style?: 'solid' | 'dashed' | 'dotted';
}

export type GraphLayout = 'tree' | 'manual';

interface Props {
	nodes: GraphNode[];
	edges?: GraphEdge[];
	layout?: GraphLayout;
	onSelectNode?: (id: string) => void;
	onAddChild?: (parentId: string) => void;
	onCreateNode?: (input: { x: number; y: number; label: string }) => void | Promise<void>;
	onMoveNode?: (id: string, x: number, y: number) => void | Promise<void>;
	onConnectNodes?: (sourceId: string, targetId: string) => void | Promise<void>;
	onDeleteNode?: (id: string) => void | Promise<void>;
	height?: number | string;
	readOnly?: boolean;
	showMinimap?: boolean;
}

const NODE_W = 200;
const NODE_H = 64;
const H_GAP = 28;
const V_GAP = 56;

interface LayoutNode {
	node: GraphNode;
	x: number;
	y: number;
	w: number;
	h: number;
	depth: number;
}

export default function GraphCanvas({
	nodes,
	edges = [],
	layout = 'tree',
	onSelectNode,
	onAddChild,
	onCreateNode,
	onMoveNode,
	onConnectNodes,
	onDeleteNode,
	height = 700,
	readOnly = false,
	showMinimap = false,
}: Props) {
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 60, y: 40 });
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
	const containerRef = useRef<HTMLDivElement | null>(null);
	const draggingPanRef = useRef<{ x: number; y: number } | null>(null);
	const draggingNodeRef = useRef<{ id: string; ox: number; oy: number; startX: number; startY: number } | null>(null);
	const [draggedPositions, setDraggedPositions] = useState<Record<string, { x: number; y: number }>>({});
	const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
	const [createAt, setCreateAt] = useState<{ x: number; y: number } | null>(null);
	const [createLabel, setCreateLabel] = useState('');

	// Compute positions per layout
	const { positioned, bounds } = useMemo(() => {
		if (layout === 'manual') return layoutManual(nodes, draggedPositions);
		return layoutTree(nodes, collapsed);
	}, [layout, nodes, collapsed, draggedPositions]);

	useEffect(() => {
		if (containerRef.current && positioned.length > 0) {
			const w = containerRef.current.clientWidth;
			if (bounds.maxX > w) {
				setZoom((z) => Math.min(z, Math.max(0.3, (w - 80) / bounds.maxX)));
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [bounds.maxX]);

	// ---- Pan / zoom interactions ----
	const onCanvasMouseDown = useCallback((e: React.MouseEvent) => {
		const target = e.target as HTMLElement;
		if (target.closest('[data-node]')) return;
		if (createAt) return; // creating overlay is open
		// If we're in connect mode and click empty space, cancel connect
		if (connectingFromId) {
			setConnectingFromId(null);
			return;
		}
		draggingPanRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
	}, [pan, createAt, connectingFromId]);

	const onCanvasMouseMove = useCallback((e: React.MouseEvent) => {
		if (draggingPanRef.current) {
			setPan({ x: e.clientX - draggingPanRef.current.x, y: e.clientY - draggingPanRef.current.y });
		}
		if (draggingNodeRef.current && containerRef.current) {
			const dx = (e.clientX - draggingNodeRef.current.startX) / zoom;
			const dy = (e.clientY - draggingNodeRef.current.startY) / zoom;
			setDraggedPositions((prev) => ({
				...prev,
				[draggingNodeRef.current!.id]: {
					x: draggingNodeRef.current!.ox + dx,
					y: draggingNodeRef.current!.oy + dy,
				},
			}));
		}
	}, [zoom]);

	const onCanvasMouseUp = useCallback(() => {
		draggingPanRef.current = null;
		if (draggingNodeRef.current && onMoveNode) {
			const id = draggingNodeRef.current.id;
			const pos = draggedPositions[id];
			if (pos) onMoveNode(id, pos.x, pos.y);
		}
		draggingNodeRef.current = null;
	}, [draggedPositions, onMoveNode]);

	// Click in empty space (free-form mode) to start adding a node
	const onCanvasDoubleClick = useCallback((e: React.MouseEvent) => {
		if (layout !== 'manual' || !onCreateNode || readOnly) return;
		const target = e.target as HTMLElement;
		if (target.closest('[data-node]')) return;
		const rect = containerRef.current?.getBoundingClientRect();
		if (!rect) return;
		const x = (e.clientX - rect.left - pan.x) / zoom;
		const y = (e.clientY - rect.top - pan.y) / zoom;
		setCreateAt({ x, y });
		setCreateLabel('');
	}, [layout, onCreateNode, readOnly, pan, zoom]);

	const onWheel = useCallback((e: React.WheelEvent) => {
		if (!e.ctrlKey && !e.metaKey) return;
		e.preventDefault();
		const delta = -e.deltaY * 0.001;
		setZoom((z) => Math.min(2.5, Math.max(0.2, z + delta)));
	}, []);

	function toggleCollapsed(id: string) {
		setCollapsed((s) => {
			const n = new Set(s);
			if (n.has(id)) n.delete(id); else n.add(id);
			return n;
		});
	}

	function nodeById(id: string): LayoutNode | undefined {
		return positioned.find((p) => p.node.id === id);
	}

	const svgWidth = Math.max(bounds.maxX + 200, 1000);
	const svgHeight = Math.max(bounds.maxY + 200, 600);

	function submitCreate() {
		if (createAt && createLabel.trim() && onCreateNode) {
			void onCreateNode({ x: Math.round(createAt.x), y: Math.round(createAt.y), label: createLabel.trim() });
		}
		setCreateAt(null);
		setCreateLabel('');
	}

	return (
		<div
			className="relative bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden"
			style={{ height, ...(layout === 'manual' ? gridBackground(zoom) : undefined) }}
		>
			{/* Floating toolbar */}
			<div className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-white dark:bg-slate-800 rounded-md border border-slate-200 dark:border-slate-700 p-0.5">
				<button onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md text-slate-600 dark:text-slate-300 transition-colors" title="Zoom out">
					<ZoomOut className="w-3.5 h-3.5" />
				</button>
				<span className="text-2xs tabular-nums text-slate-600 dark:text-slate-400 px-1">{Math.round(zoom * 100)}%</span>
				<button onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md text-slate-600 dark:text-slate-300 transition-colors" title="Zoom in">
					<ZoomIn className="w-3.5 h-3.5" />
				</button>
				<div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
				<button onClick={() => { setZoom(1); setPan({ x: 60, y: 40 }); }} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md text-slate-600 dark:text-slate-300 transition-colors" title="Reset view">
					<Maximize2 className="w-3.5 h-3.5" />
				</button>
				{layout === 'manual' && onCreateNode && !readOnly && (
					<>
						<div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
						<button
							onClick={() => {
								const rect = containerRef.current?.getBoundingClientRect();
								const cx = rect ? (rect.width / 2 - pan.x) / zoom : 100;
								const cy = rect ? (rect.height / 2 - pan.y) / zoom : 100;
								setCreateAt({ x: cx, y: cy });
							}}
							className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md text-slate-600 dark:text-slate-300 transition-colors"
							title="Add node"
						>
							<Plus className="w-3.5 h-3.5" />
						</button>
					</>
				)}
			</div>

			{/* Mode hint */}
			<div className="absolute top-2 left-2 z-20 inline-flex items-center gap-1 text-2xs text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-800/70 backdrop-blur px-2 py-1 rounded-md">
				{layout === 'tree' ? <GitBranch className="w-3 h-3" /> : <Move className="w-3 h-3" />}
				{layout === 'tree' ? 'Tree layout' : 'Free-form'}
				{layout === 'manual' && onCreateNode && !readOnly && <span className="text-slate-400 ml-1">· double-click to add</span>}
				{connectingFromId && <span className="text-primary-600 ml-1">· click a node to connect</span>}
			</div>

			<div
				ref={containerRef}
				className={`w-full h-full overflow-hidden ${draggingPanRef.current ? 'cursor-grabbing' : 'cursor-grab'}`}
				onMouseDown={onCanvasMouseDown}
				onMouseMove={onCanvasMouseMove}
				onMouseUp={onCanvasMouseUp}
				onMouseLeave={onCanvasMouseUp}
				onDoubleClick={onCanvasDoubleClick}
				onWheel={onWheel}
			>
				<div
					style={{
						transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
						transformOrigin: '0 0',
						width: svgWidth,
						height: svgHeight,
						position: 'relative',
					}}
				>
					<svg width={svgWidth} height={svgHeight} className="absolute inset-0 pointer-events-none">
						{/* Parent->child connectors (tree) */}
						{positioned.flatMap((ln) => {
							if (!ln.node.parentId) return [];
							const parent = nodeById(ln.node.parentId);
							if (!parent) return [];
							const path = layout === 'tree'
								? orthogonalPath(parent.x + parent.w / 2, parent.y + parent.h, ln.x + ln.w / 2, ln.y)
								: curvedPath(parent.x + parent.w / 2, parent.y + parent.h / 2, ln.x + ln.w / 2, ln.y + ln.h / 2);
							return [<path
								key={`tree-${ln.node.id}`}
								d={path}
								style={{ stroke: FALLBACK_COLOR }}
								strokeWidth={1.5}
								fill="none"
							/>];
						})}
						{/* Extra edges (non-tree relations) */}
						{edges.map((e, i) => {
							const s = nodeById(e.source);
							const t = nodeById(e.target);
							if (!s || !t) return null;
							// Token colours (style guide decision 8): danger for dependencies and
							// blockers, primary for informs, muted for the rest.
							const stroke = e.type === 'depends_on' || e.type === 'blocks' ? 'var(--c-danger)' :
								e.type === 'informs' ? 'var(--c-primary-600)' :
								'var(--tx3)';
							const dash = e.style === 'dashed' ? '5,3' : e.style === 'dotted' ? '2,3' : undefined;
							const d = curvedPath(s.x + s.w / 2, s.y + s.h / 2, t.x + t.w / 2, t.y + t.h / 2);
							return (
								<g key={`e-${i}`}>
									<path d={d} style={{ stroke }} strokeWidth={1.5} strokeDasharray={dash} fill="none" markerEnd="url(#arrow)" />
									{e.label && (
										<text x={(s.x + t.x) / 2 + s.w / 2} y={(s.y + t.y) / 2 + 30} textAnchor="middle" fontSize="10" style={{ fill: 'var(--tx2)' }}>{e.label}</text>
									)}
								</g>
							);
						})}
						<defs>
							<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
								<path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: 'var(--tx2)' }} />
							</marker>
						</defs>
					</svg>

					{positioned.map((ln) => {
						const childCount = nodes.filter((n) => n.parentId === ln.node.id).length;
						const isCollapsed = collapsed.has(ln.node.id);
						const isConnectSource = connectingFromId === ln.node.id;
						return (
							<div
								key={ln.node.id}
								data-node={ln.node.id}
								className="absolute"
								style={{ left: ln.x, top: ln.y, width: ln.w, height: ln.h }}
								onMouseDown={(e) => {
									if (layout !== 'manual' || readOnly || !onMoveNode) return;
									e.stopPropagation();
									draggingNodeRef.current = { id: ln.node.id, ox: ln.x, oy: ln.y, startX: e.clientX, startY: e.clientY };
								}}
							>
								<NodeCard
									node={ln.node}
									childCount={childCount}
									isCollapsed={isCollapsed}
									isConnectSource={isConnectSource}
									layout={layout}
									readOnly={readOnly}
									onToggle={() => toggleCollapsed(ln.node.id)}
									onSelect={() => {
										if (connectingFromId && connectingFromId !== ln.node.id && onConnectNodes) {
											void onConnectNodes(connectingFromId, ln.node.id);
											setConnectingFromId(null);
											return;
										}
										onSelectNode?.(ln.node.id);
									}}
									onAddChild={onAddChild ? () => onAddChild(ln.node.id) : undefined}
									onStartConnect={onConnectNodes ? () => setConnectingFromId(ln.node.id) : undefined}
									onDelete={onDeleteNode ? () => onDeleteNode(ln.node.id) : undefined}
								/>
							</div>
						);
					})}

					{/* Create-node overlay (free-form mode) */}
					{createAt && (
						<div
							className="absolute z-30"
							style={{ left: createAt.x, top: createAt.y, width: NODE_W, height: NODE_H }}
						>
							<div className="w-full h-full bg-white dark:bg-slate-800 border-2 border-primary-400 dark:border-primary-600 rounded-md shadow-panel p-2 flex items-center">
								<input
									autoFocus
									value={createLabel}
									onChange={(e) => setCreateLabel(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') { e.preventDefault(); submitCreate(); }
										else if (e.key === 'Escape') { e.preventDefault(); setCreateAt(null); }
									}}
									placeholder="Title... (Enter to add)"
									className="w-full text-sm bg-transparent border-0 focus:outline-none placeholder:text-slate-400"
								/>
							</div>
						</div>
					)}
				</div>
			</div>

			{showMinimap && positioned.length > 0 && (
				<Minimap nodes={positioned} bounds={bounds} pan={pan} zoom={zoom} />
			)}

			<div className="absolute bottom-2 left-2 z-10 text-2xs text-slate-600 dark:text-slate-400 bg-white/70 dark:bg-slate-800/70 backdrop-blur px-2 py-0.5 rounded-md">
				⌘+scroll = zoom · drag empty space = pan
			</div>
		</div>
	);
}

function NodeCard({
	node, childCount, isCollapsed, isConnectSource, layout, readOnly,
	onToggle, onSelect, onAddChild, onStartConnect, onDelete,
}: {
	node: GraphNode;
	childCount: number;
	isCollapsed: boolean;
	isConnectSource: boolean;
	layout: GraphLayout;
	readOnly: boolean;
	onToggle: () => void;
	onSelect: () => void;
	onAddChild?: () => void;
	onStartConnect?: () => void;
	onDelete?: () => void;
}) {
	const isCircle = node.shape === 'circle';
	const isDiamond = node.shape === 'diamond';
	return (
		<div
			onClick={onSelect}
			className={`group w-full h-full flex items-center gap-2 px-2.5 py-1.5 bg-white dark:bg-slate-800 border hover:border-primary-400 dark:hover:border-primary-700 cursor-pointer transition-shadow ${
				isCircle ? 'rounded-full' : isDiamond ? 'rotate-45' : 'rounded-md'
			} ${
				isConnectSource ? 'border-primary-500 ring-2 ring-primary-300/40' : 'border-slate-200 dark:border-slate-700'
			} ${layout === 'manual' ? 'cursor-grab active:cursor-grabbing' : ''}`}
			style={node.color && !isConnectSource ? { borderColor: node.color, boxShadow: `0 0 0 2px ${node.color}10` } : undefined}
		>
			{node.avatarUrl ? (
				// eslint-disable-next-line @next/next/no-img-element
				<img src={node.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
			) : (
				<div
					className="w-8 h-8 rounded-full text-white flex items-center justify-center text-xs font-semibold shrink-0"
					style={{ background: node.color ?? 'var(--c-primary-600)' }}
				>
					{node.label.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
				</div>
			)}
			<div className="flex-1 min-w-0">
				<div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">{node.label}</div>
				{node.subtitle && <div className="text-2xs text-slate-500 dark:text-slate-400 truncate">{node.subtitle}</div>}
			</div>
			{childCount > 0 && (
				<button
					onClick={(e) => { e.stopPropagation(); onToggle(); }}
					className="text-2xs text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 shrink-0 transition-colors"
					title={isCollapsed ? 'Expand' : 'Collapse'}
				>
					{isCollapsed ? `+${childCount}` : '−'}
				</button>
			)}
			{!readOnly && (
				<div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
					{onAddChild && (
						<button onClick={(e) => { e.stopPropagation(); onAddChild(); }} className="text-slate-400 hover:text-primary-500 transition-colors" title="Add child"><Plus className="w-3 h-3" /></button>
					)}
					{onStartConnect && (
						<button onClick={(e) => { e.stopPropagation(); onStartConnect(); }} className="text-slate-400 hover:text-primary-500 transition-colors" title="Connect to..."><LinkIcon className="w-3 h-3" /></button>
					)}
					{onDelete && (
						<button onClick={(e) => { e.stopPropagation(); if (confirm('Delete this node?')) onDelete(); }} className="text-slate-400 hover:text-red-500 transition-colors" title="Delete"><Trash2 className="w-3 h-3" /></button>
					)}
				</div>
			)}
		</div>
	);
}

function Minimap({ nodes, bounds, pan, zoom }: { nodes: LayoutNode[]; bounds: { maxX: number; maxY: number }; pan: { x: number; y: number }; zoom: number }) {
	const W = 160, H = 100;
	const scale = Math.min(W / Math.max(bounds.maxX, 1), H / Math.max(bounds.maxY, 1));
	void pan; void zoom;
	return (
		<div className="absolute bottom-2 right-2 z-10 w-40 h-24 bg-white/80 dark:bg-slate-800/80 backdrop-blur border border-slate-200 dark:border-slate-700 rounded-md p-1 overflow-hidden">
			<svg width={W} height={H} className="block">
				{nodes.map((n) => (
					<rect key={n.node.id} x={n.x * scale} y={n.y * scale} width={n.w * scale} height={n.h * scale} fill={FALLBACK_COLOR} opacity={0.6} rx={1} />
				))}
			</svg>
		</div>
	);
}

function orthogonalPath(x1: number, y1: number, x2: number, y2: number): string {
	const midY = y1 + (y2 - y1) / 2;
	return `M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`;
}

function curvedPath(x1: number, y1: number, x2: number, y2: number): string {
	const dx = (x2 - x1) * 0.5;
	return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// Dot grid for the manual layout. Both halves matter: the gradient draws one
// dot, background-size makes it repeat — without it the "grid" was a single
// invisible dot stretched across the canvas.
function gridBackground(zoom: number): React.CSSProperties {
	const size = 20 * zoom;
	return {
		backgroundImage: 'radial-gradient(circle, var(--line2) 1px, transparent 1px)',
		backgroundSize: `${size}px ${size}px`,
	};
}

function layoutTree(nodes: GraphNode[], collapsed: Set<string>): { positioned: LayoutNode[]; bounds: { maxX: number; maxY: number } } {
	// A node whose parentId points OUTSIDE the node set (e.g. reports of a
	// deactivated manager) is treated as a root — before this, whole subtrees
	// silently vanished from the chart (18/08 QA audit).
	const idSet = new Set(nodes.map((n) => n.id));
	const childrenOf = new Map<string, GraphNode[]>();
	for (const n of nodes) {
		const parentKey = n.parentId && idSet.has(n.parentId) ? n.parentId : '__roots__';
		if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, []);
		childrenOf.get(parentKey)!.push(n);
	}
	const roots = childrenOf.get('__roots__') ?? [];
	const positioned: LayoutNode[] = [];
	const placed = new Set<string>(); // cycle guard (A→B→A would recurse forever)
	let cursorX = 0;

	function place(node: GraphNode, depth: number): number {
		if (placed.has(node.id)) return cursorX;
		placed.add(node.id);
		const kids = collapsed.has(node.id) ? [] : (childrenOf.get(node.id) ?? []);
		const startX = cursorX;
		const w = node.width ?? NODE_W;
		const h = node.height ?? NODE_H;
		if (kids.length === 0) {
			const x = cursorX;
			cursorX += w + H_GAP;
			positioned.push({ node, x, y: depth * (NODE_H + V_GAP), w, h, depth });
			return x;
		}
		let firstChildX = -1;
		let lastChildX = -1;
		for (const k of kids) {
			const cx = place(k, depth + 1);
			if (firstChildX < 0) firstChildX = cx;
			lastChildX = cx;
		}
		const myX = (firstChildX + lastChildX) / 2;
		const finalX = Math.max(myX, startX);
		positioned.push({ node, x: finalX, y: depth * (NODE_H + V_GAP), w, h, depth });
		return finalX;
	}

	for (const r of roots) { place(r, 0); cursorX += 40; }
	// Anything still unplaced sits in a reporting cycle — surface it as a root
	// rather than hiding the people involved.
	for (const n of nodes) {
		if (!placed.has(n.id)) { place(n, 0); cursorX += 40; }
	}
	const maxX = positioned.reduce((acc, p) => Math.max(acc, p.x + p.w), 0);
	const maxY = positioned.reduce((acc, p) => Math.max(acc, p.y + p.h), 0);
	return { positioned, bounds: { maxX, maxY } };
}

function layoutManual(nodes: GraphNode[], dragged: Record<string, { x: number; y: number }>): { positioned: LayoutNode[]; bounds: { maxX: number; maxY: number } } {
	const positioned: LayoutNode[] = [];
	let fallbackX = 0;
	for (const n of nodes) {
		const drag = dragged[n.id];
		let x = drag?.x ?? n.x ?? null;
		let y = drag?.y ?? n.y ?? null;
		if (x == null || y == null) {
			// Spread orphans along the top so they're visible until placed
			x = fallbackX;
			y = 0;
			fallbackX += (n.width ?? NODE_W) + H_GAP;
		}
		positioned.push({ node: n, x, y, w: n.width ?? NODE_W, h: n.height ?? NODE_H, depth: 0 });
	}
	const maxX = positioned.reduce((acc, p) => Math.max(acc, p.x + p.w), 0);
	const maxY = positioned.reduce((acc, p) => Math.max(acc, p.y + p.h), 0);
	return { positioned, bounds: { maxX, maxY } };
}
