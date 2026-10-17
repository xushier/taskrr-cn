import { useMemo, useState } from "react";

import {
  csvToImportDocument,
  guessMapping,
  type CsvMapping,
  type CsvTable,
} from "@/lib/csv";
import { formatInterval } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

/**
 * CsvMapper — the column-mapping step for importing from another tracker.
 *
 * Every product exports a different shape, so there is no schema to detect,
 * only columns to be told about. The header names are guessed at because the
 * common case shouldn't need any clicking, but every guess is visible and
 * changeable before anything is sent.
 *
 * Nothing is imported from this screen directly: it hands back the same
 * taskrr-export-v1 document a JSON restore posts, so the CSV path inherits the
 * server's validation rather than being a second way in.
 */

const FIELDS: { key: keyof CsvMapping; label: string; hint?: string }[] = [
  { key: "name", label: "名称", hint: "必填" },
  { key: "description", label: "描述" },
  { key: "folder", label: "文件夹" },
  { key: "tags", label: "标签", hint: "以 , ; | 分隔" },
  { key: "interval", label: "周期" },
  { key: "lastDone", label: "上次打卡" },
];

const BARE_UNITS = [
  { value: "hour", label: "小时" },
  { value: "day", label: "天" },
  { value: "week", label: "周" },
  { value: "month", label: "月" },
  { value: "year", label: "年" },
] as const;

export function CsvMapper({
  table,
  fileName,
  busy,
  onCancel,
  onImport,
}: {
  table: CsvTable;
  fileName: string;
  busy: boolean;
  onCancel: () => void;
  onImport: (json: string) => void;
}) {
  const [mapping, setMapping] = useState<CsvMapping>(() => guessMapping(table.headers));
  const [bareUnit, setBareUnit] = useState<(typeof BARE_UNITS)[number]["value"]>("day");
  const [dayFirst, setDayFirst] = useState(false);

  // Converting is cheap and pure, so do it on every change: the summary below
  // is the real result, not an estimate of it.
  const { document, skipped } = useMemo(
    () => csvToImportDocument(table, mapping, { bareIntervalUnit: bareUnit, dayFirstDates: dayFirst }),
    [table, mapping, bareUnit, dayFirst],
  );

  // Only ask about bare-number units when the file actually has one, and only
  // about date order when a date is ambiguous — a setting nobody needs is
  // noise, and these are the two the file genuinely can't tell us.
  const intervalCells = mapping.interval >= 0
    ? table.rows.map((r) => (r[mapping.interval] ?? "").trim()).filter(Boolean)
    : [];
  const hasBareNumbers = intervalCells.some((c) => /^\d+(\.\d+)?$/.test(c));
  const dateCells = mapping.lastDone >= 0
    ? table.rows.map((r) => (r[mapping.lastDone] ?? "").trim()).filter(Boolean)
    : [];
  const hasAmbiguousDates = dateCells.some((c) => /^\d{1,2}[/.]\d{1,2}[/.]\d{4}/.test(c));

  const ready = mapping.name >= 0 && document.tasks.length > 0;
  const preview = document.tasks.slice(0, 3);

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div>
        <p className="text-sm font-medium">匹配各列</p>
        <p className="text-xs text-muted-foreground">
          {fileName} —— {table.rows.length} 行、{table.headers.length} 列。
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex items-center justify-between gap-2 text-xs">
            <span className="shrink-0">
              {f.label}
              {f.hint && <span className="ml-1 text-muted-foreground">({f.hint})</span>}
            </span>
            <Select
              value={mapping[f.key]}
              onChange={(e) => setMapping((m) => ({ ...m, [f.key]: Number(e.target.value) }))}
              className="h-8 min-w-0 flex-1 text-xs"
            >
              <option value={-1}>
                — 跳过 —
              </option>
              {table.headers.map((h, i) => (
                <option key={i} value={i}>
                  {h || `第 ${i + 1} 列`}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>

      {(hasBareNumbers || hasAmbiguousDates) && (
        <div className="flex flex-wrap items-center gap-3 border-t pt-2 text-xs">
          {hasBareNumbers && (
            <label className="flex items-center gap-1.5">
              周期列中的纯数字单位：
              <Select
                value={bareUnit}
                onChange={(e) => setBareUnit(e.target.value as typeof bareUnit)}
                className="h-8 text-xs"
              >
                {BARE_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {hasAmbiguousDates && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={dayFirst} onChange={(e) => setDayFirst(e.target.checked)} />
              日期为日/月/年顺序
            </label>
          )}
        </div>
      )}

      {preview.length > 0 && (
        <div className="space-y-1 border-t pt-2 text-xs">
          <p className="text-muted-foreground">前几行将导入为：</p>
          <ul className="space-y-0.5">
            {preview.map((t, i) => (
              <li key={i} className="truncate">
                <span className="font-medium">{t.name}</span>
                {t.intervalSeconds != null && (
                  <span className="text-muted-foreground"> · 每 {formatInterval(t.intervalSeconds)}</span>
                )}
                {t.folder && <span className="text-muted-foreground"> · 位于 {t.folder}</span>}
                {t.tags?.length ? (
                  <span className="text-muted-foreground"> · {t.tags.map((x) => `#${x}`).join(" ")}</span>
                ) : null}
                {t.completions?.length ? <span className="text-muted-foreground"> · 1 条打卡</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mapping.name < 0 && (
        <p className="text-xs text-destructive">请先选择任务名称所在的列。</p>
      )}

      {skipped.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            {skipped.length} 个问题需要先处理
          </summary>
          <ul className="mt-1 max-h-24 list-disc space-y-0.5 overflow-y-auto pl-4 text-muted-foreground">
            {skipped.slice(0, 30).map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!ready || busy}
          onClick={() => onImport(JSON.stringify(document))}
        >
          {busy ? "导入中…" : `导入 ${document.tasks.length} 个任务`}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  );
}
