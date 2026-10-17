import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Link2,
  MonitorSmartphone,
  Palette,
  ScrollText,
  Share2,
  Trash2,
  UserCheck,
  UserPlus,
  UserRoundPlus,
  UsersRound,
  Wrench,
  X,
} from "lucide-react";

import { api, type Invite, type LoginLayout, type SettingsPatch, type User } from "@/lib/api";
import { clearStoredPreferences } from "@/lib/prefs";
import { timeSince } from "@/lib/time";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/AuthProvider";
import { useWindows } from "@/components/windows/WindowManager";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_LAYOUTS } from "@/lib/layout";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { ToggleRow } from "@/components/ui/ToggleRow";

/** Whether an account still has an invitation someone could actually use. */
function inviteLive(u: User): boolean {
  return !!u.inviteExpiresAt && new Date(u.inviteExpiresAt).getTime() > Date.now();
}

/**
 * AdminPanel is the admin-only window body: registration controls + user
 * management (add / change role / reset password / delete). All actions go
 * through the /api/admin endpoints, which independently enforce admin rights.
 */
export function AdminPanel() {
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const lite = config?.lite ?? false;
  return (
    // No separators between the groups: each one is a bordered card, and a rule
    // between them was only ever there to break up the old flat list. It also
    // meant a hidden section (lite mode) or an empty one (nothing pending, one
    // user) left its <hr> behind as a stray line.
    <div className="space-y-2">
      {/* Lite mode is "I am the only person here", so the whole multi-user
          surface goes: registration, other accounts, sharing, merging. */}
      {!lite && <RegistrationSettings />}
      <OIDCSettings />
      {!lite && <SharingSettings />}
      <BrandingSettings />
      {/* Self-hiding: renders nothing when there is nothing waiting. */}
      {!lite && <PendingUsers />}
      {!lite && <Users />}
      <SessionsSection />
      {/* Self-hiding: needs at least two accounts to mean anything. */}
      {!lite && <MergeAccounts />}
      <AdvancedSettings />
      <LogsSection />
    </div>
  );
}

/** LogsView is the live log tail itself: polls while mounted (with a Live
 *  toggle) and auto-scrolls. Used inline in the collapsible section and as the
 *  body of the popped-out window. `fill` makes the log box grow to its
 *  container (the window); otherwise it's a fixed height. */
