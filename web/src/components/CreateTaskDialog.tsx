import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Wand2 } from "lucide-react";

import { api, type Task } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IntervalField } from "@/components/IntervalField";
import { TagInput } from "@/components/ui/TagInput";
import { FolderInput } from "@/components/ui/FolderInput";
import { folderNames } from "@/lib/folders";
import { findTemplate, templateToInput } from "@/lib/templates";
import { describeQuickAdd, parseQuickAdd } from "@/lib/quickAdd";
import { formatInterval } from "@/lib/time";
import { usePrefs } from "@/lib/prefs";

/**
 * CreateTaskDialog owns the "new task" form. `trigger` lets callers supply their
 * own button (e.g. the sidebar vs. the empty-state), defaulting to a standard
 * "New task" button.
 *
 * Open state is internal by default, but can be lifted by passing `open` +
 * `onOpenChange` — that's how the "n" keyboard shortcut opens the form without
 * a button to click. A lifted instance usually wants `hideTrigger` too, so the
 * shortcut doesn't also plant a stray button on the page.
 */
export function CreateTaskDialog({
  trigger,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (next: boolean) => {
    if (!controlled) setOpenState(next);
    onOpenChange?.(next);
  };
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [folder, setFolder] = useState("");
  const queryClient = useQueryClient();
  const folderSuggestions = folderNames(queryClient.getQueryData<Task[]>(["tasks"]) ?? []);
  const { prefs } = usePrefs();
  const templates = prefs.taskTemplates ?? [];

  // Quick-add: read a cadence, tags and a folder out of the name as it's typed.
  // The parse is only ever *shown* — applying it silently would leave people
  // wondering why their task lost half its title. One click accepts it.
  const parsed = prefs.quickAdd ? parseQuickAdd(name) : null;
  const suggestion = parsed?.matched ? parsed : null;
  const applySuggestion = () => {
    if (!suggestion) return;
    setName(suggestion.name);
    if (suggestion.intervalSeconds != null) setIntervalSeconds(suggestion.intervalSeconds);
    if (suggestion.tags.length > 0) {
      const have = new Set(tags.map((t) => t.toLowerCase()));
      setTags([...tags, ...suggestion.tags.filter((t) => !have.has(t.toLowerCase()))]);
    }
    if (suggestion.folder) setFolder(suggestion.folder);
  };

  const toast = useToast();
  const mutation = useMutation({
    mutationFn: () =>
      api.createTask({
        name: name.trim(),
        description: description.trim() || undefined,
        intervalSeconds,
        tags,
        folder: folder.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setName("");
      setDescription("");
      setIntervalSeconds(null);
      setTags([]);
      setFolder("");
      setOpen(false);
      toast("任务已创建", { tone: "success" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button>
              <Plus /> 新建任务
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
          <DialogDescription>
            一件你重复做、并想记住上次何时做的事。
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) mutation.mutate();
          }}
          className="space-y-4"
        >
          {/* Templates fill the form in rather than creating anything, so the
              usual edits are still available before saving. Only shown when
              there are templates; nobody needs an empty picker. */}
          {templates.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="task-template">从模板开始</Label>
              <Select
                id="task-template"
                value=""
                onChange={(e) => {
                  const t = findTemplate(templates, e.target.value);
                  if (!t) return;
                  const input = templateToInput(t);
                  setName(input.name);
                  setDescription(input.description ?? "");
                  setIntervalSeconds(input.intervalSeconds ?? null);
                  setTags(input.tags ?? []);
                  setFolder(input.folder ?? "");
                }}
              >
                <option value="">空白任务</option>
                {templates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="task-name">名称</Label>
            <Input
              id="task-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：浇花 every 2 weeks #home"
              autoFocus
            />
            {suggestion && (
              <button
                type="button"
                onClick={applySuggestion}
                className="flex w-full items-start gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 py-1.5 text-left text-xs transition-colors hover:bg-primary/15"
              >
                <Wand2 className="mt-px h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{suggestion.name || "（还没有名称）"}</span>
                  <span className="block text-muted-foreground">
                    {describeQuickAdd(suggestion, formatInterval)}——点击采用
                  </span>
                </span>
              </button>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-description">描述（可选）</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="任何值得记住的细节"
              rows={2}
            />
          </div>
          <IntervalField value={intervalSeconds} onChange={setIntervalSeconds} />
          <div className="space-y-2">
            <Label>标签（可选）</Label>
            <TagInput value={tags} onChange={setTags} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="task-folder">文件夹（可选）</Label>
            <FolderInput value={folder} onChange={setFolder} suggestions={folderSuggestions} />
          </div>
          {mutation.isError && (
            <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={!name.trim() || mutation.isPending}>
              {mutation.isPending ? "创建中…" : "创建任务"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
