"use client";

import { useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";
import { updateSystemConfigs, type ConfigEntry } from "@/app/(main)/admin/settings/action";

const CONFIG_LABELS: Record<string, { zh: string; en: string; unit: string; step: number; min: number; max: number }> = {
  "anti_cheat.min_watch_ratio": {
    zh: "最低视频观看比例",
    en: "Min Watch Ratio",
    unit: "",
    step: 0.05,
    min: 0,
    max: 1,
  },
  "anti_cheat.min_dwell_multiplier": {
    zh: "最低停留时间倍率（视频时长 × 倍率 × 1000 = ms）",
    en: "Min Dwell Multiplier (duration × multiplier × 1000 = ms)",
    unit: "×",
    step: 0.1,
    min: 0,
    max: 5,
  },
  "anti_cheat.min_dwell_floor_ms": {
    zh: "最低停留时间下限",
    en: "Min Dwell Floor",
    unit: "ms",
    step: 1000,
    min: 0,
    max: 60000,
  },
  "anti_cheat.max_submits_per_hour": {
    zh: "每小时最大提交数",
    en: "Max Submissions / Hour",
    unit: "",
    step: 5,
    min: 1,
    max: 500,
  },
  "anti_cheat.fixed_value_threshold": {
    zh: "固定值检测阈值（同一评分占比超过此值 → 可疑）",
    en: "Fixed Value Threshold (dominant ratio above this → suspicious)",
    unit: "",
    step: 0.05,
    min: 0.5,
    max: 1,
  },
  "anti_cheat.low_variance_threshold": {
    zh: "低方差检测阈值（标准差低于此值 → 可疑）",
    en: "Low Variance Threshold (stddev below this → suspicious)",
    unit: "",
    step: 0.1,
    min: 0,
    max: 3,
  },
  "anti_cheat.recent_scores_window": {
    zh: "近期评分检测窗口",
    en: "Recent Scores Window",
    unit: "",
    step: 5,
    min: 5,
    max: 100,
  },
};

const TOGGLE_LABELS: Record<string, { zhLabel: string; enLabel: string }> = {
  "display.hide_model_for_internal": {
    zhLabel: "对内部标注员隐藏模型名称",
    enLabel: "Hide model name for internal annotators",
  },
  "display.hide_model_for_vendor": {
    zhLabel: "对外部标注员隐藏模型名称",
    enLabel: "Hide model name for vendor annotators",
  },
};

interface Props {
  configs: ConfigEntry[];
}

export function SettingsClient({ configs }: Props) {
  const { locale, t } = useLocale();
  const antiCheatConfigs = configs.filter((c) => c.key.startsWith("anti_cheat."));
  const displayConfigs = configs.filter((c) => c.key.startsWith("display."));
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(configs.map((c) => [c.key, c.value]))
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = useCallback((key: string, val: number) => {
    setValues((prev) => ({ ...prev, [key]: val }));
    setSaved(false);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSaved(false);

    const updates = Object.entries(values).map(([key, value]) => ({ key, value }));
    const result = await updateSystemConfigs(updates);

    if (result.success) {
      setSaved(true);
    } else {
      setError(result.error ?? "Save failed");
    }
    setSaving(false);
  }, [values]);

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardContent className="p-6 space-y-1">
          <h2 className="text-lg font-semibold mb-4">
            {t("admin.settings.antiCheat")}
          </h2>

          <div className="space-y-5">
            {antiCheatConfigs.map((cfg) => {
              const meta = CONFIG_LABELS[cfg.key];
              if (!meta) return null;
              const currentVal = values[cfg.key] ?? cfg.value;

              return (
                <div key={cfg.key} className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <label className="text-sm font-medium">
                      {locale === "zh" ? meta.zh : meta.en}
                    </label>
                    <span className="font-mono text-sm text-muted-foreground">
                      {currentVal}{meta.unit}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={meta.min}
                    max={meta.max}
                    step={meta.step}
                    value={currentVal}
                    onChange={(e) => handleChange(cfg.key, Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>{meta.min}{meta.unit}</span>
                    <span>{meta.max}{meta.unit}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-1">
          <h2 className="text-lg font-semibold mb-4">
            {t("admin.settings.display")}
          </h2>
          <div className="space-y-4">
            {displayConfigs.map((cfg) => {
              const meta = TOGGLE_LABELS[cfg.key];
              if (!meta) return null;
              const isOn = (values[cfg.key] ?? cfg.value) === 1;
              return (
                <div key={cfg.key} className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    {locale === "zh" ? meta.zhLabel : meta.enLabel}
                  </label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isOn}
                    onClick={() => { handleChange(cfg.key, isOn ? 0 : 1); }}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                      isOn ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200 ${
                        isOn ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? t("admin.settings.saving") : t("admin.settings.save")}
        </Button>
        {saved && (
          <span className="text-sm text-green-600 dark:text-green-400">
            ✓ {t("admin.settings.saved")}
          </span>
        )}
        {error && (
          <span className="text-sm text-destructive">{error}</span>
        )}
      </div>
    </div>
  );
}