function LogsView({ fill = false }: { fill?: boolean }) {
  const [live, setLive] = useState(true);
  const { data: logs } = useQuery({
    queryKey: ["logs"],
    queryFn: () => api.listLogs(0),
    refetchInterval: live ? 4000 : false,
  });
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [logs, live]);

  return (
    <div className={cn("space-y-2", fill && "flex h-full flex-col")}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          自上次重启以来的服务器与访问日志，仅保存在内存中。
        </p>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
          实时
        </label>
      </div>
      <div
        ref={boxRef}
        className={cn(
          "overflow-auto rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed",
          fill ? "min-h-0 flex-1" : "h-64",
        )}
      >
        {logs?.length === 0 && <p className="text-muted-foreground">暂无日志。</p>}
        {logs?.map((e) => (
          <div key={e.seq} className="whitespace-pre-wrap break-all text-muted-foreground">
            {e.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Logs: a collapsible live tail (polls only while expanded), plus a "Pop out"
 *  button that opens the same view as a floating window — so logs can stay open
 *  while other settings windows are used to test changes. */
function LogsSection() {
  const [open, setOpen] = useState(false);
  const windows = useWindows();
  const popOut = () =>
    windows.open({ id: "logs", title: "日志", width: 560, content: <LogsView fill /> });

  return (
    <SettingsGroup id="admin.logs" title="日志" icon={<ScrollText />} summary="服务器与访问" onOpenChange={setOpen}>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={popOut}
            title="在悬浮窗口中打开日志"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" /> 弹出
          </button>
        </div>
        {open && <LogsView />}
    </SettingsGroup>
  );
}

/** Branding: instance name, tab title, tagline, a custom icon, and login-card
 *  toggles. Saved together; the live UI (sidebar, title, favicon) refreshes via
 *  the auth-config cache. */
function BrandingSettings() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const { data: config } = useQuery({ queryKey: ["auth-config"], queryFn: api.authConfig });
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [icon, setIcon] = useState("");
  const [hideIcon, setHideIcon] = useState(false);
  const [hideText, setHideText] = useState(false);
  const [layout, setLayout] = useState<LoginLayout>("centered");
  const [background, setBackground] = useState("");
  const [style, setStyle] = useState("");
  const [appLayout, setAppLayout] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const bgRef = useRef<HTMLInputElement>(null);

  // Seed the form from the server once.
  useEffect(() => {
    if (data && !hydrated) {
      setName(data.brand_name ?? "");
      setTitle(data.brand_title ?? "");
      setTagline(data.brand_tagline ?? "");
      setIcon(data.brand_icon ?? "");
      setHideIcon(data.login_hide_icon ?? false);
      setHideText(data.login_hide_text ?? false);
      setLayout((data.login_layout as LoginLayout) || "centered");
      setBackground(data.brand_background ?? "");
      setStyle(data.interface_style ?? "");
      setAppLayout(data.interface_layout ?? "");
      setHydrated(true);
    }
  }, [data, hydrated]);

  const save = useMutation({
    mutationFn: () =>
      api.putSettings({
        brand_name: name.trim(),
        brand_title: title.trim(),
        brand_tagline: tagline.trim(),
        brand_icon: icon,
        login_hide_icon: hideIcon,
        login_hide_text: hideText,
        login_layout: layout,
        brand_background: background,
        interface_style: style,
        interface_layout: appLayout,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(["settings"], next);
      queryClient.invalidateQueries({ queryKey: ["auth-config"] }); // refresh live branding
      toast("品牌设置已保存", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  // The instance background is a normal upload in the admin's own collection —
  // the setting just points at it — so there is no second storage path for
  // "the admin's picture", and the admin can reuse it for themselves too.
  const uploadBackground = useMutation({
    mutationFn: (file: File) => api.uploadBackground(file),
    onSuccess: (bg) => {
      setBackground(String(bg.id));
      queryClient.invalidateQueries({ queryKey: ["backgrounds"] });
      toast("已上传，保存后生效", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  // Downscale any uploaded image to a 128x128 PNG (cover) so the stored data
  // URL stays small (well under the server's 256 KB cap) and crisp as a favicon.
  function onPickFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const sizePx = 128;
        const c = document.createElement("canvas");
        c.width = sizePx;
        c.height = sizePx;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        const scale = Math.max(sizePx / img.width, sizePx / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (sizePx - w) / 2, (sizePx - h) / 2, w, h);
        setIcon(c.toDataURL("image/png"));
      };
      img.onerror = () => toast("该文件不是图片", { tone: "error" });
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  return (
    <SettingsGroup id="admin.branding" title="品牌" icon={<Palette />} summary="名称、图标、登录页">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">名称</Label>
          <Input value={name} placeholder="Taskrr" onChange={(e) => setName(e.target.value)} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">浏览器标签页标题</Label>
          <Input value={title} placeholder="（默认为名称）" onChange={(e) => setTitle(e.target.value)} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">标语</Label>
          <Input value={tagline} placeholder="上次完成时间追踪" onChange={(e) => setTagline(e.target.value)} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">图标</Label>
          <div className="flex items-center gap-2">
            {icon ? (
              <img src={icon} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <CheckCircle2 className="h-5 w-5" />
              </div>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              上传
            </Button>
            {icon && (
              <button
                type="button"
                onClick={() => setIcon("")}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                移除
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onPickFile(f);
              }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            用于标签页图标、侧边栏和登录卡片。建议使用正方形图片。
          </p>
        </div>
        <ToggleRow
          label="在登录页隐藏图标"
          checked={hideIcon}
          onChange={(v) => setHideIcon(v)}
        />
        <ToggleRow
          label="在登录页隐藏名称和标语"
          checked={hideText}
          onChange={(v) => setHideText(v)}
        />
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">背景图片</Label>
          <div className="flex flex-wrap items-center gap-2">
            {background ? (
              <img
                src={`/api/backgrounds/${background}`}
                alt=""
                className="h-9 w-16 shrink-0 rounded border object-cover"
              />
            ) : (
              <div className="flex h-9 w-16 shrink-0 items-center justify-center rounded border text-[10px] text-muted-foreground">
                无
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploadBackground.isPending}
              onClick={() => bgRef.current?.click()}
            >
              {uploadBackground.isPending ? "上传中…" : "上传"}
            </Button>
            {background && (
              <button
                type="button"
                onClick={() => setBackground("")}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                移除
              </button>
            )}
            <input
              ref={bgRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) uploadBackground.mutate(f);
              }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            显示在应用与登录页背后，适用于尚未自选背景的用户。保存后生效；在此移除不会删除你个人背景中的文件。
          </p>
        </div>
        {/* The instance's own look. Experimental, so the controls only exist
            where the operator opted in — and they set a default rather than a
            lock: anyone who picks for themselves keeps their choice. */}
        {config?.experimental && (
          <>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">界面风格</Label>
              <Select value={style} onChange={(e) => setStyle(e.target.value)}>
                <option value="">柔和（默认）</option>
                <option value="soft">柔和</option>
                <option value="flat">扁平</option>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                应用于登录页及尚未自选风格的用户。扁平风格会去掉圆角、阴影和毛玻璃效果。
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">布局</Label>
              <Select value={appLayout} onChange={(e) => setAppLayout(e.target.value)}>
                <option value="">侧边栏（默认）</option>
                {APP_LAYOUTS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label} — {l.hint}
                  </option>
                ))}
              </Select>
              <p className="text-[11px] text-muted-foreground">
                导航所在的位置，供尚未自选的账户使用。侧栏和顶栏在手机上同样可用；完整侧边栏在手机上以抽屉形式呈现。
              </p>
            </div>
          </>
        )}
        <div className="space-y-1">
          <Label>登录页布局</Label>
          <Select
           
            value={layout}
            onChange={(e) => setLayout(e.target.value as LoginLayout)}
          >
            <option value="centered">居中卡片</option>
            <option value="left">面板居左</option>
            <option value="right">面板居右</option>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            侧边面板让背景效果占据其余屏幕。无论选择哪种，手机上都是相同的全宽表单。
          </p>
        </div>
        <div className="flex justify-end">
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : "保存品牌设置"}
          </Button>
        </div>
    </SettingsGroup>
  );
}

const MERGE_SELECT = "h-7 rounded border border-input bg-transparent px-1.5 text-xs disabled:opacity-50";

/** Active sessions: who's signed in, when they were last active, and a control
 *  to sign a user out on all their devices. Refreshes while the panel is open. */
function SessionsSection() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const { data: sessions } = useQuery({
    queryKey: ["sessions"],
    queryFn: api.listSessions,
    // Fetch once so the collapsed summary can show a count, but only poll while open.
    refetchInterval: open ? 30_000 : false,
  });
  const terminate = useMutation({
    mutationFn: (userId: number) => api.terminateSessions(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      toast("已在所有设备退出登录，令牌已吊销", { tone: "success" });
    },
  });

  return (
    <SettingsGroup
      id="admin.sessions"
      title="活跃会话"
      icon={<MonitorSmartphone />}
      summary={sessions && sessions.length > 0 ? String(sessions.length) : undefined}
      onOpenChange={setOpen}
    >
        <p className="text-[11px] text-muted-foreground">
          显示谁已登录及最近访问时间。“终止”会让该用户在所有设备退出登录并吊销其 API 令牌，一次性封死泄露的账户。
        </p>
        {sessions?.length === 0 && <p className="text-xs text-muted-foreground">暂无活跃会话。</p>}
        <div className="space-y-1.5">
          {sessions?.map((s) => {
            // The primary admin can't be signed out by another admin.
            const locked = s.protected && !me?.protected;
            const isSelf = s.userId === me?.id;
            return (
              <div
                key={s.userId}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border px-2.5 py-1.5 text-sm"
              >
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate font-medium">{s.username}</span>
                  {s.role === "admin" && (
                    <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">管理员</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className="text-xs text-muted-foreground"
                    title={`最近访问 ${new Date(s.lastSeen).toLocaleString()}`}
                  >
                    {timeSince(s.lastSeen)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {s.sessions} 个会话
                  </span>
                  <button
                    type="button"
                    onClick={() => terminate.mutate(s.userId)}
                    disabled={locked || terminate.isPending}
                    title={
                      locked
                        ? "主管理员——受保护，其他管理员无法操作"
                        : isSelf
                          ? "这也会让你退出登录，并吊销你的令牌"
                          : "在所有设备退出登录并吊销 API 令牌"
                    }
                    className="whitespace-nowrap text-xs text-destructive hover:underline disabled:opacity-40 disabled:no-underline"
                  >
                    {isSelf ? "退出登录" : "终止"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {terminate.isError && <p className="text-xs text-destructive">{(terminate.error as Error).message}</p>}
    </SettingsGroup>
  );
}

/** Merge accounts: fold one account into another (e.g. an OIDC-provisioned
 *  account into a local one), moving data + the OIDC link, then deleting it. */
function MergeAccounts() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const [sourceId, setSourceId] = useState<number | "">("");
  const [targetId, setTargetId] = useState<number | "">("");
  const [moveData, setMoveData] = useState(true);
  const [keepUsername, setKeepUsername] = useState<"target" | "source">("target");

  const source = users?.find((u) => u.id === sourceId);
  const target = users?.find((u) => u.id === targetId);

  const merge = useMutation({
    mutationFn: () =>
      api.mergeUsers({
        sourceId: sourceId as number,
        targetId: targetId as number,
        moveData,
        newUsername: keepUsername === "source" ? source?.username : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries(); // users + tasks/activity may have moved
      setSourceId("");
      setTargetId("");
      toast("账户已合并", { tone: "success" });
    },
  });

  if (!users || users.length < 2) return null;
  // The source is deleted, so it can't be you or the protected primary admin.
  const sourceOptions = users.filter((u) => u.id !== me?.id && !u.protected);
  // The target can't be the protected primary admin either — a merge would graft
  // the source's OIDC identity onto it (the server rejects this too).
  const targetOptions = users.filter((u) => u.id !== sourceId && !u.protected);
  const ready = source && target && source.id !== target.id;

  const confirmMerge = async () => {
    if (!ready) return;
    const kept = keepUsername === "source" ? source!.username : target!.username;
    const dataMsg = moveData ? `将“${source!.username}”的任务移入“${target!.username}”` : `丢弃“${source!.username}”的任务`;
    if (
      await confirm({
        title: "合并账户",
        description:
          `将“${source!.username}”合并到“${target!.username}”？\n\n` +
          `${dataMsg}，并把其登录方式（含 OIDC 绑定）转移到“${target!.username}”，` +
          `保留用户名“${kept}”，最后删除“${source!.username}”。此操作不可撤销。`,
        confirmText: "合并",
        destructive: true,
      })
    ) {
      merge.mutate();
    }
  };

  return (
    <SettingsGroup id="admin.merge" title="合并账户" icon={<UserCheck />} summary="将一个账户并入另一个">
      <p className="text-xs text-muted-foreground">
        将一个账户并入另一个——例如把 OIDC 创建的账户并入本地账户，这样两种登录方式进入的是同一账户。
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">合并</span>
        <Select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : "")}
          className={MERGE_SELECT}
        >
          <option value="">账户…</option>
          {sourceOptions.map((u) => (
            <option key={u.id} value={u.id}>{u.username}</option>
          ))}
        </Select>
        <span className="text-muted-foreground">并入</span>
        <Select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : "")}
          className={MERGE_SELECT}
        >
          <option value="">账户…</option>
          {targetOptions.map((u) => (
            <option key={u.id} value={u.id}>{u.username}</option>
          ))}
        </Select>
      </div>
      <ToggleRow
          label="迁移被合并账户的任务"
          checked={moveData}
          onChange={(v) => setMoveData(v)}
        />
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">保留用户名：</span>
        <Select
          value={keepUsername}
          onChange={(e) => setKeepUsername(e.target.value as "target" | "source")}
          className={MERGE_SELECT}
          disabled={!ready}
        >
          <option value="target">{target?.username ?? "保留的账户"}</option>
          <option value="source">{source?.username ?? "被合并的账户"}</option>
        </Select>
      </div>
      {/* An account holds one OIDC link, so when both sides have one the
          merged account's identity is dropped — warn before the confirm. */}
      {ready && source?.oidcLinked && target?.oidcLinked && (
        <p className="text-xs text-amber-500">
          两个账户都绑定了 OIDC 身份。合并后“{target?.username}”保留自己的绑定，“{source?.username}”的 OIDC 登录将失效。
        </p>
      )}
      {merge.isError && <p className="text-xs text-destructive">{(merge.error as Error).message}</p>}
      {merge.isSuccess && <p className="text-xs text-emerald-500">账户已合并。</p>}
      <Button
        variant="outline"
        size="sm"
        className="border-destructive/50 text-destructive hover:bg-destructive/10"
        disabled={merge.isPending || !ready}
        onClick={confirmMerge}
      >
        {merge.isPending ? "合并中…" : "合并"}
      </Button>
    </SettingsGroup>
  );
}

/** Backups: create / download / delete snapshots, and restore from one (or an
 *  uploaded .db) — which restarts the server. */
function BackupsSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { data: backups } = useQuery({ queryKey: ["backups"], queryFn: api.listBackups });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["backups"] });
  const create = useMutation({
    mutationFn: () => api.createBackup(),
    onSuccess: () => {
      invalidate();
      toast("备份已创建", { tone: "success" });
    },
  });
  const del = useMutation({
    mutationFn: (name: string) => api.deleteBackup(name),
    onSuccess: () => {
      invalidate();
      toast("备份已删除", { tone: "success" });
    },
  });

  const [restarting, setRestarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // After a restore, the server restarts; reload so we re-authenticate against
  // the restored database.
  const onRestoreStarted = () => {
    setErr(null);
    setRestarting(true);
    setTimeout(() => window.location.reload(), 6000);
  };
  const restoreExisting = useMutation({
    mutationFn: (name: string) => api.restoreBackup(name),
    onSuccess: onRestoreStarted,
    onError: (e) => setErr((e as Error).message),
  });
  const restoreUpload = useMutation({
    mutationFn: (file: File) => api.restoreUpload(file),
    onSuccess: onRestoreStarted,
    onError: (e) => setErr((e as Error).message),
  });

  const confirmRestore = async (label: string, run: () => void) => {
    if (
      await confirm({
        title: "恢复备份",
        description:
          `从 ${label} 恢复？\n\n这将用备份替换所有当前数据并重启服务器。会先为当前数据创建一份安全备份。` +
          `所有人都会退出登录。\n\n继续吗？`,
        confirmText: "恢复",
        destructive: true,
      })
    ) {
      run();
    }
  };

  if (restarting) {
    return (
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">备份</h4>
        <div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">
          <p className="font-medium">恢复中…</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            服务器正在以恢复后的数据库重启。本页面将在几秒后自动刷新。
          </p>
        </div>
      </section>
    );
  }

  const busy = restoreExisting.isPending || restoreUpload.isPending;

  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">备份</h4>
      <p className="text-[11px] text-muted-foreground">
        完整的数据库快照，保存在 <code>data/backups</code>。恢复会替换所有数据并重启服务器（会先创建安全备份）。
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? "备份中…" : "创建备份"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          从文件恢复…
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".db,application/octet-stream"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) confirmRestore(`上传的文件“${f.name}”`, () => restoreUpload.mutate(f));
          }}
        />
      </div>
      {create.isError && <p className="text-xs text-destructive">{(create.error as Error).message}</p>}
      {err && <p className="text-xs text-destructive">{err}</p>}
      {backups && backups.length > 0 && (
        <div className="space-y-1">
          {backups.map((b) => (
            <div key={b.name} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
              <span className="min-w-0 flex-1 truncate font-mono">{b.name}</span>
              <span className="shrink-0 text-muted-foreground">{Math.max(1, Math.round(b.size / 1024))} KB</span>
              <a href={api.backupURL(b.name)} download className="shrink-0 text-primary hover:underline">
                下载
              </a>
              <button
                type="button"
                disabled={busy}
                onClick={() => confirmRestore(b.name, () => restoreExisting.mutate(b.name))}
                className="shrink-0 text-primary hover:underline disabled:opacity-50"
              >
                恢复
              </button>
              <button
                type="button"
                aria-label={`删除备份 ${b.name}`}
                disabled={del.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      title: "删除备份",
                      description: `删除备份 ${b.name}？此操作不可撤销。`,
                      confirmText: "删除",
                      destructive: true,
                    })
                  )
                    del.mutate(b.name);
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Advanced: backups + a danger zone of irreversible, instance-wide deletions. */
/** What an uploaded background may be. Numbers rather than a fixed policy,
 *  because "too big" depends on the box this is running on. */
function BackgroundLimits() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const [image, setImage] = useState("");
  const [total, setTotal] = useState("");
  const [hydrated, setHydrated] = useState(false);
  // Two number boxes side by side: without the pairing, "3" and "40" are all a
  // screen reader would have to go on.
  const imageId = useId();
  const totalId = useId();

  useEffect(() => {
    if (data && !hydrated) {
      setImage(String(data.bg_max_image_mb ?? 8));
      setTotal(String(data.bg_max_total_mb ?? 40));
      setHydrated(true);
    }
  }, [data, hydrated]);

  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => api.putSettings(patch),
    onSuccess: (next) => {
      queryClient.setQueryData(["settings"], next);
      queryClient.invalidateQueries({ queryKey: ["auth-config"] });
      setImage(String(next.bg_max_image_mb));
      setTotal(String(next.bg_max_total_mb));
      toast("已保存", { tone: "success" });
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold">背景图片</p>
      <p className="text-[11px] text-muted-foreground">
        上传的图片保存在数据库中，因此这些限制也决定了备份可能达到的大小。超出范围的值会被自动调整到范围内（单张图片 1–128 MB，每账户 1–4096 MB）。
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor={imageId} className="text-xs text-muted-foreground">
            单张图片（MB）
          </Label>
          <Input
            id={imageId}
            type="number"
            min={1}
            max={128}
            value={image}
            onChange={(e) => setImage(e.target.value)}
            className="h-8"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={totalId} className="text-xs text-muted-foreground">
            每账户（MB）
          </Label>
          <Input
            id={totalId}
            type="number"
            min={1}
            max={4096}
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="h-8"
          />
        </div>
      </div>
      <ToggleRow
        label="接受 SVG 上传"
        hint="默认关闭：SVG 可能携带脚本，且这些文件会展示给其他用户。开启后，SVG 会在相互隔离的源下提供，脚本无法访问本实例——但位图图片仍是更稳妥的选择。"
        checked={data?.bg_allow_svg ?? false}
        onChange={(v) => save.mutate({ bg_allow_svg: v })}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({ bg_max_image_mb: Number(image) || 1, bg_max_total_mb: Number(total) || 1 })
          }
        >
          {save.isPending ? "保存中…" : "保存限制"}
        </Button>
      </div>
    </section>
  );
}

function AdvancedSettings() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [msg, setMsg] = useState<string | null>(null);
  const wipe = useMutation({
    mutationFn: (opts: { tasks?: boolean; users?: boolean; everything?: boolean }) => api.adminWipe(opts),
    onSuccess: (res, vars) => {
      if (vars.everything) {
        // The server forgot everything (settings, prefs, themes) — drop the
        // browser's copies too and start clean, like a first visit.
        clearStoredPreferences();
        window.location.reload();
        return;
      }
      queryClient.invalidateQueries();
      setMsg(vars.users ? `完成——已删除 ${res.deletedUsers} 个用户及其数据。` : "完成——所有任务已清空。");
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const confirmWipe = async (opts: { tasks?: boolean; users?: boolean; everything?: boolean }, label: string) => {
    if (
      await confirm({
        title: "确认删除",
        description: `这将永久删除${label}。\n\n此操作不可撤销。继续吗？`,
        confirmText: "删除",
        destructive: true,
      })
    ) {
      setMsg(null);
      wipe.mutate(opts);
    }
  };
  const danger = "border-destructive/50 text-destructive hover:bg-destructive/10";

  return (
    <SettingsGroup id="admin.advanced" title="高级" icon={<Wrench />} summary="限制、备份、危险区域">
        <BackgroundLimits />
        <hr className="border-border/60" />
        <BackupsSection />
        <hr className="border-destructive/30" />
        <p className="text-xs font-semibold text-destructive">危险区域</p>
        <p className="text-xs text-muted-foreground">
          操作不可逆。你自己的管理员账户始终保留。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className={danger}
            disabled={wipe.isPending}
            onClick={() => confirmWipe({ tasks: true }, "所有用户的全部任务和历史")}
          >
            清空所有任务
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={danger}
            disabled={wipe.isPending}
            onClick={() => confirmWipe({ users: true }, "所有非管理员用户及其数据")}
          >
            删除非管理员用户
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={danger}
            disabled={wipe.isPending}
            onClick={() =>
              confirmWipe(
                { everything: true },
                "所有内容——所有其他账户、全部任务和历史、所有设置（含 OIDC）、偏好与提醒。仅保留你的管理员用户名和密码",
              )
            }
          >
            清空所有内容
          </Button>
        </div>
        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </SettingsGroup>
  );
}

function RegistrationSettings() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => api.putSettings(patch),
    onSuccess: (next) => queryClient.setQueryData(["settings"], next),
  });

  return (
    <SettingsGroup id="admin.registration" title="注册" icon={<UserRoundPlus />} flat>
      <ToggleRow
        label="允许本地注册（“注册”标签页）"
        checked={data?.reg_local ?? false}
        onChange={(v) => save.mutate({ reg_local: v })}
      />
      <ToggleRow
        label="OIDC 登录时自动创建账户"
        checked={data?.reg_oidc ?? true}
        onChange={(v) => save.mutate({ reg_oidc: v })}
      />
      <ToggleRow
        label="注册需管理员审批"
        hint="新注册的本地账户会进入队列，等待你批准"
        checked={data?.reg_approval ?? false}
        onChange={(v) => save.mutate({ reg_approval: v })}
      />
    </SettingsGroup>
  );
}

/** The gates on what an account may do for itself: share tasks, set its own
 *  background, mint API tokens. */
function SharingSettings() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const save = useMutation({
    mutationFn: (patch: SettingsPatch) => api.putSettings(patch),
    onSuccess: (next) => {
      queryClient.setQueryData(["settings"], next);
      // These gates are read from auth config all over the app, so the switch
      // has to reach that cache too or the section it hides stays on screen
      // until a reload.
      queryClient.invalidateQueries({ queryKey: ["auth-config"] });
    },
  });
  return (
    <SettingsGroup id="admin.sharing" title="用户可执行的操作" icon={<Share2 />} summary="共享、背景、令牌">
      <ToggleRow
        label="允许用户共享任务"
        hint="会增加“共享”操作和“共享 / 分享请求”视图。用户可单独退出。"
        checked={data?.tasks_shareable ?? false}
        onChange={(v) => save.mutate({ tasks_shareable: v })}
      />

      <ToggleRow
        label="允许用户设置自己的背景"
        hint="每个账户都可上传图片并选择一张作为应用背景。关闭后将完全隐藏该设置区，所有人都使用实例背景。"
        checked={data?.user_backgrounds ?? true}
        onChange={(v) => save.mutate({ user_backgrounds: v })}
      />

      <ToggleRow
        label="允许用户创建 API 令牌"
        hint="供脚本和智能家居使用。令牌只能访问任务和历史——无法进入管理区域。关闭后不能再创建新令牌；已有令牌在被吊销前继续有效。"
        checked={data?.api_tokens ?? true}
        onChange={(v) => save.mutate({ api_tokens: v })}
      />
    </SettingsGroup>
  );
}

/** Accounts awaiting approval (shown only when there are any). */
function PendingUsers() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: pending } = useQuery({
    queryKey: ["pending-users"],
    queryFn: api.listPending,
    refetchInterval: 15_000,
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["pending-users"] });
    queryClient.invalidateQueries({ queryKey: ["users"] });
  };
  const approve = useMutation({
    mutationFn: (v: { id: number; role: "admin" | "user" }) => api.approveUser(v.id, v.role),
    onSuccess: () => {
      invalidate();
      toast("已批准用户", { tone: "success" });
    },
  });
  const deny = useMutation({
    mutationFn: (id: number) => api.adminDeleteUser(id),
    onSuccess: () => {
      invalidate();
      toast("已拒绝请求", { tone: "success" });
    },
  });

  if (!pending || pending.length === 0) return null;

  return (
    <SettingsGroup
      id="admin.pending"
      title="待批准"
      icon={<UserCheck />}
      summary={<span className="text-amber-500">{pending.length} 人待审批</span>}
      defaultOpen
    >
      <div className="space-y-1.5">
        {pending.map((u) => (
          <PendingRow
            key={u.id}
            user={u}
            onApprove={(role) => approve.mutate({ id: u.id, role })}
            onDeny={() => deny.mutate(u.id)}
            busy={approve.isPending || deny.isPending}
          />
        ))}
      </div>
    </SettingsGroup>
  );
}

function PendingRow({
  user,
  onApprove,
  onDeny,
  busy,
}: {
  user: User;
  onApprove: (role: "admin" | "user") => void;
  onDeny: () => void;
  busy: boolean;
}) {
  const [role, setRole] = useState<"admin" | "user">("user");
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/40 px-2.5 py-1.5 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium">{user.username}</span>
      <Select
        value={role}
        onChange={(e) => setRole(e.target.value as "admin" | "user")}
        className="h-7 rounded px-1 text-xs"
      >
        <option value="user">用户</option>
        <option value="admin">管理员</option>
      </Select>
      <Button size="sm" disabled={busy} onClick={() => onApprove(role)}>
        批准
      </Button>
      <button
        type="button"
        disabled={busy}
        onClick={onDeny}
        className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
      >
        拒绝
      </button>
    </div>
  );
}

function OIDCSettings() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const [form, setForm] = useState<SettingsPatch>({});
  const [secret, setSecret] = useState("");

  // Saves the form fields plus any extra patch (the link-by-username toggle
  // saves itself immediately, like the Registration checkboxes).
  const save = useMutation({
    mutationFn: (extra: SettingsPatch | undefined) =>
      api.putSettings({ ...form, ...(secret ? { oidc_client_secret: secret } : {}), ...(extra ?? {}) }),
    onSuccess: (next, extra) => {
      queryClient.setQueryData(["settings"], next);
      setForm({});
      setSecret("");
      if (extra === undefined) toast("OIDC 设置已保存", { tone: "success" });
    },
  });

  // The visible value is the local edit (if any) else the saved value.
  const val = (k: keyof SettingsPatch & string) =>
    (form as Record<string, string>)[k] ??
    ((data as unknown as Record<string, unknown>)?.[k] as string) ??
    "";
  const field = (k: keyof SettingsPatch & string, label: string, placeholder?: string) => (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        value={val(k)}
        placeholder={placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
        className="h-8"
      />
    </div>
  );

  return (
    <SettingsGroup
      id="admin.oidc"
      title="单点登录（OIDC）"
      icon={<Link2 />}
      badge={
        <span className={data?.oidc_enabled ? "text-emerald-400" : "text-muted-foreground"}>
          {data?.oidc_enabled ? "已启用" : "未配置"}
        </span>
      }
      flat
    >
      {field("oidc_issuer", "签发方 URL", "https://auth.example.com/application/o/taskrr/")}
      <div className="grid grid-cols-2 gap-2">
        {field("oidc_client_id", "客户端 ID")}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">客户端密钥</Label>
          <Input
            type="password"
            value={secret}
            placeholder={data?.oidc_client_secret_set ? "••••••（已设置）" : ""}
            onChange={(e) => setSecret(e.target.value)}
            className="h-8"
          />
        </div>
      </div>
      {field("oidc_redirect_url", "回调 URL（可选）", "根据本站点自动检测")}
      <p className="text-[11px] text-muted-foreground">
        留空则自动检测（<code>https://&lt;this-site&gt;/api/auth/oidc/callback</code>）。所填地址必须已列入身份提供方的允许回调 URI 列表。
      </p>
      {field("oidc_admin_group", "管理员组（可选）", "taskrr-admins")}
      <ToggleRow
        label="首次登录时按用户名关联账户"
        hint="关闭（推荐）：首次 SSO 登录若与已有本地用户名相同则会被拒绝——用户可在设置中自行绑定 SSO。开启：将自动关联到该账户。"
        checked={data?.oidc_link_username ?? false}
        onChange={(v) => save.mutate({ oidc_link_username: v })}
      />
      {data?.oidc_enabled && (
        <ToggleRow
        label="仅允许 SSO 登录"
        hint="隐藏本地登录，所有人使用单点登录。主管理员仍可用密码登录，因此服务方故障不会把你锁在门外。"
        checked={data?.oidc_only ?? false}
        onChange={(v) => save.mutate({ oidc_only: v })}
      />
      )}
      <div className="flex justify-end">
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(undefined)}>
          {save.isPending ? "保存中…" : "保存 OIDC 设置"}
        </Button>
      </div>
      {save.isError && <p className="text-xs text-destructive">{(save.error as Error).message}</p>}
    </SettingsGroup>
  );
}

function Users() {
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { prompt } = useConfirm();
  const { data: users } = useQuery({ queryKey: ["users"], queryFn: api.listUsers });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  // The invitation to hand over, shown once. The token is only readable in the
  // response that created it, so it lives here until it's been passed on.
  const [invite, setInvite] = useState<{ username: string; link: Invite } | null>(null);

  const create = useMutation({
    mutationFn: () => api.adminCreateUser({ username: name.trim(), password: pw, role }),
    onSuccess: (u) => {
      setInvite(u.invite ? { username: u.username, link: u.invite } : null);
      setName("");
      setPw("");
      setRole("user");
      invalidate();
    },
  });
  const update = useMutation({
    mutationFn: (v: { id: number; role?: "admin" | "user"; password?: string }) =>
      api.adminUpdateUser(v.id, { role: v.role, password: v.password }),
    onSuccess: () => {
      invalidate();
      toast("已保存", { tone: "success" });
    },
  });
  // A link that lapsed, never arrived, or belongs to an account made before
  // invitations existed. Issuing a new one retires the old.
  const reinvite = useMutation({
    mutationFn: async (u: User) => ({ username: u.username, link: await api.adminInviteUser(u.id) }),
    onSuccess: (v) => {
      setInvite(v);
      invalidate();
    },
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  const copyInvite = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast("邀请链接已复制", { tone: "success" });
    } catch {
      // Clipboard access needs a secure context, which a LAN instance on plain
      // HTTP won't have — the link stays selectable on screen either way.
      toast("复制失败——请手动选中链接复制", { tone: "error" });
    }
  };

  const remove = useMutation({
    mutationFn: (id: number) => api.adminDeleteUser(id),
    onSuccess: () => {
      invalidate();
      toast("用户已删除", { tone: "success" });
    },
  });

  const resetPassword = async (u: User) => {
    const next = await prompt({
      title: "重置密码",
      description: `为 ${u.username} 设置新密码（至少 8 个字符）。这会让他们在所有设备退出登录并吊销其 API 令牌：`,
      inputType: "password",
      placeholder: "新密码",
      confirmText: "设置密码",
    });
    if (next) update.mutate({ id: u.id, password: next });
  };

  return (
    <SettingsGroup
      id="admin.users"
      title="用户"
      icon={<UsersRound />}
      summary={users && users.length > 0 ? String(users.length) : undefined}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
        className="space-y-2 rounded-lg border p-3"
      >
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">用户名</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">密码（可选）</Label>
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} className="h-8" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          密码留空则改为生成邀请链接——打开链接的人可自行设置密码。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "user")}
            className="h-8"
          >
            <option value="user">用户</option>
            <option value="admin">管理员</option>
          </Select>
          <Button type="submit" size="sm" className="shrink-0" disabled={create.isPending || !name.trim()}>
            <UserPlus /> 添加用户
          </Button>
        </div>
        {create.isError && <p className="text-xs text-destructive">{(create.error as Error).message}</p>}
      </form>

      {invite && (
        <div className="space-y-1.5 rounded-lg border border-primary/40 bg-primary/10 p-2">
          <p className="text-xs font-medium">
            把这个发给 {invite.username}——它只显示一次。
          </p>
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 select-all break-all rounded bg-background/60 px-1.5 py-1 text-[11px]">
              {invite.link.url}
            </code>
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7 shrink-0"
              aria-label="复制邀请链接"
              onClick={() => copyInvite(invite.link.url)}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            仅可使用一次，且 {new Date(invite.link.expiresAt).toLocaleDateString()} 前有效。你可以随时从下方列表重新签发。
          </p>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => setInvite(null)}>
            完成
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        {users?.map((u) => {
          // The primary admin's controls are locked for *other* admins.
          const locked = u.protected && !me?.protected;
          const isSelf = u.id === me?.id;
          return (
            <div
              key={u.id}
              className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md border px-2.5 py-1.5 text-sm"
            >
              {/* Name + badges grow and share the first line; the controls cluster
                  stays together and wraps to its own line on narrow widths. The
                  name keeps a floor of its own, so a row with every control on it
                  wraps rather than truncating someone down to three letters. */}
              <div className="flex min-w-[7rem] flex-1 items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-medium">{u.username}</span>
                {u.protected && (
                  <span
                    className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary"
                    title="主管理员——其他管理员无法更改"
                  >
                    主管理员
                  </span>
                )}
                {!u.passwordSet && !u.oidcLinked && (
                  <span
                    className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-500"
                    title={
                      inviteLive(u)
                        ? `已邀请——链接 ${new Date(u.inviteExpiresAt as string).toLocaleString()} 前有效`
                        : "等待设置且没有可用邀请——请发送新链接"
                    }
                  >
                    {inviteLive(u) ? "已邀请" : "需要链接"}
                  </span>
                )}
                {u.oidcLinked && (
                  <span className="shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-500" title="已绑定 OIDC 身份">
                    oidc
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Select
                  value={u.role}
                  disabled={isSelf || locked}
                  onChange={(e) => update.mutate({ id: u.id, role: e.target.value as "admin" | "user" })}
                  className="h-7 rounded px-1 text-xs disabled:opacity-50"
                >
                  <option value="user">用户</option>
                  <option value="admin">管理员</option>
                </Select>
                {!u.passwordSet && !u.oidcLinked && (
                  <button
                    type="button"
                    onClick={() => reinvite.mutate(u)}
                    disabled={locked || reinvite.isPending}
                    title="创建新的邀请链接（旧链接随之失效）"
                    aria-label={`为 ${u.username} 创建新邀请链接`}
                    className="whitespace-nowrap text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
                  >
                    邀请链接
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => resetPassword(u)}
                  disabled={locked}
                  className="whitespace-nowrap text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground"
                >
                  重置密码
                </button>
                <button
                  type="button"
                  onClick={() => remove.mutate(u.id)}
                  disabled={isSelf || locked}
                  aria-label={`删除 ${u.username}`}
                  className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {(update.isError || remove.isError) && (
        <p className="text-xs text-destructive">
          {((update.error || remove.error) as Error)?.message}
        </p>
      )}
    </SettingsGroup>
  );
}
