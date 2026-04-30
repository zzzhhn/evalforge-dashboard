"use client";

// Global undo toast manager. One Provider lives at the app shell (layout),
// any component can call `useUndoToast().push(...)` to enqueue a reversible
// action. The toast stays visible across client navigation (it lives in
// the layout, not the page), each toast runs its own timer, and multiple
// toasts stack so rapid deletes don't overwrite each other.
//
// Design notes:
//   - State lives in a React Context + portal-rendered toast strip at the
//     bottom-center of the viewport. Portal isn't strictly required since
//     the layout wraps all pages, but renders outside normal flow so the
//     toast floats above everything.
//   - Each toast has its own `setTimeout` + 200ms tick for the countdown
//     label. When the timer fires, the onExpire callback is invoked
//     (typically a no-op — the original soft-delete action already made
//     the change; "expire" just means "user didn't undo, so the window
//     closes silently").
//   - Clicking Undo calls `onUndo()` which the caller wires to the
//     appropriate server action (e.g. `undoDeletePackage(id)`), then
//     removes the toast from the stack.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { RotateCcw, X } from "lucide-react";

interface UndoToastEntry {
  id: string;
  label: string; // e.g. "任务 LTX2.3 已删除"
  /** Called when user clicks Undo. Should return a Promise that resolves
   *  once the reversal succeeded (or rejects on error — toast stays and
   *  shows the error). */
  onUndo: () => Promise<void> | void;
  /** Optional — called when the timer runs out without user intervention.
   *  Almost always a no-op (the original delete action already ran). */
  onExpire?: () => void;
  /** Milliseconds total duration. Default 30 000. */
  durationMs?: number;
  /** Internal — absolute unix ms timestamp when this toast expires. */
  expiresAt: number;
}

interface UndoToastApi {
  /** Enqueue a new undo toast. Returns the toast id so callers can
   *  dismiss it programmatically (rare — the timer handles most cases). */
  push: (entry: Omit<UndoToastEntry, "id" | "expiresAt">) => string;
  /** Remove a toast by id without triggering onExpire. Used after a
   *  successful undo. */
  dismiss: (id: string) => void;
}

const UndoToastContext = createContext<UndoToastApi | null>(null);

export function useUndoToast(): UndoToastApi {
  const ctx = useContext(UndoToastContext);
  if (!ctx) {
    throw new Error(
      "useUndoToast must be used inside <UndoToastProvider>. " +
        "Check that the main layout wraps children with the provider.",
    );
  }
  return ctx;
}

export function UndoToastProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [entries, setEntries] = useState<UndoToastEntry[]>([]);
  const [mounted, setMounted] = useState(false);
  // Keep a ref of latest entries so the setInterval tick reads fresh data
  // without needing to re-create the timer on every entry change.
  const entriesRef = useRef<UndoToastEntry[]>([]);
  entriesRef.current = entries;

  useEffect(() => setMounted(true), []);

  // Single shared tick — sweeps expired toasts + triggers onExpire. 500ms
  // is smooth enough for a human-readable "Ns left" countdown and cheap.
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      const expired: UndoToastEntry[] = [];
      const kept: UndoToastEntry[] = [];
      for (const e of entriesRef.current) {
        if (e.expiresAt <= now) expired.push(e);
        else kept.push(e);
      }
      if (expired.length > 0) {
        for (const e of expired) e.onExpire?.();
        setEntries(kept);
      }
      if (kept.length > 0) {
        // Force re-render for countdown label. Cheap: a few toasts max.
        setEntries((prev) => (prev === kept ? [...prev] : prev));
      }
    }, 500);
    return () => clearInterval(tick);
  }, []);

  const push = useCallback<UndoToastApi["push"]>(
    (entry) => {
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `undo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const durationMs = entry.durationMs ?? 30_000;
      const full: UndoToastEntry = {
        ...entry,
        id,
        expiresAt: Date.now() + durationMs,
      };
      setEntries((prev) => [...prev, full]);
      return id;
    },
    [],
  );

  const dismiss = useCallback<UndoToastApi["dismiss"]>((id) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const api = useMemo<UndoToastApi>(
    () => ({ push, dismiss }),
    [push, dismiss],
  );

  return (
    <UndoToastContext.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          <UndoToastStrip entries={entries} dismiss={dismiss} />,
          document.body,
        )}
    </UndoToastContext.Provider>
  );
}

function UndoToastStrip({
  entries,
  dismiss,
}: {
  entries: UndoToastEntry[];
  dismiss: (id: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] flex -translate-x-1/2 flex-col-reverse gap-2">
      {entries.map((e) => (
        <UndoToastCard key={e.id} entry={e} onDismiss={() => dismiss(e.id)} />
      ))}
    </div>
  );
}

function UndoToastCard({
  entry,
  onDismiss,
}: {
  entry: UndoToastEntry;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const remainingMs = Math.max(0, entry.expiresAt - Date.now());
  const remainingSec = Math.ceil(remainingMs / 1000);

  const handleUndo = async () => {
    setBusy(true);
    try {
      await entry.onUndo();
      onDismiss();
    } catch (err) {
      // Log but keep toast visible so user can retry. The underlying
      // action should have surfaced a human-readable error via alert().
      console.error("[undo-toast] undo failed:", err);
      setBusy(false);
    }
  };

  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="text-sm">{entry.label}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {remainingSec}s
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={handleUndo}
        className="h-7 gap-1 px-2 text-xs"
      >
        <RotateCcw className="h-3 w-3" strokeWidth={1.75} />
        {busy ? "…" : "Undo"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={onDismiss}
        className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-3 w-3" strokeWidth={2} />
      </Button>
    </div>
  );
}
