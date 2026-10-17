import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  Keyboard,
  LayoutGrid,
  Palette,
  Bookmark as BookmarkIcon,
  Sparkles,
  SlidersHorizontal,
  Tag as TagIcon,
} from "lucide-react";

import {
  type AddButtonPosition,
  type CardSize,
  type ClockChoice,
  type DateOrder,
  usePrefs,
} from "@/lib/prefs";
import { type Task } from "@/lib/api";
import { setTagColor, tagColor } from "@/lib/tagColors";
import { deleteTemplate } from "@/lib/templates";
import { formatInterval } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/Segmented";
import { ColorField } from "@/components/ui/ColorPicker";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { SettingsGroup } from "@/components/settings/SettingsGroup";
import { ToggleRow } from "@/components/ui/ToggleRow";

/**
 * Per-user preferences that aren't strictly "theme".
 *
 * Grouped rather than listed: this pane had grown to two dozen switches in one
 * column, where finding "keyboard shortcuts" meant scrolling past every colour
 * and animation setting. Each group is shut until you want it, and remembers
 * that per device.
 */
export function PreferencesSection() {
  const { prefs, setPrefs } = usePrefs();

  return (
    <div className="space-y-2">
      <SettingsGroup
        id="prefs.time"
        title="时间与日期"
        icon={<CalendarClock />}
        flat
      >
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">时钟</Label>
          <Segmented
            value={prefs.clock}
            onChange={(v: ClockChoice) => setPrefs({ clock: v })}
            options={[
              { value: "auto", label: "自动", title: "跟随此设备的系统设置" },
              { value: "12", label: "12 小时制" },
              { value: "24", label: "24 小时制" },
            ]}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">日期格式</Label>
          <Segmented
            value={prefs.dateFormat}
            onChange={(v: DateOrder) => setPrefs({ dateFormat: v })}
            options={[
              { value: "auto", label: "自动", title: "跟随此设备的系统设置" },
              { value: "dmy", label: "13 Jun" },
              { value: "mdy", label: "Jun 13" },
              { value: "ymd", label: "2026-06-13" },
            ]}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          “自动”会跟随每台设备各自的系统设置。
        </p>
      </SettingsGroup>

      <SettingsGroup
        id="prefs.colours"
        title="任务颜色"
        icon={<Palette />}
        summary="由新到逾期，渐变"
      >
        <p className="text-xs text-muted-foreground">
          所有任务的默认颜色——每个任务可在其管理窗口中单独设置。
        </p>
        <div className="grid grid-cols-2 gap-2">
          <ColorField
            label="新近"
            value={prefs.taskColorFresh}
            onChange={(hex) => setPrefs({ taskColorFresh: hex })}
          />
          <ColorField
            label="已逾期"
            value={prefs.taskColorOverdue}
            onChange={(hex) => setPrefs({ taskColorOverdue: hex })}
          />
        </div>
        <div
          className="h-2 rounded-full"
          style={{
            background: `linear-gradient(90deg, ${prefs.taskColorFresh}, ${prefs.taskColorOverdue})`,
          }}
        />
        <ToggleRow
          label="颜色随时间渐变"
          hint="关闭后所有任务保持新近颜色，无需逐个任务冻结。"
          checked={prefs.colorFade}
          onChange={(v) => setPrefs({ colorFade: v })}
        />
        {prefs.colorFade && (
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs text-muted-foreground">
              无周期任务渐变：{prefs.noRoutineFadeDays} 天
            </Label>
            <input
              type="range"
              min={1}
              max={30}
              step={1}
              value={prefs.noRoutineFadeDays}
              onChange={(e) => setPrefs({ noRoutineFadeDays: Number(e.target.value) })}
              className="w-32 accent-primary"
              aria-label="无周期任务渐变到逾期所需天数"
            />
          </div>
        )}
      </SettingsGroup>

      <TagColoursGroup />

      <TemplatesGroup />

      <SettingsGroup
        id="prefs.layout"
        title="布局"
        icon={<LayoutGrid />}
        summary="卡片、分栏、面板"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">卡片尺寸</Label>
            <Select
              value={prefs.cardSize}
              onChange={(e) => setPrefs({ cardSize: e.target.value as CardSize })}
            >
              <option value="comfortable">舒适</option>
              <option value="compact">紧凑</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label
              className="text-xs text-muted-foreground"
              title="“自动”按列表实际可用空间显示尽可能多的分栏；隐藏日历或侧边栏时数量会随之变化"
            >
              分栏
            </Label>
            <Select
              value={prefs.taskColumns}
              onChange={(e) => setPrefs({ taskColumns: Number(e.target.value) })}
            >
              <option value={0}>自动</option>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {/* Lived under Task colours until now, which is nobody's first guess. */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">添加按钮（移动端）</Label>
          <Select
            value={prefs.addButton}
            onChange={(e) => setPrefs({ addButton: e.target.value as AddButtonPosition })}
          >
            <option value="top">右上角</option>
            <option value="bottom">底部（悬浮按钮）</option>
          </Select>
        </div>
        <ToggleRow
          label="显示日历"
          checked={prefs.showCalendar}
          onChange={(v) => setPrefs({ showCalendar: v })}
        />
        <ToggleRow
          label="显示活动图表"
          checked={prefs.showActivity}
          onChange={(v) => setPrefs({ showActivity: v })}
        />
        <ToggleRow
          label="任务统计"
          hint="任务的典型间隔、最长间隔及周期达成情况，显示在其管理窗口中"
          checked={prefs.showTaskStats}
          onChange={(v) => setPrefs({ showTaskStats: v })}
        />
        <ToggleRow
          label="在浏览器标签页上计数"
          hint="把已逾期和即将到期的任务数放进标签页标题，适合固定标签页"
          checked={prefs.tabBadge}
          onChange={(v) => setPrefs({ tabBadge: v })}
        />
        <ToggleRow
          label="窗口可拖动"
          checked={prefs.draggableWindows}
          onChange={(v) => setPrefs({ draggableWindows: v })}
        />
      </SettingsGroup>

      <SettingsGroup
        id="prefs.behaviour"
        title="快捷键与输入"
        icon={<Keyboard />}
        summary="右键、按键、快速添加"
      >
        <ToggleRow
          label="右键菜单"
          hint="右键点击任务（触屏上为长按）查看其操作。关闭后恢复浏览器自带菜单。"
          checked={prefs.contextMenu}
          onChange={(v) => setPrefs({ contextMenu: v })}
        />
        <ToggleRow
          label="键盘快捷键"
          hint="单键即可新建任务、搜索、切换视图——按 ? 查看列表"
          checked={prefs.keyboardShortcuts}
          onChange={(v) => setPrefs({ keyboardShortcuts: v })}
        />
        <ToggleRow
          label="快速添加"
          hint={'从新任务的名称中识别"every 2 weeks #home /Kitchen"等内容'}
          checked={prefs.quickAdd}
          onChange={(v) => setPrefs({ quickAdd: v })}
        />
        <ToggleRow
          label="提示通知"
          hint="操作后显示简短确认——打卡后的撤销也在这里出现"
          checked={prefs.toasts}
          onChange={(v) => setPrefs({ toasts: v })}
        />
        <ToggleRow
          label="使用浏览器对话框"
          hint="用系统确认框代替 Taskrr 自带的"
          checked={prefs.nativeDialogs}
          onChange={(v) => setPrefs({ nativeDialogs: v })}
        />
      </SettingsGroup>

      <SettingsGroup
        id="prefs.pickers"
        title="选择器"
        icon={<SlidersHorizontal />}
        summary="颜色、日期、时间输入"
      >
        <p className="text-[11px] text-muted-foreground">
          Taskrr 自带的选择器默认开启；关闭后使用设备的原生控件。
        </p>
        <ToggleRow
          label="自定义颜色选择器"
          hint="用色轮代替系统选色器"
          checked={prefs.colorPicker === "wheel"}
          onChange={(v) => setPrefs({ colorPicker: v ? "wheel" : "native" })}
        />
        <ToggleRow
          label="自定义日期选择器"
          hint="用日历代替系统日期输入"
          checked={prefs.datePicker}
          onChange={(v) => setPrefs({ datePicker: v })}
        />
        <ToggleRow
          label="自定义时间选择器"
          hint="用表盘代替系统时间输入"
          checked={prefs.timePicker}
          onChange={(v) => setPrefs({ timePicker: v })}
        />
      </SettingsGroup>

      <AnimationsGroup />
    </div>
  );
}

/**
 * The saved task templates, so they can be renamed away or cleared out.
 *
 * They are created from a task's right-click menu rather than here — a template
 * is made *from* something, so a form for typing one from scratch would just be
 * the new-task form again.
 */
function TemplatesGroup() {
  const { prefs, setPrefs } = usePrefs();
  const templates = prefs.taskTemplates ?? [];

  return (
    <SettingsGroup
      id="prefs.templates"
      title="任务模板"
      icon={<BookmarkIcon />}
      summary={templates.length > 0 ? `已保存 ${templates.length} 个` : "暂无"}
    >
      {templates.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          右键点击任务并选择<span className="font-medium">保存为模板</span>，即可在新任务中复用其设置。
        </p>
      ) : (
        templates.map((t) => (
          <div key={t.name} className="flex items-center justify-between gap-2 text-sm">
            <div className="min-w-0">
              <p className="truncate">{t.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {[
                  t.intervalSeconds != null ? `每 ${formatInterval(t.intervalSeconds)}` : "无周期",
                  t.folder ? `位于 ${t.folder}` : null,
                  t.tags.length > 0 ? t.tags.map((x) => `#${x}`).join(" ") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPrefs({ taskTemplates: deleteTemplate(templates, t.name) })}
              className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
            >
              删除
            </button>
          </div>
        ))
      )}
    </SettingsGroup>
  );
}

/**
 * A colour per tag, for lists that have outgrown one colour for all of them.
 *
 * Only tags in use are offered, and only tags somebody coloured are stored, so
 * the group is empty (and says so) until there are tags to colour.
 */
function TagColoursGroup() {
  const { prefs, setPrefs } = usePrefs();
  const queryClient = useQueryClient();
  const tasks = queryClient.getQueryData<Task[]>(["tasks"]) ?? [];
  // First spelling wins, matching how tags are de-duplicated elsewhere.
  const seen = new Map<string, string>();
  for (const t of tasks) for (const tag of t.tags) if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  const tags = [...seen.values()].sort((a, b) => a.localeCompare(b));
  const coloured = Object.keys(prefs.tagColors ?? {}).length;

  return (
    <SettingsGroup
      id="prefs.tagColours"
      title="标签颜色"
      icon={<TagIcon />}
      summary={coloured > 0 ? `已设 ${coloured} 个` : "统一颜色"}
    >
      {tags.length === 0 ? (
        <p className="text-xs text-muted-foreground">还没有标签。给任务添加标签后就会出现在这里。</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            未设置颜色的标签保持默认样式。
          </p>
          {tags.map((tag) => {
            const hex = tagColor(prefs.tagColors, tag);
            return (
              <div key={tag} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-muted-foreground">{tag}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  {hex && (
                    <button
                      type="button"
                      onClick={() => setPrefs({ tagColors: setTagColor(prefs.tagColors, tag, null) })}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      清除
                    </button>
                  )}
                  <ColorField
                    label=""
                    value={hex ?? prefs.taskColorFresh}
                    onChange={(v) => setPrefs({ tagColors: setTagColor(prefs.tagColors, tag, v) })}
                  />
                </div>
              </div>
            );
          })}
          {coloured > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => setPrefs({ tagColors: {} })}
            >
              清除全部标签颜色
            </Button>
          )}
        </>
      )}
    </SettingsGroup>
  );
}

