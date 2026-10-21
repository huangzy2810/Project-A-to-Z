import {
  uid,
  type BookProject,
  type GenerationRecipe,
  type IllustrationVersion,
  type StoryPage,
} from "./model";
import {
  generationApprovalIssues,
  prepareGenerationRecipe,
  referenceAssets,
  MAX_REFERENCES,
  retryIdentityIssues,
  unselectedSceneCharacters,
} from "./recipe";
export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "canceled"
  | "paused"
  | "interrupted";
export interface GenerationJob {
  id: string;
  projectId: string;
  pageId: string;
  label: string;
  recipe: GenerationRecipe;
  mode: "auto" | "mock";
  allowLocked: boolean;
  status: JobStatus;
  error?: string;
  startedAt?: string;
  durationMs?: number;
}
export const pendingJob = (job: GenerationJob) =>
  job.status === "queued" || job.status === "running";
export const queueStorageKey = (projectId: string) =>
  `ava-book-generation-queue-v3:${projectId}`;
export function sceneRecipe(
  project: BookProject,
  page: StoryPage,
): GenerationRecipe {
  return {
    kind: "scene",
    characters: project.characters.filter((c) =>
      page.characterIds.includes(c.id),
    ),
    visualStyle: project.visualStyle,
    scene: page.sceneDescription,
    references: [],
    composition: `${page.compositionNotes} Leave negative space ${project.typography.defaultTextPosition === "top" ? "at the top" : "at the bottom"} for story text.`,
    requiredElements: page.requiredElements,
    exclusions: page.excludedElements,
  };
}
export function makeChapterJob(
  project: BookProject,
  page: StoryPage,
  allowLocked = false,
  retry = false,
): GenerationJob {
  if (page.status === "locked" && !allowLocked)
    throw new Error("Page is locked.");
  let recipe = sceneRecipe(project, page);
  if (retry) {
    const previous = page.illustrationVersions.find(
      (v) => v.id === page.selectedIllustrationId,
    );
    const issues = retryIdentityIssues(previous?.recipe, project.characters);
    if (issues.length) throw new Error(issues.join(" "));
    recipe = previous!.recipe!;
  }
  const issues = generationApprovalIssues(recipe);
  if (!recipe.scene.trim()) issues.push("Scene description is empty.");
  const missing = unselectedSceneCharacters(
    recipe.scene,
    project.characters,
    recipe.characters.map((c) => c.id),
  );
  if (missing.length)
    issues.push(
      `Select ${missing.join(", ")} under “Who appears in this scene?” or remove them from the scene description.`,
    );
  if (referenceAssets(recipe).length > MAX_REFERENCES)
    issues.push(`Use no more than ${MAX_REFERENCES} image references.`);
  if (issues.length) throw new Error(issues.join(" "));
  const chapterIndex = project.chapters.findIndex(
    (c) => c.id === page.chapterId,
  );
  return {
    id: uid(),
    projectId: project.id,
    pageId: page.id,
    label: `Chapter ${chapterIndex + 1} · Page ${page.pageNumber}`,
    recipe: structuredClone(prepareGenerationRecipe(recipe)),
    mode: project.generationMode || "auto",
    allowLocked: allowLocked && page.status === "locked",
    status: "queued",
  };
}
export function jobApprovalIssues(
  project: BookProject,
  job: GenerationJob,
): string[] {
  if (project.id !== job.projectId)
    return ["The queued book is no longer open."];
  const page = project.chapters
    .flatMap((c) => c.pages)
    .find((p) => p.id === job.pageId);
  if (!page) return ["The target page no longer exists."];
  if (page.status === "locked" && !job.allowLocked)
    return ["The target page was locked. Unlock it before retrying."];
  const issues = retryIdentityIssues(job.recipe, project.characters);
  const style = project.visualStyle;
  if (
    style.status !== "locked" ||
    style.previewImage !== job.recipe.visualStyle.previewImage ||
    style.description !== job.recipe.visualStyle.description ||
    JSON.stringify(style.referenceImages) !==
      JSON.stringify(job.recipe.visualStyle.referenceImages)
  )
    issues.push(
      "The approved visual style changed. Queue this page again with current approvals.",
    );
  return [...issues, ...generationApprovalIssues(job.recipe)];
}
export function applyQueuedVersion(
  project: BookProject,
  job: GenerationJob,
  version: IllustrationVersion,
): BookProject {
  const issues = jobApprovalIssues(project, job);
  if (issues.length) throw new Error(issues.join(" "));
  return {
    ...project,
    updatedAt: new Date().toISOString(),
    chapters: project.chapters.map((c) => ({
      ...c,
      pages: c.pages.map((p) =>
        p.id !== job.pageId
          ? p
          : {
              ...p,
              illustrationVersions: [...p.illustrationVersions, version],
              selectedIllustrationId: version.id,
              generatedPrompt: version.prompt,
            },
      ),
    })),
  };
}
export function bulkChapterJobs(
  project: BookProject,
  includeLocked: boolean,
  existing: GenerationJob[],
) {
  const jobs: GenerationJob[] = [];
  const skipped: string[] = [];
  for (const chapter of project.chapters)
    for (const page of chapter.pages) {
      const label = `${chapter.title} · Page ${page.pageNumber}`;
      if (existing.some((job) => job.pageId === page.id && pendingJob(job))) {
        skipped.push(`${label}: already queued.`);
        continue;
      }
      try {
        jobs.push(makeChapterJob(project, page, includeLocked));
      } catch (error) {
        skipped.push(
          `${label}: ${error instanceof Error ? error.message : "Not ready."}`,
        );
      }
    }
  return { jobs, skipped };
}
export function restoreQueue(
  raw: string | null,
  projectId: string,
): GenerationJob[] {
  if (!raw) return [];
  const value = JSON.parse(raw) as GenerationJob[];
  const statuses = [
    "queued",
    "running",
    "completed",
    "failed",
    "canceled",
    "paused",
    "interrupted",
  ];
  if (
    !Array.isArray(value) ||
    value.some(
      (j) =>
        !j ||
        j.projectId !== projectId ||
        typeof j.id !== "string" ||
        typeof j.pageId !== "string" ||
        typeof j.label !== "string" ||
        typeof j.allowLocked !== "boolean" ||
        (j.error !== undefined && typeof j.error !== "string") ||
        (j.durationMs !== undefined &&
          (!Number.isFinite(j.durationMs) || j.durationMs < 0)) ||
        !statuses.includes(j.status) ||
        !j.recipe ||
        typeof j.recipe.scene !== "string" ||
        !Array.isArray(j.recipe.characters) ||
        !j.recipe.visualStyle ||
        !Array.isArray(j.recipe.references) ||
        !["auto", "mock"].includes(j.mode),
    )
  )
    throw new Error(
      "The saved generation queue could not be read. Its data has been kept.",
    );
  return value.map((j) =>
    j.status === "running"
      ? {
          ...j,
          status: "interrupted",
          error:
            "The tab closed during generation. This request may have been charged; check existing results before choosing Retry.",
        }
      : j.status === "queued"
        ? { ...j, status: "paused" }
        : j,
  );
}
export class GenerationQueue {
  jobs: GenerationJob[];
  private running = false;
  private disposed = false;
  constructor(
    jobs: GenerationJob[],
    private execute: (job: GenerationJob) => Promise<void>,
    private changed: (jobs: GenerationJob[]) => void,
    private fatal: (error: unknown) => void,
  ) {
    this.jobs = jobs;
  }
  enqueue(jobs: GenerationJob[]) {
    for (const job of jobs)
      if (!this.jobs.some((j) => j.pageId === job.pageId && pendingJob(j)))
        this.jobs.push(job);
    this.publish();
    void this.pump();
  }
  stop() {
    this.jobs = this.jobs.map((j) =>
      j.status === "queued" ? { ...j, status: "canceled" } : j,
    );
    this.publish();
  }
  retry(id: string) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || pendingJob(job) || job.status === "completed") return;
    if (this.jobs.some((j) => j.pageId === job.pageId && pendingJob(j)))
      throw new Error("This page is already queued.");
    job.status = "queued";
    job.error = undefined;
    this.publish();
    void this.pump();
  }
  resume() {
    for (const job of this.jobs)
      if (
        job.status === "paused" &&
        !this.jobs.some(
          (j) => j.id !== job.id && j.pageId === job.pageId && pendingJob(j),
        )
      )
        job.status = "queued";
    this.publish();
    void this.pump();
  }
  dispose() {
    this.disposed = true;
  }
  private publish() {
    try {
      this.changed(structuredClone(this.jobs));
    } catch (error) {
      this.jobs = this.jobs.map((job) =>
        job.status === "queued"
          ? { ...job, status: "paused" }
          : job.status === "running"
            ? {
                ...job,
                status: "interrupted",
                error:
                  "Queue storage failed. Check existing results before choosing Retry.",
              }
            : job,
      );
      this.fatal(error);
      throw error;
    }
  }
  private async pump() {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      let job: GenerationJob | undefined;
      while (
        !this.disposed &&
        (job = this.jobs.find((j) => j.status === "queued"))
      ) {
        const started = Date.now();
        job.status = "running";
        job.startedAt = new Date(started).toISOString();
        this.publish();
        try {
          await this.execute(structuredClone(job));
          job.status = "completed";
        } catch (error) {
          job.status = "failed";
          job.error =
            error instanceof Error
              ? error.message
              : "Generation failed. Previous images are safe.";
        }
        job.durationMs = Date.now() - started;
        if (!this.disposed) this.publish();
      }
    } catch {
      // publish already halted the queue and reported the storage failure.
    } finally {
      this.running = false;
    }
  }
}
