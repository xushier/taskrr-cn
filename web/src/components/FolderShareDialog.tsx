import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderTree, UserPlus, X } from "lucide-react";

import { api, type TaskMember } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/Toast";

/**
 * FolderShareDialog — invite people to everything in one folder.
 *
 * The point of the coarser grain is that it keeps working: a task created in
 * the folder later, or moved into it, is covered without anyone doing anything.
 * The wording says so, because "shared a folder" otherwise reads like a
 * one-time copy of whatever was in it at the time.
 */
export function FolderShareDialog({
  folder,
  taskCount,
  open,
  onOpenChange,
}: {
  folder: string;
  /** How many tasks are in the folder right now, for the blast-radius line. */
  taskCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [username, setUsername] = useState("");

  const { data: members } = useQuery({
    queryKey: ["folder-members", folder],
    queryFn: () => api.listFolderMembers(folder),
    enabled: open,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["folder-members", folder] });
    queryClient.invalidateQueries({ queryKey: ["folder-shares"] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const share = useMutation({
    mutationFn: () => api.shareFolder(folder, username.trim()),
    onSuccess: () => {
      setUsername("");
      invalidate();
      toast("邀请已发送", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  const remove = useMutation({
    mutationFn: (userId: number) => api.unshareFolder(folder, userId),
    onSuccess: () => {
      invalidate();
      toast("已移除", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderTree className="h-4 w-4 shrink-0" /> 分享“{folder}”
          </DialogTitle>
          <DialogDescription>
            你添加的每个人都能看到此文件夹中的全部 {taskCount} 个任务，以及你之后放入的任何任务。他们可以打卡和编辑历史记录，但文件夹及其任务仍归你所有。
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim()) share.mutate();
          }}
        >
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="输入用户名以分享"
            className="min-w-0 flex-1 basis-40"
            autoFocus
          />
          <Button type="submit" size="sm" disabled={share.isPending || !username.trim()}>
            <UserPlus className="h-3.5 w-3.5" /> {share.isPending ? "发送中…" : "分享"}
          </Button>
        </form>

        {members && members.length > 0 ? (
          <ul className="space-y-1">
            {members.map((m: TaskMember) => (
              <li key={m.userId} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-sm">
                <span className="truncate">{m.username}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs capitalize text-muted-foreground">{m.status === "owner" ? "所有者" : m.status === "pending" ? "待接受" : "已接受"}</span>
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
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">此文件夹还没有其他成员。</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
