/**
 * Small status chip that surfaces the preview of the project the Studio runs
 * in and its current lifecycle state. Rendered in the chat header so the
 * user sees the preview's state even during IDEATE, before the BUILD iframe
 * takes the right pane.
 *
 * No interaction in this version — it's a passive readout. Could later
 * become a button that scrolls/focuses the BUILD pane.
 */
import type { ResolvedPreview } from "./hooks/useResolvedPreview.js";

export function PreviewStatusChip({ preview }: { preview: ResolvedPreview }) {
  /* no-target = the agent hasn't shown a preview yet; render nothing so the
   * header stays clean during IDEATE. */
  if (preview.kind === "no-target") return null;

  const { label, tone, subject } = describe(preview);

  return (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium " +
        toneClasses(tone)
      }
      title={tooltipFor(preview)}
    >
      <span
        aria-hidden
        className={
          "inline-block h-1.5 w-1.5 rounded-full " +
          dotClasses(tone) +
          (tone === "starting" ? " animate-pulse" : "")
        }
      />
      <span className="truncate max-w-[10rem]">{subject}</span>
      <span className="text-muted-foreground">·</span>
      <span>{label}</span>
    </span>
  );
}

type Tone = "ready" | "starting" | "stopped" | "error";

const PREVIEW = "preview";

function describe(preview: Exclude<ResolvedPreview, { kind: "no-target" }>): {
  label: string;
  tone: Tone;
  subject: string;
} {
  switch (preview.kind) {
    case "ready":
      return { label: "running", tone: "ready", subject: PREVIEW };
    case "starting":
      return { label: "starting…", tone: "starting", subject: PREVIEW };
    case "project-stopped":
      return { label: "starting…", tone: "starting", subject: PREVIEW };
    case "preview-off":
      return { label: "off", tone: "stopped", subject: PREVIEW };
    case "loading":
      return { label: "checking…", tone: "starting", subject: PREVIEW };
    case "unknown-project":
      return { label: "no project", tone: "error", subject: PREVIEW };
    case "error":
      return { label: "unreachable", tone: "error", subject: "preview-server" };
  }
}

function tooltipFor(preview: ResolvedPreview): string | undefined {
  switch (preview.kind) {
    case "ready":
      return preview.url;
    case "project-stopped":
      return "Project is not running — starting it.";
    case "preview-off":
      return "Studio runs no stack of the project's own: preview comes with the Preview run.";
    case "starting":
      return "Reactor project is booting.";
    case "unknown-project":
      return preview.error;
    case "error":
      return preview.message;
    default:
      return undefined;
  }
}

function toneClasses(tone: Tone): string {
  switch (tone) {
    case "ready":
      return "border-vetra-primary/30 bg-vetra-primary/10 text-vetra-primary";
    case "starting":
      return "border-warning/30 bg-warning/10 text-warning";
    case "error":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case "stopped":
      return "border-border bg-accent text-muted-foreground";
  }
}

function dotClasses(tone: Tone): string {
  switch (tone) {
    case "ready":
      return "bg-vetra-primary";
    case "starting":
      return "bg-warning";
    case "error":
      return "bg-destructive";
    case "stopped":
      return "bg-muted-foreground";
  }
}
