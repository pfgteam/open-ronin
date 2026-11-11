// Moved to the shared ../ChildrenPanel.tsx so it can self-fetch and be used
// both here and inside WorkItemDrawer.tsx. Re-exported here only in case
// anything still points at this path; prefer importing from '../ChildrenPanel'.
export { default } from '../ChildrenPanel';
