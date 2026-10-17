import { useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  BarChart3,
  LogOut,
  Moon,
  Pencil,
  SkipForward,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { api, type Completion, type Task } from "@/lib/api";
import { formatDate, formatDateTime, formatGap } from "@/lib/time";
import { PACE_LABELS, paceVerdict, taskStats } from "@/lib/stats";
import { isSnoozed } from "@/lib/staleness";
import { useNow } from "@/lib/useNow";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { useTaskActions } from "@/components/useTaskActions";
import { usePrefs } from "@/lib/prefs";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/Toast";
import { ColorField } from "@/components/ui/ColorPicker";
import { DateTimePicker } from "@/components/DateTimePicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IntervalField } from "@/components/IntervalField";
import { TagInput } from "@/components/ui/TagInput";
import { FolderInput } from "@/components/ui/FolderInput";
import { folderNames } from "@/lib/folders";

/**
 * ManageTaskPanel is the "manage" surface for a task, rendered as the body of
 * a floating window (so several tasks can be managed side by side). It bundles:
 *   1. Edit    — name / description / cadence / colours
 *   2. History — see and undo individual completions
 *   3. Delete  — remove the task and its history (with a confirm step)
 *
 * `onClose` closes the owning window (after a successful save or delete).
 */
export function ManageTaskPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  const { user } = useAuth();
  // A member (not the owner) can log and review history and leave, but not edit
  // or archive the definition — those stay with the owner.
  const isOwner = user ? task.ownerId === user.id : true;

  return (
    <div className="space-y-4">
      {isOwner ? (
        <>
          <p className="text-sm text-muted-foreground">编辑任务、查看历史或将其删除。</p>
          <EditSection task={task} onDone={onClose} />
        </>
      ) : (
        <div>
          <h3 className="text-base font-semibold">{task.name}</h3>
          {task.description && <p className="mt-0.5 text-sm text-muted-foreground">{task.description}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            已共享给你——可打卡、查看历史，或在下方退出。
          </p>
        </div>
      )}

      {isOwner && <ScheduleSection task={task} />}

      <ShareSection task={task} isOwner={isOwner} onLeft={onClose} />

      <hr className="border-border/60" />
      <StatsSection task={task} />
      <HistorySection task={task} />

      {isOwner && (
        <>
          <hr className="border-border/60" />
          <DangerZone task={task} onDeleted={onClose} />
        </>
      )}
    </div>
  );
}

// ScheduleSection: put a task off without touching what it is.
//
// The context menu covers the common cases with fixed presets ("3 days"); this
// is where an exact date lives, along with the two other scheduling verbs. Skip
// is deliberately worded as moving the schedule, never as "done" — it writes no
// history, and the statistics and calendar depend on that staying true.
function ScheduleSection({ task }: { task: Task }) {
  const actions = useTaskActions();
  const now = useNow();
  const snoozed = isSnoozed(task, now);
  const [until, setUntil] = useState<Date>(() => new Date(Date.now() + 24 * 3_600_000));

  return (
    <div className="space-y-2">
      <hr className="border-border/60" />
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Moon className="h-4 w-4" /> 时间安排
      </p>

      {snoozed && task.snoozedUntil ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm">
          <span className="text-muted-foreground">
            已延后至 <span className="font-medium text-foreground">{formatDateTime(task.snoozedUntil)}</span>
          </span>
          <Button size="sm" variant="outline" onClick={() => actions.wake.mutate(task)}>
            立即唤醒
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">延后至</Label>
          <DateTimePicker value={until} onChange={setUntil} />
          <Button
            size="sm"
            variant="outline"
            disabled={actions.snoozeUntil.isPending}
            onClick={() => actions.snoozeUntil.mutate({ task, until })}
          >
            {actions.snoozeUntil.isPending ? "延后中…" : "延后"}
          </Button>
        </div>
      )}

      {task.intervalSeconds != null && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            跳过本轮——把下次到期时间顺延一个周期，且不记录任何打卡。
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={actions.skip.isPending}
            onClick={() => actions.skip.mutate(task)}
          >
            <SkipForward className="h-3.5 w-3.5" /> 跳过
          </Button>
        </div>
      )}
    </div>
  );
}

