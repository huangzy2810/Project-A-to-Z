"use client";
import { useState } from "react";
import type { BookProject } from "@/lib/model";
import {
  bulkChapterJobs,
  pendingJob,
  type GenerationJob,
} from "@/lib/generation-queue";
export function GenerationQueuePanel({
  jobs,
  disabled,
  onStop,
  onResume,
  onRetry,
}: {
  jobs: GenerationJob[];
  disabled: boolean;
  onStop: () => void;
  onResume: () => void;
  onRetry: (id: string) => void;
}) {
  if (!jobs.length) return null;
  const active = jobs.filter(pendingJob).length;
  return (
    <details className="generation-queue" open aria-label="Illustration queue">
      <summary>
        Illustration queue · {active} waiting or generating ·{" "}
        {jobs.filter((j) => j.status === "completed").length} ready ·{" "}
        {
          jobs.filter(
            (j) => j.status === "failed" || j.status === "interrupted",
          ).length
        }{" "}
        need attention
      </summary>
      <p>
        One image runs at a time. You can navigate and queue other pages. Each
        job uses the text and references saved when queued. Keep this tab open;
        closing it interrupts processing.
      </p>
      {active > 0 && (
        <button disabled={disabled} onClick={onStop}>
          Stop after current image
        </button>
      )}
      {jobs.some((j) => j.status === "paused") && (
        <button disabled={disabled} onClick={onResume}>
          Resume waiting jobs
        </button>
      )}
      <ol aria-live="polite">
        {jobs.map((job) => (
          <li key={job.id}>
            <span>
              <strong>{job.label}</strong> —{" "}
              {job.status === "completed"
                ? "Ready"
                : job.status === "running"
                  ? "Generating"
                  : job.status[0].toUpperCase() + job.status.slice(1)}
              {job.durationMs !== undefined &&
                ` · ${(job.durationMs / 1000).toFixed(1)}s`}
              {job.error && <small>{job.error}</small>}
            </span>
            {["failed", "interrupted", "canceled"].includes(job.status) && (
              <button
                disabled={
                  disabled ||
                  jobs.some((j) => j.pageId === job.pageId && pendingJob(j))
                }
                onClick={() => onRetry(job.id)}
                aria-label={`Retry ${job.label}`}
              >
                Retry
              </button>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
export function BulkRegeneration({
  project,
  jobs,
  disabled,
  onQueue,
}: {
  project: BookProject;
  jobs: GenerationJob[];
  disabled: boolean;
  onQueue: (jobs: GenerationJob[]) => void;
}) {
  const [includeLocked, setIncludeLocked] = useState(false);
  const plan = bulkChapterJobs(project, includeLocked, jobs);
  return (
    <details className="generation-queue">
      <summary>Regenerate all chapter illustrations</summary>
      <p>
        Queue pages across every chapter with current scene text, approved
        character sheets and visual style, using the current illustration mode.
        Previous versions stay saved. New results become the selected
        illustrations. AI jobs use API credits.
      </p>
      <label>
        <input
          type="checkbox"
          checked={includeLocked}
          disabled={disabled}
          onChange={(e) => setIncludeLocked(e.target.checked)}
        />{" "}
        Include locked pages and replace their selected illustrations. Pages
        remain locked.
      </label>
      <p>
        {plan.jobs.length} ready to queue · {plan.skipped.length} skipped
      </p>
      {plan.skipped.length > 0 && (
        <details>
          <summary>Why pages are skipped</summary>
          <ul>
            {plan.skipped.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </details>
      )}
      <button
        disabled={disabled || !plan.jobs.length}
        onClick={() => onQueue(plan.jobs)}
      >
        Queue {plan.jobs.length} chapter illustrations
      </button>
    </details>
  );
}
