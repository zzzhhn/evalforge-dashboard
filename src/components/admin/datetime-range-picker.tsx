"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Combine a required `YYYY-MM-DD` date with an optional `HH:MM:SS` time
 * into an ISO-8601 string. Missing H/M/S components fall through to the
 * supplied `timeDefault` (e.g. "00:00:00" for start, "23:59:59" for end).
 */
function combine(date: string, time: string, timeDefault: string): string | null {
  if (!date) return null;
  const [dh = "", dm = "", ds = ""] = (time || "").split(":");
  const [fh, fm, fs] = timeDefault.split(":");
  const hh = (dh || fh).padStart(2, "0");
  const mm = (dm || fm).padStart(2, "0");
  const ss = (ds || fs).padStart(2, "0");
  // Treat as local time so admins see "their" wall clock, not UTC drift.
  const iso = `${date}T${hh}:${mm}:${ss}`;
  const parsed = new Date(iso);
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function splitIso(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

interface Props {
  label: string;
  value: string | null;                  // ISO string or null
  onChange: (iso: string | null) => void;
  /** Time to fill in when user leaves the time input blank. */
  timeDefault: "00:00:00" | "23:59:59";
  required?: boolean;
}

/**
 * Date is required; time is optional (falls through to `timeDefault`).
 * Emits ISO 8601 when the date is valid, or null otherwise.
 */
export function DatetimeRangePicker({
  label,
  value,
  onChange,
  timeDefault,
  required,
}: Props) {
  const initial = useMemo(() => splitIso(value), [value]);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);

  // Keep internal state in sync when the parent resets (e.g. form reset).
  useEffect(() => {
    setDate(initial.date);
    setTime(initial.time);
  }, [initial.date, initial.time]);

  const emit = (d: string, tRaw: string) => {
    if (!d) {
      onChange(null);
      return;
    }
    const iso = combine(d, tRaw, timeDefault);
    onChange(iso);
  };

  return (
    <div>
      <label className="mb-1 block text-sm font-medium">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      <div className="flex gap-2">
        <Input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            emit(e.target.value, time);
          }}
          className="flex-1"
        />
        <Input
          type="time"
          step={1}
          value={time}
          placeholder={timeDefault}
          onChange={(e) => {
            setTime(e.target.value);
            emit(date, e.target.value);
          }}
          className="w-32"
        />
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        时间留空时默认 {timeDefault}
      </p>
    </div>
  );
}
