import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

import { usePrefs } from "@/lib/prefs";
import {
  checkKey,
  describeKey,
  explainProblem,
  pruneOverrides,
  RESERVED_KEYS,
  resolveKey,
  SHORTCUT_ACTIONS,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SettingsGroup } from "@/components/settings/SettingsGroup";

/**
 * ShortcutsSection — rebind the global single-key shortcuts.
 *
 * Only reachable when shortcuts are switched on, so the pane never offers to
 * configure something that isn't running.
 *
 * Keys are captured rather than typed: you press the key you want, which is the
 * only way to be sure the binding matches what your keyboard actually sends —
 * "/" is not the same keystroke on every layout.
 */
export function ShortcutsSection() {
  const { prefs, setPrefs } = usePrefs();
  const overrides = prefs.shortcutKeys ?? {};
  // Which row is listening, and what went wrong with the last keystroke.
  const [recording, setRecording] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; message: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const stop = () => setRecording(null);

  // While recording, the next keystroke is the binding — so it's captured on
  // the window, in the capture phase, before anything else can act on it
  // (including the app's own shortcuts, which are still live behind this pane).
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        // Escape cancels recording rather than binding itself — you can still
        // bind it, but you'd be doing it from the Clear row, where it already is.
        stop();
        setProblem(null);
        return;
      }
      const bad = checkKey(e.key, recording, overrides);
      if (bad) {
        setProblem({ id: recording, message: explainProblem(bad) });
        return; // keep listening, so a mis-hit doesn't cost the whole attempt
      }
      setPrefs({ shortcutKeys: pruneOverrides({ ...overrides, [recording]: e.key }) });
      setProblem(null);
      stop();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, overrides, setPrefs]);

  // Clicking away gives up rather than leaving a row armed and waiting.
  useEffect(() => {
    if (!recording) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) stop();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [recording]);

  const customised = Object.keys(pruneOverrides(overrides)).length > 0;

  return (
    <div className="space-y-2" ref={boxRef}>
      <SettingsGroup id="shortcuts.keys" title="按键" flat>
        <p className="text-xs text-muted-foreground">
          点击一个按键，然后按下你想使用的键。在输入框中打字时快捷键不会触发。
        </p>
        {SHORTCUT_ACTIONS.map((a) => {
          const key = resolveKey(overrides, a.id);
          const listening = recording === a.id;
          const changed = overrides[a.id] != null && overrides[a.id] !== a.defaultKey;
          return (
            <div key={a.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-muted-foreground">{a.label}</span>
                <div className="flex shrink-0 items-center gap-1.5">
                  {changed && (
                    <button
                      type="button"
                      title={`恢复为 ${describeKey(a.defaultKey)}`}
                      onClick={() => {
                        const next = { ...overrides };
                        delete next[a.id];
                        setPrefs({ shortcutKeys: pruneOverrides(next) });
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      重置
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setProblem(null);
                      setRecording(listening ? null : a.id);
                    }}
                    aria-label={`更改 ${a.label} 的按键`}
                    className={cn(
                      "min-w-[4.5rem] rounded-md border px-2 py-1 font-mono text-xs transition-colors",
                      listening
                        ? "border-primary bg-primary/10 text-primary"
                        : "hover:bg-accent",
                    )}
                  >
                    {listening ? "按下按键…" : describeKey(key)}
                  </button>
                </div>
              </div>
              {problem?.id === a.id && (
                <p className="text-right text-xs text-destructive">{problem.message}</p>
              )}
            </div>
          );
        })}
        {customised && (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => setPrefs({ shortcutKeys: {} })}
          >
            <RotateCcw className="h-3.5 w-3.5" /> 全部恢复默认
          </Button>
        )}
      </SettingsGroup>

      <SettingsGroup id="shortcuts.views" title="切换视图" flat>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{RESERVED_KEYS[0]}</span>–
          <span className="font-mono">{RESERVED_KEYS[RESERVED_KEYS.length - 1]}</span>{" "}
          按侧边栏中的排列顺序切换到对应视图。这些按键无法改绑：开启共享后列表会变化，绑定“第四个”的键会悄悄变成别的含义。
        </p>
      </SettingsGroup>
    </div>
  );
}