/** The per-animation switches. The master toggle and speed mirror the ones in
 *  Theme (same preference, two homes); the granular switches let one kind of
 *  motion be turned off while the rest keep animating. */
function AnimationsGroup() {
  const { prefs, setPrefs } = usePrefs();
  const off = !prefs.animations; // granular toggles are moot with the master off

  return (
    <SettingsGroup
      id="prefs.animations"
      title="动画"
      icon={<Sparkles />}
      summary={prefs.animations ? "动效、速度" : "全部关闭"}
    >
      <ToggleRow
        label="所有动画"
        hint="总开关——关闭后禁用下方全部选项及背景"
        checked={prefs.animations}
        onChange={(v) => setPrefs({ animations: v })}
      />
      {prefs.animations && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">动画速度：{prefs.animationSpeed}×</Label>
          <input
            type="range"
            min={0.25}
            max={2}
            step={0.25}
            value={prefs.animationSpeed}
            onChange={(e) => setPrefs({ animationSpeed: Number(e.target.value) })}
            className="w-full accent-primary"
            aria-label="动画速度"
          />
        </div>
      )}
      <ToggleRow
        label="任务卡片移动"
        hint="卡片滑到新位置并淡入"
        checked={prefs.animGrid}
        disabled={off}
        onChange={(v) => setPrefs({ animGrid: v })}
      />
      <ToggleRow
        label="操作反馈"
        hint="快速打卡脉冲、计数弹跳、按钮按压效果"
        checked={prefs.animFeedback}
        disabled={off}
        onChange={(v) => setPrefs({ animFeedback: v })}
      />
      <ToggleRow
        label="滑动选中高亮"
        hint="在标签、视图和日历日期之间滑动的高亮气泡"
        checked={prefs.animIndicators}
        disabled={off}
        onChange={(v) => setPrefs({ animIndicators: v })}
      />
      <ToggleRow
        label="窗口与对话框"
        hint="打开、关闭和最小化的动效"
        checked={prefs.animWindows}
        disabled={off}
        onChange={(v) => setPrefs({ animWindows: v })}
      />
      <ToggleRow
        label="视图过渡"
        hint="顶栏交叉淡入、日历月份滑动、列表入场"
        checked={prefs.animViews}
        disabled={off}
        onChange={(v) => setPrefs({ animViews: v })}
      />
      <ToggleRow
        label="滚轮平滑滚动"
        hint="按显示器刷新率缓动鼠标滚轮步进（触控板和触摸保持原生）"
        checked={prefs.smoothScroll}
        disabled={off}
        onChange={(v) => setPrefs({ smoothScroll: v })}
      />
      <ToggleRow
        label="拖动或滚动时暂停背景"
        hint="仅在磨砂玻璃开启时生效，模糊的开销较大"
        checked={prefs.pauseBgOnDrag}
        disabled={off}
        onChange={(v) => setPrefs({ pauseBgOnDrag: v })}
      />
    </SettingsGroup>
  );
}
