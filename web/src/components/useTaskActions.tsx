import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  BellOff,
  Clock,
  BookmarkPlus,
  Copy,
  Moon,
  Pin,
  PinOff,
  Settings2,
  SkipForward,
  Trash2,
  Zap,
} from "lucide-react";

import { api, type Task } from "@/lib/api";
import { isSnoozed, nextDue } from "@/lib/staleness";
import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { usePrefs } from "@/lib/prefs";
import { saveTemplate, templateFromTask } from "@/lib/templates";
import { type ContextMenuEntry } from "@/components/ui/ContextMenu";
import { useTaskWindows } from "@/components/useTaskWindows";

/**
 * useTaskActions — the task verbs that aren't editing a field.
 *
 * The right-click menu and the Manage window offer overlapping sets of these,
 * and they have to behave identically wherever they're invoked (same
 * invalidations, same confirmations, same wording). Keeping them in one hook is
 * what makes that true by construction rather than by discipline.
 */

/** The snooze durations the menu offers, plus how to describe them. */
export const SNOOZE_PRESETS: { label: string; hours: number }[] = [
  { label: "1 小时", hours: 1 },
  { label: "明天", hours: 24 },
  { label: "3 天", hours: 72 },
  { label: "1 周", hours: 168 },
];

export function useTaskActions() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm, prompt } = useConfirm();
  const { prefs, setPrefs } = usePrefs();

  // Every one of these can change what the list shows and what the calendar and
  // activity chart contain, so they all refresh the same set.
  const refresh = (taskId?: number) => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["activity"] });
    if (taskId != null) queryClient.invalidateQueries({ queryKey: ["completions", taskId] });
  };

  const fail = (e: unknown) => toast((e as Error).message, { tone: "error" });

  /**
   * Undo, for a completion that was just created.
   *
   * Quick log is one tap on a dense grid and the wrong tap is easy; putting it
   * right otherwise means Manage → History → delete, which nobody does for a
   * stray log. Deleting the completion we just made restores exactly the state
   * before it, which is why this is the whole of "undo" — there is nothing else
   * a log changes.
   */
  const undoCompletion = (completionId: number, taskId: number) => ({
    label: "撤销",
    onSelect: () => {
      api
        .deleteCompletion(completionId)
        .then(() => {
          refresh(taskId);
          toast("已撤销打卡");
        })
        .catch(fail);
    },
  });

  const quickLog = useMutation({
    mutationFn: (task: Task) => api.quickComplete(task.id),
    onSuccess: (completion, task) => {
      refresh(task.id);
      toast("已打卡", { tone: "success", action: undoCompletion(completion.id, task.id) });
    },
    onError: fail,
  });

  const snooze = useMutation({
    mutationFn: ({ task, hours }: { task: Task; hours: number }) =>
      api.snoozeTask(task.id, new Date(Date.now() + hours * 3_600_000).toISOString()),
    onSuccess: (updated) => {
      refresh();
      const until = updated.snoozedUntil ? new Date(updated.snoozedUntil) : null;
      toast(until ? `已延后至 ${until.toLocaleString()}` : "已延后", { tone: "success" });
    },
    onError: fail,
  });

  const snoozeUntil = useMutation({
    mutationFn: ({ task, until }: { task: Task; until: Date }) =>
      api.snoozeTask(task.id, until.toISOString()),
    onSuccess: () => {
      refresh();
      toast("已延后", { tone: "success" });
    },
    onError: fail,
  });

  const wake = useMutation({
    mutationFn: (task: Task) => api.snoozeTask(task.id, null),
    onSuccess: () => {
      refresh();
      toast("已取消延后", { tone: "success" });
    },
    onError: fail,
  });

  const skip = useMutation({
    mutationFn: (task: Task) => api.skipTask(task.id),
    onSuccess: (updated) => {
      refresh();
      const due = nextDue(updated);
      toast(due ? `已跳过，下次到期 ${due.toLocaleDateString()}` : "已跳过本轮", { tone: "success" });
    },
    onError: fail,
  });

  const pin = useMutation({
    mutationFn: ({ task, pinned }: { task: Task; pinned: boolean }) => api.pinTask(task.id, pinned),
    onSuccess: (updated) => {
      refresh();
      toast(updated.pinned ? "已置顶" : "已取消置顶", { tone: "success" });
    },
    onError: fail,
  });

  const duplicate = useMutation({
    mutationFn: (task: Task) => api.duplicateTask(task.id),
    onSuccess: (copy) => {
      refresh();
      toast(`已创建“${copy.name}”`, { tone: "success" });
    },
    onError: fail,
  });

  const archive = useMutation({
    mutationFn: ({ task, archived }: { task: Task; archived: boolean }) =>
      archived ? api.archiveTask(task.id) : api.unarchiveTask(task.id),
    onSuccess: (_d, { archived }) => {
      refresh();
      toast(archived ? "已归档" : "已取消归档", { tone: "success" });
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (task: Task) => api.deleteTask(task.id),
    onSuccess: () => {
      refresh();
      toast("已删除", { tone: "success" });
    },
    onError: fail,
  });

  /**
   * Delete, behind a confirmation. Deleting is the one action here that can't
   * be undone, so it never happens on a single click — including from the
   * context menu, where a mis-aimed click is easiest.
   */
  const confirmDelete = async (task: Task) => {
    const ok = await confirm({
      title: `删除“${task.name}”？`,
      description:
        task.completionCount > 0
          ? `将删除该任务及其 ${task.completionCount} 条打卡记录，此操作无法撤销。`
          : "将删除该任务，此操作无法撤销。",
      confirmText: "删除",
      destructive: true,
    });
    if (ok) remove.mutate(task);
  };

  /**
   * Save this task's setup as a template, under a name the user picks.
   *
   * Templates live in preferences rather than the database: they are a personal
   * starting point, not shared data, and this keeps them out of the schema.
   */
  const saveAsTemplate = async (task: Task) => {
    const name = await prompt({
      title: "保存为模板",
      description: "新任务可基于此设置创建——包含周期、标签和文件夹，不含历史。",
      defaultValue: task.name,
      confirmText: "保存",
    });
    const trimmed = (name ?? "").trim();
    if (!trimmed) return;
    setPrefs({ taskTemplates: saveTemplate(prefs.taskTemplates, templateFromTask(task, trimmed)) });
    toast(`已将“${trimmed}”保存为模板`, { tone: "success" });
  };

  return {
    quickLog, snooze, snoozeUntil, wake, skip, pin, duplicate, archive, confirmDelete,
    undoCompletion, saveAsTemplate,
  };
}

