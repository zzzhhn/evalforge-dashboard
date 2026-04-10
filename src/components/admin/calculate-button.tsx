"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { triggerCalculation } from "@/app/(main)/admin/analytics/action";
import { useLocale } from "@/lib/i18n/context";
import { useRouter } from "next/navigation";

const COOLDOWN_SECONDS = 10;

export function CalculateButton() {
  const { locale } = useLocale();
  const router = useRouter();
  const [cooldown, setCooldown] = useState(0);
  const [calculating, setCalculating] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const handleClick = useCallback(async () => {
    if (cooldown > 0 || calculating) return;
    setCalculating(true);

    const res = await triggerCalculation();
    if (res.success) {
      setCooldown(COOLDOWN_SECONDS);
      router.refresh();
    }

    setCalculating(false);
  }, [cooldown, calculating, router]);

  const disabled = cooldown > 0 || calculating;
  const label = calculating
    ? (locale === "zh" ? "计算中…" : "Calculating…")
    : cooldown > 0
      ? `${cooldown}s`
      : (locale === "zh" ? "计算评分" : "Calculate");

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={disabled}
      className="min-w-[90px]"
    >
      {label}
    </Button>
  );
}
