import test from "node:test";
import assert from "node:assert/strict";
import { createProject, newPage, type IllustrationVersion } from "../lib/model";
import {
  GenerationQueue,
  makeChapterJob,
  bulkChapterJobs,
  restoreQueue,
  applyQueuedVersion,
  jobApprovalIssues,
} from "../lib/generation-queue";
function book() {
  const project = createProject();
  project.characters[0].status = "locked";
  project.characters[0].characterSheetImage = "approved-face";
  project.visualStyle.status = "locked";
  project.visualStyle.previewImage = "approved-style";
  project.chapters[0].pages = [1, 2, 3].map((number) => ({
    ...newPage(project.chapters[0].id, number),
    sceneDescription: `Ava explores scene ${number}.`,
    characterIds: [project.characters[0].id],
  }));
  return project;
}
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(check(), "Queue state reached before timeout");
}
test("queue serializes requests, ignores duplicate pages, stops pending work, and requires explicit retry", async () => {
  const project = book();
  const [first, second] = project.chapters[0].pages.map((page) =>
    makeChapterJob(project, page),
  );
  let release!: () => void;
  const calls: string[] = [];
  let concurrent = 0,
    maxConcurrent = 0;
  const queue = new GenerationQueue(
    [],
    async (job) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      calls.push(job.pageId);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      concurrent--;
    },
    () => {},
    (error) => {
      throw error;
    },
  );
  queue.enqueue([first, second, { ...first, id: "duplicate" }]);
  assert.equal(queue.jobs.length, 2);
  assert.deepEqual(calls, [first.pageId]);
  queue.stop();
  assert.equal(second.status, "queued"); // Caller objects are not the current queue state after stop.
  assert.equal(queue.jobs[1].status, "canceled");
  release();
  await waitFor(() => queue.jobs[0].status === "completed");
  assert.equal(calls.length, 1);
  assert.equal(typeof queue.jobs[0].durationMs, "number");
  queue.retry(second.id);
  await waitFor(() => calls.length === 2);
  release();
  await waitFor(() => queue.jobs[1].status === "completed");
  assert.equal(maxConcurrent, 1);
});
test("a failed page is retained, following pages continue, and failed jobs are never retried automatically", async () => {
  const project = book();
  const jobs = project.chapters[0].pages.map((page) =>
    makeChapterJob(project, page),
  );
  const calls: string[] = [];
  const queue = new GenerationQueue(
    [],
    async (job) => {
      calls.push(job.id);
      if (job.id === jobs[0].id) throw new Error("Quota reached.");
    },
    () => {},
    (error) => {
      throw error;
    },
  );
  queue.enqueue(jobs);
  await waitFor(() => queue.jobs[2].status === "completed");
  assert.equal(queue.jobs[0].status, "failed");
  assert.equal(queue.jobs[0].error, "Quota reached.");
  assert.deepEqual(
    calls,
    jobs.map((job) => job.id),
  );
});
test("bulk validation skips locked, unready and duplicate pages and snapshots text and approvals", () => {
  const project = book();
  const pages = project.chapters[0].pages;
  pages[1].status = "locked";
  pages[2].sceneDescription = "";
  const plan = bulkChapterJobs(project, false, []);
  assert.equal(plan.jobs.length, 1);
  assert.equal(plan.skipped.length, 2);
  const inclusive = bulkChapterJobs(project, true, []);
  assert.equal(inclusive.jobs.length, 2);
  assert.equal(inclusive.jobs[1].allowLocked, true);
  assert.equal(inclusive.jobs[0].allowLocked, false);
  assert.equal(bulkChapterJobs(project, true, inclusive.jobs).jobs.length, 0);
  const savedScene = inclusive.jobs[0].recipe.scene;
  pages[0].sceneDescription = "Edited after queueing";
  project.characters[0].characterSheetImage = "changed-face";
  assert.equal(inclusive.jobs[0].recipe.scene, savedScene);
  assert.equal(
    inclusive.jobs[0].recipe.characters[0].characterSheetImage,
    "approved-face",
  );
  assert.match(
    jobApprovalIssues(project, inclusive.jobs[0]).join(" "),
    /identity has changed/,
  );
});
test("results append to their originating pages and preserve newer edits, history, locks and typography", () => {
  const project = book();
  const first = project.chapters[0].pages[0];
  first.status = "locked";
  first.lockedTypography = { ...project.typography };
  const version = {
    id: "new-version",
    image: "new-image",
    prompt: "saved prompt",
  } as IllustrationVersion;
  first.illustrationVersions = [
    { ...version, id: "previous", image: "previous-image" },
  ];
  const job = makeChapterJob(project, first, true);
  project.chapters[0].pages[1].storyText = "Newer edits elsewhere";
  const next = applyQueuedVersion(project, job, version);
  const result = next.chapters[0].pages[0];
  assert.equal(result.illustrationVersions.length, 2);
  assert.equal(result.selectedIllustrationId, "new-version");
  assert.equal(result.status, "locked");
  assert.deepEqual(result.lockedTypography, first.lockedTypography);
  assert.equal(next.chapters[0].pages[1].storyText, "Newer edits elsewhere");
  assert.equal(first.illustrationVersions.length, 1);
  assert.throws(
    () => applyQueuedVersion(project, { ...job, allowLocked: false }, version),
    /locked/,
  );
});
test("reload pauses waiting jobs and flags interrupted work; resume never replays interrupted requests", async () => {
  const project = book();
  const jobs = project.chapters[0].pages.map((page) =>
    makeChapterJob(project, page),
  );
  jobs[0].status = "running";
  const restored = restoreQueue(JSON.stringify(jobs), project.id);
  assert.deepEqual(
    restored.map((j) => j.status),
    ["interrupted", "paused", "paused"],
  );
  let calls = 0;
  const queue = new GenerationQueue(
    restored,
    async () => {
      calls++;
    },
    () => {},
    (error) => {
      throw error;
    },
  );
  assert.equal(calls, 0);
  queue.resume();
  await waitFor(() => queue.jobs[2].status === "completed");
  assert.equal(calls, 2);
  assert.equal(queue.jobs[0].status, "interrupted");
  assert.throws(
    () => restoreQueue(JSON.stringify(jobs), "another-book"),
    /could not be read/,
  );
});
test("queue storage failures stop work before any paid request starts", () => {
  const project = book();
  let calls = 0,
    failures = 0;
  const queue = new GenerationQueue(
    [],
    async () => {
      calls++;
    },
    () => {
      throw new Error("Storage full");
    },
    () => {
      failures++;
    },
  );
  assert.throws(
    () =>
      queue.enqueue([makeChapterJob(project, project.chapters[0].pages[0])]),
    /Storage full/,
  );
  assert.equal(calls, 0);
  assert.equal(failures, 1);
  assert.equal(queue.jobs[0].status, "paused");
});
