import { AlertTriangle, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { statusTone, type Tone } from "@/lib/communicationsFlow";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-border text-muted-foreground",
  info: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  danger: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
};

export function ToneBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap font-medium", TONE_CLASS[tone], className)}>
      {children}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <ToneBadge tone={statusTone(status)}>{status.replace("_", " ")}</ToneBadge>;
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-10 text-center text-muted-foreground">
      <Inbox className="h-6 w-6" />
      <p className="font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-md text-sm">{hint}</p>}
    </div>
  );
}

export function LoadingRow({ label = "Loading…" }: { label?: string }) {
  return <p className="p-6 text-sm text-muted-foreground">{label}</p>;
}

export const formatDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : "—");