// ShareSection is the collaboration surface, shown only when the admin has
// enabled sharing. The owner invites people (by username) and sees the member
// list; a member sees who's on it and can leave.
function ShareSection({ task, isOwner, onLeft }: { task: Task; isOwner: boolean; onLeft: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const { data: members } = useQuery({
    queryKey: ["members", task.id],
    queryFn: () => api.listMembers(task.id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["members", task.id] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const share = useMutation({
    mutationFn: () => api.shareTask(task.id, username.trim()),
    onSuccess: () => {
      setUsername("");
      invalidate();
      toast("邀请已发送", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  // The owner's side of undoing a share, the same control the folder dialog has:
  // an invite sent to the wrong username used to be the recipient's to decline.
  const remove = useMutation({
    mutationFn: (userId: number) => api.removeMember(task.id, userId),
    onSuccess: () => {
      invalidate();
      toast("已移除", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  const leave = useMutation({
    mutationFn: () => api.leaveTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      toast("已退出任务", { tone: "success" });
      onLeft();
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  if (!config?.tasksShareable) return null;

  return (
    <div className="space-y-2">
      <hr className="border-border/60" />
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Users className="h-4 w-4" /> 共享
      </p>

      {members && members.length > 0 && (
        <ul className="space-y-1">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{m.username}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-xs capitalize text-muted-foreground">
                  {m.status === "owner" ? "所有者" : m.status === "pending" ? "已邀请" : "成员"}
                </span>
                {isOwner && m.status !== "owner" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 hover:text-destructive"
                    aria-label={`移除 ${m.username}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(m.userId)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {isOwner ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim()) share.mutate();
          }}
          className="flex gap-2 pt-1"
        >
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="输入用户名以共享"
            aria-label="要共享给的用户名"
          />
          <Button type="submit" size="sm" disabled={!username.trim() || share.isPending}>
            <UserPlus /> 共享
          </Button>
        </form>
      ) : (
        <div className="pt-1">
          <Button variant="outline" size="sm" disabled={leave.isPending} onClick={() => leave.mutate()}>
            <LogOut /> 退出任务
          </Button>
        </div>
      )}
    </div>
  );
}

// Matches the account-wide options in RemindersSection, so a per-task override
// is picked from the same vocabulary rather than a second, subtly different one.
const REMINDER_LEADS: { label: string; value: number }[] = [
  { label: "到期时", value: 0 },
  { label: "提前 1 小时", value: 3600 },
  { label: "提前 6 小时", value: 21600 },
  { label: "提前 1 天", value: 86400 },
  { label: "提前 3 天", value: 259200 },
  { label: "提前 1 周", value: 604800 },
];

function EditSection({ task, onDone }: { task: Task; onDone: () => void }) {
  const { prefs } = usePrefs();
  const nameId = useId();
  const descId = useId();
  const [name, setName] = useState(task.name);
  const [description, setDescription] = useState(task.description);
  const [intervalSeconds, setIntervalSeconds] = useState<number | null>(task.intervalSeconds);
  const [colorFresh, setColorFresh] = useState<string | null>(task.colorFresh);
  const [colorOverdue, setColorOverdue] = useState<string | null>(task.colorOverdue);
  const [freezeColor, setFreezeColor] = useState(task.freezeColor);
  const [tags, setTags] = useState<string[]>(task.tags);
  const [folder, setFolder] = useState(task.folder);
  const [pinned, setPinned] = useState(task.pinned);
  const [rotate, setRotate] = useState(task.rotate);
  const [reminderLead, setReminderLead] = useState<number | null>(task.reminderLeadSeconds);
  const queryClient = useQueryClient();
  const folderSuggestions = folderNames(queryClient.getQueryData<Task[]>(["tasks"]) ?? []);

  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () =>
      api.updateTask(task.id, {
        name: name.trim(),
        description: description.trim(),
        intervalSeconds,
        colorFresh,
        colorOverdue,
        freezeColor,
        tags,
        folder: folder.trim(),
        pinned,
        rotate,
        reminderLeadSeconds: intervalSeconds == null ? null : reminderLead,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onDone();
      toast("任务已保存", { tone: "success" });
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) mutation.mutate();
      }}
      className="space-y-3"
    >
      <div className="space-y-2">
        <Label htmlFor={nameId}>名称</Label>
        <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={descId}>描述</Label>
        <Textarea
          id={descId}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
      </div>
      <IntervalField value={intervalSeconds} onChange={setIntervalSeconds} />

      {/* A reminder lead only means something for a task with a routine — there
          is nothing to be early for otherwise — so it appears with one. */}
      {intervalSeconds != null && (
        <div className="space-y-1">
          <Label>提醒我</Label>
          <select
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={reminderLead == null ? "" : String(reminderLead)}
            onChange={(e) => setReminderLead(e.target.value === "" ? null : Number(e.target.value))}
          >
            <option value="" className="bg-background">
              使用我的账号设置
            </option>
            {REMINDER_LEADS.map((o) => (
              <option key={o.value} value={o.value} className="bg-background">
                {o.label}
              </option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            仅在账号中开启提醒后生效。
          </p>
        </div>
      )}

      {/* A rota only means anything once more than one person can log the task,
          so it appears on shared tasks and nowhere else. */}
      {task.shared && (
        <ToggleRow
          label="轮流"
          hint="显示当前轮到谁，每次有人打卡后移到下一人"
          checked={rotate}
          onChange={(v) => setRotate(v)}
        />
      )}

      <ToggleRow
          label="置顶"
          hint="无论列表如何排序，都让此任务排在最前"
          checked={pinned}
          onChange={(v) => setPinned(v)}
        />

      <div className="space-y-2">
        <Label>标签</Label>
        <TagInput value={tags} onChange={setTags} />
      </div>

      <div className="space-y-2">
        <Label>文件夹</Label>
        <FolderInput value={folder} onChange={setFolder} suggestions={folderSuggestions} />
      </div>

      <div className="space-y-2">
        <Label>颜色</Label>
        <div className="grid grid-cols-2 gap-2">
          <ColorField
            label="最近"
            value={colorFresh ?? prefs.taskColorFresh}
            isDefault={colorFresh == null}
            onChange={setColorFresh}
            onClear={() => setColorFresh(null)}
          />
          <ColorField
            label="已逾期"
            value={colorOverdue ?? prefs.taskColorOverdue}
            isDefault={colorOverdue == null}
            onChange={setColorOverdue}
            onClear={() => setColorOverdue(null)}
          />
        </div>
        <div
          className="h-1.5 rounded-full"
          style={{
            background: freezeColor
              ? (colorFresh ?? prefs.taskColorFresh)
              : `linear-gradient(90deg, ${colorFresh ?? prefs.taskColorFresh}, ${
                  colorOverdue ?? prefs.taskColorOverdue
                })`,
          }}
        />
        <ToggleRow
          label="冻结颜色"
          hint="保持为最近颜色，不会渐变为逾期色"
          checked={freezeColor}
          onChange={(v) => setFreezeColor(v)}
        />
      </div>

      {mutation.isError && (
        <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!name.trim() || mutation.isPending}>
          {mutation.isPending ? "保存中…" : "保存更改"}
        </Button>
      </div>
    </form>
  );
}

// StatsSection turns the completion history into the numbers the app is really
// about: not "when did I last do this" (the card already answers that) but "am I
// keeping up". Everything here is derived client-side from the history the
// Manage window already fetches — no extra request, no stored aggregates — and
// the whole panel is behind a preference, since plenty of people just want the
// list. Two columns on a phone, four once there's room.
function StatsSection({ task }: { task: Task }) {
  const { prefs } = usePrefs();
  const { data: completions } = useQuery({
    queryKey: ["completions", task.id],
    queryFn: () => api.listCompletions(task.id),
    enabled: prefs.showTaskStats,
  });
  const stats = useMemo(
    () => taskStats(completions, task.intervalSeconds),
    [completions, task.intervalSeconds],
  );

  if (!prefs.showTaskStats) return null;
  // Below two completions there is no gap to measure at all, and a panel of
  // dashes is worse than no panel — the history list already says everything.
  if (stats.count < 2) return null;

  // One gap is a measurement, not a pattern: "typical" and "longest" would be
  // the same number and an on-time rate would be 0% or 100% off a sample of
  // one. So a two-completion task gets the honest reduced version, and the
  // trend language only appears once there are at least two gaps to compare.
  const trend = stats.gaps.length >= 2;
  const tiles: { label: string; value: string; hint?: string }[] = [
    {
      label: trend ? "通常间隔" : "上次间隔",
      value: formatGap(stats.typicalGapMs!),
      hint: trend
        ? "两次打卡间隔的中位数——一次假期不会带偏它"
        : "目前仅有的一次间隔；再打卡一次才能看出规律",
    },
    {
      label: "已打卡",
      value: `${stats.count}×`,
      hint: `首次打卡 ${formatDate(stats.first!)}`,
    },
  ];
  if (trend) {
    tiles.push({ label: "最长间隔", value: formatGap(stats.longestGapMs!) });
    if (stats.onTimeRate != null) {
      tiles.push({
        label: "按时",
        value: `${Math.round(stats.onTimeRate * 100)}%`,
        hint: "在周期内完成打卡的间隔占比",
      });
    }
  }

  const verdict = trend ? paceVerdict(stats.paceRatio) : null;

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <BarChart3 className="h-4 w-4" /> 统计
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border p-2" title={t.hint}>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.label}</p>
            <p className="truncate text-sm font-semibold tabular-nums">{t.value}</p>
          </div>
        ))}
      </div>
      {verdict && task.intervalSeconds && (
        <p className="text-xs text-muted-foreground">
          你这件事做得<span className="font-medium text-foreground">{PACE_LABELS[verdict]}</span>——每{" "}
          {formatGap(stats.typicalGapMs!)}，而周期为 {formatGap(task.intervalSeconds * 1000)}。
        </p>
      )}
    </div>
  );
}

function HistorySection({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const { data: completions, isLoading } = useQuery({
    queryKey: ["completions", task.id],
    queryFn: () => api.listCompletions(task.id),
  });
  // On a shared task, resolve each completion's author id to a name ("by X").
  const { data: members } = useQuery({
    queryKey: ["members", task.id],
    queryFn: () => api.listMembers(task.id),
    enabled: task.shared,
  });
  const names = useMemo(() => {
    const m = new Map<number, string>();
    for (const mem of members ?? []) m.set(mem.userId, mem.username);
    return m;
  }, [members]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["completions", task.id] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["activity"] });
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">历史</p>
      <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
        {isLoading && <p className="text-sm text-muted-foreground">加载中…</p>}
        {completions && completions.length === 0 && (
          <p className="text-sm text-muted-foreground">还没有打卡记录。</p>
        )}
        {completions?.map((c) => (
          <HistoryRow
            key={c.id}
            completion={c}
            author={task.shared && c.userId != null ? names.get(c.userId) : undefined}
            onChanged={invalidate}
          />
        ))}
      </div>
    </div>
  );
}

// HistoryRow shows one completion and lets you edit its time/note in place
// (PATCH /api/completions/{id}) or delete it. `author` (when set) names who
// logged it, shown on shared tasks.
function HistoryRow({
  completion: c,
  author,
  onChanged,
}: {
  completion: Completion;
  author?: string;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(() => new Date(c.completedAt));
  const [note, setNote] = useState(c.note);

  const save = useMutation({
    mutationFn: () =>
      api.updateCompletion(c.id, { completedAt: when.toISOString(), note: note.trim() || undefined }),
    onSuccess: () => {
      onChanged();
      setEditing(false);
    },
  });
  const del = useMutation({ mutationFn: () => api.deleteCompletion(c.id), onSuccess: onChanged });

  if (editing) {
    return (
      <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
        <DateTimePicker value={when} onChange={setWhen} max={new Date()} />
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="备注（可选）"
        />
        {save.isError && <p className="text-xs text-destructive">{(save.error as Error).message}</p>}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(false);
              setWhen(new Date(c.completedAt));
              setNote(c.note);
            }}
          >
            取消
          </Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {formatDateTime(c.completedAt)}
          {author && <span className="font-normal text-muted-foreground"> · 由 {author} 打卡</span>}
        </p>
        {c.note && <p className="mt-0.5 break-words text-sm text-muted-foreground">{c.note}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="编辑此记录"
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-4 w-4 text-muted-foreground" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="删除此记录"
          disabled={del.isPending}
          onClick={() => del.mutate()}
        >
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}

function DangerZone({ task, onDeleted }: { task: Task; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const archived = task.archivedAt != null;

  const mutation = useMutation({
    mutationFn: () => api.deleteTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      onDeleted();
      toast("任务已删除", { tone: "success" });
    },
  });

  const archive = useMutation({
    mutationFn: () => (archived ? api.unarchiveTask(task.id) : api.archiveTask(task.id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onDeleted();
      toast(archived ? "任务已恢复" : "任务已归档", { tone: "success" });
    },
  });

  if (!confirming) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={archive.isPending} onClick={() => archive.mutate()}>
          {archived ? <ArchiveRestore /> : <Archive />} {archived ? "恢复" : "归档"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
          <Trash2 /> 删除任务
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        删除“{task.name}”及其 {task.completionCount} 条打卡记录？此操作无法撤销。
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
          取消
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "删除中…" : "确认删除"}
        </Button>
      </div>
    </div>
  );
}
