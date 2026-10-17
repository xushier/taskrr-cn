import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Copy,
  Download,
  KeyRound,
  Upload,
  Link2,
  Link2Off,
  Plus,
  Terminal,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";

import { api, type APIToken, type ImportResult } from "@/lib/api";
import { parseCsv, type CsvTable } from "@/lib/csv";
import { CsvMapper } from "@/components/settings/CsvMapper";
import { endSession } from "@/lib/signOut";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/components/AuthProvider";
import { RemindersSection } from "@/components/settings/RemindersSection";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { ToggleRow } from "@/components/ui/ToggleRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatDateTime } from "@/lib/time";

/** Account self-service: every signed-in user can change their own username + password. */
export function AccountSection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { setTheme } = useTheme();
  const toast = useToast();
  const [username, setUsername] = useState(user?.username ?? "");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);

  // Accounts created without a password (or OIDC-only) don't need the current one.
  const needsCurrent = user?.passwordSet ?? true;

  // Whether the instance offers OIDC at all — gates the "Connected sign-in" UI.
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });

  const unlink = useMutation({
    mutationFn: () => api.unlinkOIDC(),
    onSuccess: (updated) => queryClient.setQueryData(["me"], updated),
  });

  // Danger zone: both actions make the user re-type their own username to confirm.
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const name = (user?.username ?? "").toLowerCase();
  const wipeOk = wipeConfirm.trim().toLowerCase() === name && name !== "";
  const deleteOk = deleteConfirm.trim().toLowerCase() === name && name !== "";

  const wipe = useMutation({
    mutationFn: () => api.wipeMyData(wipeConfirm.trim()),
    onSuccess: () => {
      setWipeConfirm("");
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      toast("你的任务已删除", { tone: "success" });
    },
  });

  const del = useMutation({
    mutationFn: () => api.deleteAccount(deleteConfirm.trim()),
    onSuccess: () => {
      // The same teardown as signing out: the account is gone, so the app
      // flips to the sign-in screen wearing this instance's look, not the
      // account's and not the built-in one.
      endSession(queryClient, setTheme);
    },
  });

  const rename = useMutation({
    mutationFn: () => api.changeUsername(username.trim()),
    onSuccess: (updated) => {
      // Reflect the new name immediately and refresh the admin list if open.
      queryClient.setQueryData(["me"], updated);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast("用户名已更新", { tone: "success" });
    },
  });

  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      setErr(null);
      toast("密码已更新", { tone: "success" });
    },
    onError: (e) => setErr((e as Error).message),
  });

  // Per-user opt-out for receiving shared tasks (shown only when sharing is on).
  const allowShares = useMutation({
    mutationFn: (allow: boolean) => api.setAllowShares(allow),
    onSuccess: (updated) => {
      queryClient.setQueryData(["me"], updated);
      toast("共享偏好已保存", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  const submit = () => {
    setErr(null);
    if (next.length < 8) return setErr("密码至少需要 8 个字符。");
    if (next !== confirm) return setErr("两次输入的密码不一致。");
    change.mutate();
  };

  return (
    <div className="space-y-4">
      <section className="space-y-1">
        <h3 className="text-sm font-semibold">账户</h3>
        <p className="text-xs text-muted-foreground">
          当前登录为 <span className="font-medium text-foreground">{user?.username}</span>
          {user?.role === "admin" && " · 管理员"}。
        </p>
      </section>

      <SettingsGroup
        id="account.signin"
        title="登录"
        icon={<UserRound />}
        flat
      >
      <section className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" /> 用户名
        </h4>
        <div className="flex gap-2">
          <Input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            className="h-8"
          />
          <Button
            size="sm"
            disabled={rename.isPending || !username.trim() || username.trim() === user?.username}
            onClick={() => rename.mutate()}
          >
            {rename.isPending ? "保存中…" : "重命名"}
          </Button>
        </div>
        {rename.isError && <p className="text-xs text-destructive">{(rename.error as Error).message}</p>}
        {rename.isSuccess && <p className="text-xs text-emerald-500">用户名已更新。</p>}
      </section>


      <section className="space-y-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <KeyRound className="h-3.5 w-3.5" /> 修改密码
          {!needsCurrent && "（设置密码后可用用户名登录）"}
        </h4>
        <p className="text-[11px] text-muted-foreground">
          将登出你的其他设备，并吊销你创建的所有 API 令牌。
        </p>
        {needsCurrent && (
          <Input
            type="password"
            placeholder="当前密码"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="h-8"
          />
        )}
        <Input
          type="password"
          placeholder="新密码"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className="h-8"
        />
        <Input
          type="password"
          placeholder="确认新密码"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="h-8"
        />
        {err && <p className="text-xs text-destructive">{err}</p>}
        {change.isSuccess && <p className="text-xs text-emerald-500">密码已更新。</p>}
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={change.isPending || !next || !confirm || (needsCurrent && !current)}
            onClick={submit}
          >
            {change.isPending ? "保存中…" : "修改密码"}
          </Button>
        </div>
      </section>

      {/* Connected sign-in: link or unlink a single sign-on (OIDC) identity.
          Only shown when the instance has OIDC configured, or the account is
          already linked (so a linked user can always unlink even if an admin
          later turns OIDC off). */}
      {(config?.oidc || user?.oidcLinked) && (
        <section className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" /> 关联登录
          </h4>
          {user?.oidcLinked ? (
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">单点登录</p>
                  <p className="text-xs text-muted-foreground">
                    此账户已关联单点登录。
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 self-start sm:self-auto"
                  disabled={unlink.isPending || !user?.passwordSet}
                  onClick={() => unlink.mutate()}
                >
                  <Link2Off className="h-3.5 w-3.5" />
                  {unlink.isPending ? "正在断开…" : "断开"}
                </Button>
              </div>
              {!user?.passwordSet && (
                <p className="text-xs text-muted-foreground">
                  请先在上方设置密码，否则断开后将无法登录。
                </p>
              )}
              {unlink.isError && (
                <p className="text-xs text-destructive">{(unlink.error as Error).message}</p>
              )}
            </div>
          ) : (
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <p className="text-xs text-muted-foreground">
                关联单点登录后，你也可以通过身份提供方登录。
              </p>
              <Button size="sm" variant="outline" asChild>
                <a href="/api/auth/oidc/link">
                  <Link2 className="h-3.5 w-3.5" /> 关联 SSO
                </a>
              </Button>
            </div>
          )}
        </section>
      )}
      </SettingsGroup>

      {/* Sharing is a multi-user idea: with lite mode on, or sharing disabled
          instance-wide, there is nothing here to decide. */}
      {config?.tasksShareable && !config?.lite && (
        <SettingsGroup id="account.sharing" title="共享" icon={<Users />} summary="谁可以发任务给你">
          <ToggleRow
            label="允许他人共享任务给我"
            hint="关闭后，其他人无法向你发送任务。"
            checked={user?.allowShares ?? true}
            disabled={allowShares.isPending}
            onChange={(v) => allowShares.mutate(v)}
          />
        </SettingsGroup>
      )}

      <RemindersSection />

      <SettingsGroup
        id="account.data"
        title="我的数据"
        icon={<Download />}
        summary="导出、导入"
      >
        <ExportSection />
      </SettingsGroup>

      <SettingsGroup
        id="account.tokens"
        title="API 令牌"
        icon={<Terminal />}
        summary="用于脚本和自动化"
      >
        <APITokensSection />
      </SettingsGroup>

      {/* Advanced: the irreversible self-service actions live here (each gated by
          re-typing the account's own username), under a "Danger zone" label.
          Shut by default so it's tucked away. */}
      <SettingsGroup id="account.advanced" title="高级" icon={<AlertTriangle />}>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" /> 危险区
        </div>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            删除你的全部任务及其历史记录，账户和设置会保留。此操作无法撤销。
          </p>
          <div className="flex gap-2">
            <Input
              value={wipeConfirm}
              onChange={(e) => setWipeConfirm(e.target.value)}
              placeholder={`输入"${user?.username}"以确认`}
              className="h-8"
            />
            <Button
              size="sm"
              variant="destructive"
              disabled={wipe.isPending || !wipeOk}
              onClick={() => wipe.mutate()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {wipe.isPending ? "删除中…" : "删除任务"}
            </Button>
          </div>
          {wipe.isError && <p className="text-xs text-destructive">{(wipe.error as Error).message}</p>}
          {wipe.isSuccess && <p className="text-xs text-emerald-500">你的所有任务已删除。</p>}
        </div>

        {user?.protected ? (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            这是主管理员账户，无法删除。
          </p>
        ) : (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs text-muted-foreground">
              永久删除你的账户及其中的所有数据，你会立即退出登录。此操作无法撤销。
            </p>
            <div className="flex gap-2">
              <Input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={`输入"${user?.username}"以确认`}
                className="h-8"
              />
              <Button
                size="sm"
                variant="destructive"
                disabled={del.isPending || !deleteOk}
                onClick={() => del.mutate()}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {del.isPending ? "删除中…" : "删除账户"}
              </Button>
            </div>
            {del.isError && <p className="text-xs text-destructive">{(del.error as Error).message}</p>}
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}

// ExportSection: take your own data with you.
//
// Admin backups are whole-database and admin-only, so on a shared instance this
// is the only way an ordinary user can get their history out — and it's the one
// thing the demo can offer for real, since its data is already in the browser.
function ExportSection() {
  const toast = useToast();
  const [busy, setBusy] = useState<"json" | "csv" | null>(null);

  const download = async (format: "json" | "csv") => {
    setBusy(format);
    try {
      const blob = await api.exportData(format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `taskrr-export-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick — revoking synchronously can cancel the download
      // in some browsers before it has read the blob.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      toast((e as Error).message, { tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-2">
      <p className="text-xs text-muted-foreground">
        你拥有或共享的全部任务及其完整历史。JSON 保留结构，CSV 可用表格软件打开。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => download("json")}>
          {busy === "json" ? "准备中…" : "下载 JSON"}
        </Button>
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => download("csv")}>
          {busy === "csv" ? "准备中…" : "下载 CSV"}
        </Button>
      </div>

      <ImportControls />
    </section>
  );
}

// ImportControls: restore a JSON export.
//
// Merge is the default and the safe one. Replace wipes the account's tasks
// first, so it sits behind the same explicit confirmation as the other
// irreversible actions — and the file is read and checked before anything is
// deleted, so a bad file can never cost you what you already had.
function ImportControls() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [result, setResult] = useState<ImportResult | null>(null);
  // Set while a CSV is waiting for its columns to be matched up.
  const [csv, setCsv] = useState<{ table: CsvTable; fileName: string } | null>(null);

  const run = useMutation({
    mutationFn: ({ json, mode: m }: { json: string; mode: "merge" | "replace" }) => api.importData(json, m),
    onSuccess: (res) => {
      setResult(res);
      setCsv(null);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      toast(
        `已导入 ${res.tasksCreated} 个任务`,
        { tone: "success" },
      );
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  // A CSV can't go straight to the server: it needs a mapping step first, so
  // it detours through CsvMapper and comes back as the same JSON document.
  const pick = async (file: File) => {
    const text = await file.text();
    const isCsv = /\.(csv|tsv|txt)$/i.test(file.name) || !text.trimStart().startsWith("{");
    if (isCsv) {
      const table = parseCsv(text);
      if (table.headers.length === 0) {
        toast("该文件似乎是空的", { tone: "error" });
        return;
      }
      setCsv({ table, fileName: file.name });
      setResult(null);
      return;
    }
    await send(text);
  };

  const send = async (json: string) => {
    if (mode === "replace") {
      const ok = await confirm({
        title: "替换全部数据？",
        description:
          "将先删除你当前的所有任务及其历史记录，再从文件恢复。此操作无法撤销。",
        confirmText: "删除并恢复",
        destructive: true,
      });
      if (!ok) return;
    }
    run.mutate({ json, mode });
  };

  return (
    <div className="space-y-2 pt-1">
      <h4 className="flex items-center gap-1.5 text-sm font-medium">
        <Upload className="h-3.5 w-3.5" /> 从文件恢复
      </h4>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "merge" | "replace")}
          aria-label="导入模式"
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="merge" className="bg-background">添加到我的任务</option>
          <option value="replace" className="bg-background">替换全部数据</option>
        </select>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json,text/csv,.csv,.tsv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Reset first, so picking the same file twice still fires a change.
            e.target.value = "";
            if (file) void pick(file);
          }}
        />
        <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => fileRef.current?.click()}>
          {run.isPending ? "导入中…" : "选择文件…"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Taskrr 的 JSON 导出文件按原样恢复；来自其他追踪应用的 CSV 会先让你匹配各列的含义。
      </p>

      {csv && (
        <CsvMapper
          table={csv.table}
          fileName={csv.fileName}
          busy={run.isPending}
          onCancel={() => setCsv(null)}
          onImport={(json) => void send(json)}
        />
      )}

      {result && (
        <div className="space-y-1 rounded-md border p-2 text-xs">
          <p className="text-foreground">
            已恢复 {result.tasksCreated} 个任务、{result.completionsAdded} 条打卡记录
            {result.tasksDeleted > 0 && `（此前删除了 ${result.tasksDeleted} 个）`}。
          </p>
          {result.skipped.length > 0 && (
            <>
              <p className="text-muted-foreground">
                有 {result.skipped.length} 条记录无法恢复：
              </p>
              <ul className="max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4 text-muted-foreground">
                {result.skipped.slice(0, 20).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// APITokensSection: bearer credentials for automation.
//
// The plaintext token exists only in this component's state, for as long as the
// panel is open after minting it — the server keeps a digest and will never show
// it again, so the copy affordance has to be right there.
function APITokensSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const enabled = config?.apiTokens ?? false;
  const { data: tokens } = useQuery({
    queryKey: ["api-tokens"],
    queryFn: api.listAPITokens,
    enabled,
  });
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createAPIToken(name.trim() || "API 令牌"),
    onSuccess: (t) => {
      setFresh(t.token);
      setName("");
      queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => api.deleteAPIToken(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
      toast("令牌已吊销", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  // The one-by-one revoke above is for tidying up. This is for the other case:
  // you think a token has leaked and don't know which of them it is.
  const revokeAll = useMutation({
    mutationFn: api.deleteAllAPITokens,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["api-tokens"] });
      toast(r.revoked === 1 ? "已吊销 1 个令牌" : `已吊销 ${r.revoked} 个令牌`, { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制", { tone: "success" });
    } catch {
      // Clipboard access needs a secure context, which a LAN instance on plain
      // HTTP won't have — the token stays selectable on screen either way.
      toast("复制失败——请手动选中令牌复制", { tone: "error" });
    }
  };

  if (!enabled) return null;

  return (
    <section className="space-y-2">
      <p className="text-xs text-muted-foreground">
        用脚本、NFC 标签或家庭自动化打卡。令牌只能访问你的任务和历史，绝不会触达管理区或你的密码。
      </p>

      {fresh && (
        <div className="space-y-1.5 rounded-lg border border-primary/40 bg-primary/10 p-2">
          <p className="text-xs font-medium">请立即复制——它不会再次显示。</p>
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 select-all break-all rounded bg-background/60 px-1.5 py-1 text-[11px]">
              {fresh}
            </code>
            <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" aria-label="复制令牌" onClick={() => copy(fresh)}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="break-all text-[11px] text-muted-foreground">
            curl -H &quot;Authorization: Bearer {fresh.slice(0, 8)}…&quot; {window.location.origin}/api/tasks
          </p>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setFresh(null)}>
            完成
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="用在哪里？例如：厨房平板"
          className="min-w-0 flex-1 basis-48"
          onKeyDown={(e) => e.key === "Enter" && !create.isPending && create.mutate()}
        />
        <Button size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
          <Plus className="h-3.5 w-3.5" /> {create.isPending ? "创建中…" : "新建令牌"}
        </Button>
      </div>

      {tokens && tokens.length > 0 && (
        <ul className="space-y-1">
          {tokens.map((t: APIToken) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-sm">{t.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {t.lastUsedAt ? `上次使用：${formatDateTime(t.lastUsedAt)}` : "从未使用"}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 hover:text-destructive"
                aria-label={`吊销 ${t.name}`}
                disabled={revoke.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: "吊销令牌",
                    description: `正在使用"${t.name}"的一切都会立即失效。此操作无法撤销。`,
                    confirmText: "吊销",
                    destructive: true,
                  });
                  if (ok) revoke.mutate(t.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {tokens && tokens.length > 1 && (
        <button
          type="button"
          disabled={revokeAll.isPending}
          onClick={async () => {
            const ok = await confirm({
              title: "吊销全部令牌",
              description: `全部 ${tokens.length} 个令牌都会立即失效，正在使用它们的一切也会随之中断。此操作无法撤销。`,
              confirmText: "全部吊销",
              destructive: true,
            });
            if (ok) revokeAll.mutate();
          }}
          className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-destructive"
        >
          吊销全部令牌
        </button>
      )}
    </section>
  );
}
