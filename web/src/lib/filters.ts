// filters.ts — the small set of "views" the sidebar offers over the task list.
// Kept separate (and built on top of staleness.ts) so adding a view is a
// one-line change here rather than spread across components.

import type { Task } from "./api";
import { isSnoozed, taskStaleness } from "./staleness";

export type Filter =
  | "all"
  | "due-soon"
  | "overdue"
  | "none"
  | "snoozed"
  | "archived"
  | "shared"
  | "requests";

export const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部任务" },
  { key: "due-soon", label: "即将到期" },
  { key: "overdue", label: "已逾期" },
  { key: "none", label: "从未做过" },
  { key: "snoozed", label: "已延后" },
  { key: "archived", label: "已归档" },
];

/** Extra views shown only when task sharing is enabled. "shared" groups tasks
 *  with collaborators; "requests" is not a task filter — the app renders its own
 *  list of incoming invites — so callers gate it specially. */
export const SHARE_FILTERS: { key: Filter; label: string }[] = [
  { key: "shared", label: "共享" },
  { key: "requests", label: "分享请求" },
];

/**
 * Whether a task belongs in the given view at the given moment. Archived tasks
 * only appear in the "Archived" view; every other view is active-tasks-only.
 * "requests" never matches a task here (the app renders incoming invites for it).
 */
export function matchesFilter(task: Task, filter: Filter, now?: number): boolean {
  if (filter === "requests") return false;
  if (filter === "archived") return task.archivedAt != null;
  if (task.archivedAt != null) return false;
  if (filter === "all") return true;
  if (filter === "shared") return task.shared;
  if (filter === "snoozed") return isSnoozed(task, now);
  return taskStaleness(task, now) === filter;
}
