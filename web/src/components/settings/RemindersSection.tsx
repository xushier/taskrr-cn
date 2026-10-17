import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/Toast";

const LEAD_OPTIONS: { label: string; value: number }[] = [
  { label: "到期时", value: 0 },
  { label: "提前 1 小时", value: 3600 },
  { label: "提前 6 小时", value: 21600 },
  { label: "提前 1 天", value: 86400 },
  { label: "提前 3 天", value: 259200 },
  { label: "提前 1 周", value: 604800 },
];

/** Reminders: deliver a webhook when one of your tasks comes due. */
export function RemindersSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data } = useQuery({ queryKey: ["reminders"], queryFn: api.getReminders });

  const [enabled, setEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [leadSeconds, setLeadSeconds] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  // Seed the form once from the server.
  useEffect(() => {
    if (data && !hydrated) {
      setEnabled(data.enabled);
      setWebhookUrl(data.webhookUrl);
      setLeadSeconds(data.leadSeconds);
      setHydrated(true);
    }
  }, [data, hydrated]);

  const apply = (s: { enabled: boolean; webhookUrl: string; leadSeconds: number }) => {
    setEnabled(s.enabled);
    setWebhookUrl(s.webhookUrl);
    setLeadSeconds(s.leadSeconds);
  };

  const save = useMutation({
    mutationFn: () => api.putReminders({ enabled, webhookUrl: webhookUrl.trim(), leadSeconds }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["reminders"], updated);
      apply(updated); // reflect any server-side normalisation
      toast("提醒已保存", { tone: "success" });
    },
  });
  const test = useMutation({
    mutationFn: () => api.testReminder(webhookUrl.trim()),
    onSuccess: () => toast("测试 Webhook 已发送", { tone: "success" }),
    onError: (e) => toast((e as Error).message, { tone: "error" }),
  });

  const canSave = !enabled || webhookUrl.trim() !== "";

  return (
    <SettingsGroup id="account.reminders" title="提醒" icon={<Bell />} summary="到期时发 Webhook">
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>任务到期时发送 Webhook</span>
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
        </label>
        <Input
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://ntfy.sh/your-topic"
          autoComplete="off"
          className="h-8"
        />
        <p className="text-[11px] text-muted-foreground">
          Taskrr 会向此 URL 发送 JSON 通知（标题 + 正文）。支持 ntfy、Apprise、Gotify、Discord/Slack
          Webhook、Home Assistant 等。
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">提醒时间</span>
          <select
            value={leadSeconds}
            onChange={(e) => setLeadSeconds(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            {LEAD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value} className="bg-background">
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={save.isPending || !canSave} onClick={() => save.mutate()}>
            {save.isPending ? "保存中…" : "保存"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={test.isPending || webhookUrl.trim() === ""}
            onClick={() => test.mutate()}
          >
            {test.isPending ? "发送中…" : "发送测试"}
          </Button>
          {save.isSuccess && <span className="text-xs text-emerald-500">已保存。</span>}
          {save.isError && <span className="text-xs text-destructive">{(save.error as Error).message}</span>}
          {test.isSuccess && <span className="text-xs text-emerald-500">已发送。</span>}
          {test.isError && <span className="text-xs text-destructive">{(test.error as Error).message}</span>}
        </div>
    </SettingsGroup>
  );
}
