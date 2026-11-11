// Plain data module (no 'use server'/'use client' directive) so this can be
// imported both from server actions (actions.ts) and client components
// (ChildrenPanel.tsx) without pulling server-only code into the client
// bundle, and without breaking the "'use server' files may only export
// async functions" rule for actions.ts.
//
// Strict hierarchy (Work Revamp spec D4/D5, 2026-10-02): one level at a time.
//   Goal → Priority → Project → Task          (tasks have no children)
//   Strategy → 12 Week Plan → Campaign → Assignment
// Priority → Priority, Priority → Task and Project → Project are gone. The DB
// enforces the same table (enforce_work_item_parent(), migration 0141) and
// hierarchy.test.ts keeps the two in sync. Any kind not listed as a child
// (recurring, process, target, event, …) can't have a parent at all.
export const CHILD_KINDS_FOR_PARENT: Record<string, string[]> = {
	goal: ['priority'],
	priority: ['project'],
	project: ['task'],
	strategy: ['twelve_week_plan'],
	twelve_week_plan: ['campaign'],
	campaign: ['assignment'],
};

/** The one kind a given kind may hang under (undefined = must be a root). */
export const PARENT_KIND_FOR: Record<string, string> = Object.fromEntries(
	Object.entries(CHILD_KINDS_FOR_PARENT).flatMap(([parent, children]) => children.map((c) => [c, parent])),
);

export function isValidParent(childKind: string, parentKind: string | null | undefined): boolean {
	if (!parentKind) return true;
	return PARENT_KIND_FOR[childKind] === parentKind;
}

// Linear-style Overview page (health updates + children-as-milestones +
// progress rollup). Per Sam 2026-07-14: goals/priorities/projects share
// the same structure, and the "milestones" section is simply the natural
// child kind — a goal's milestones are its priorities, a priority's are its
// projects, a project's are its tasks (client mirror: campaign → assignments).
// No separate milestone/stage kind.
export const OVERVIEW_CHILD_KIND: Record<string, { kind: string; singular: string; plural: string }> = {
	goal:     { kind: 'priority',   singular: 'Priority',   plural: 'Priorities' },
	priority: { kind: 'project',    singular: 'Project',    plural: 'Projects' },
	project:  { kind: 'task',       singular: 'Task',       plural: 'Tasks' },
	campaign: { kind: 'assignment', singular: 'Assignment', plural: 'Assignments' },
};