/**
 * useTaskMenu — the right-click menu for a task, wherever it is right-clicked.
 *
 * Lives here rather than in TaskCard because the cards are no longer the only
 * place a task appears: the calendar's day list shows them too, and a menu that
 * offered a different set of actions depending on which list you found the task
 * in would be worse than no menu at all.
 *
 * Returns a builder rather than the entries themselves — ContextMenu calls it
 * on open, so labels ("Pin" vs "Unpin") reflect the task as it is now.
 */
export function useTaskMenu() {
  const actions = useTaskActions();
  const { openManage, openComplete } = useTaskWindows();
  const { user } = useAuth();

  return (task: Task) => (): ContextMenuEntry[] => {
    // Scheduling and structure belong to the owner; a member of a shared task
    // gets only the actions they're actually allowed to perform.
    const isOwner = user ? task.ownerId === user.id : true;
    const archived = task.archivedAt != null;
    const snoozed = isSnoozed(task);

    const entries: ContextMenuEntry[] = [];
    if (!archived) {
      entries.push({ label: "快速打卡", icon: <Zap />, onSelect: () => actions.quickLog.mutate(task) });
      entries.push({ label: "带时间打卡…", icon: <Clock />, onSelect: () => openComplete(task) });
    }
    entries.push({ label: "管理…", icon: <Settings2 />, onSelect: () => openManage(task) });

    if (isOwner && !archived) {
      entries.push({ separator: true });
      if (snoozed) {
        entries.push({ label: "立即唤醒", icon: <BellOff />, onSelect: () => actions.wake.mutate(task) });
      } else {
        for (const preset of SNOOZE_PRESETS) {
          entries.push({
            label: `延后 ${preset.label}`,
            icon: <Moon />,
            onSelect: () => actions.snooze.mutate({ task, hours: preset.hours }),
          });
        }
      }
      entries.push({
        label: "跳过本轮",
        icon: <SkipForward />,
        // Only a routine has a cycle to skip; shown-but-disabled explains why
        // the action exists without pretending it applies here.
        disabled: task.intervalSeconds == null,
        onSelect: () => actions.skip.mutate(task),
      });
    }

    if (isOwner) {
      entries.push({ separator: true });
      entries.push({
        label: task.pinned ? "取消置顶" : "置顶",
        icon: task.pinned ? <PinOff /> : <Pin />,
        onSelect: () => actions.pin.mutate({ task, pinned: !task.pinned }),
      });
      entries.push({ label: "复制", icon: <Copy />, onSelect: () => actions.duplicate.mutate(task) });
      entries.push({
        label: "保存为模板",
        icon: <BookmarkPlus />,
        onSelect: () => void actions.saveAsTemplate(task),
      });
      entries.push({
        label: archived ? "取消归档" : "归档",
        icon: archived ? <ArchiveRestore /> : <Archive />,
        onSelect: () => actions.archive.mutate({ task, archived: !archived }),
      });
      entries.push({ separator: true });
    }
    entries.push({
      label: isOwner ? "删除" : "退出任务",
      icon: <Trash2 />,
      destructive: true,
      onSelect: () => void actions.confirmDelete(task),
    });
    return entries;
  };
}
