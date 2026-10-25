import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  newPage,
  assertProject,
  type IllustrationVersion,
} from "../lib/model";
import {
  deleteBookPage,
  deleteBookChapter,
  restoreDeletedContent,
} from "../lib/book-structure";
import { GenerationQueue, makeChapterJob } from "../lib/generation-queue";
function book() {
  const p = createProject();
  p.chapters[0].pages = [1, 2, 3].map((n) => ({
    ...newPage(p.chapters[0].id, n),
    sceneDescription: `Ava explores scene ${n}.`,
    characterIds: [p.characters[0].id],
  }));
  p.chapters.push({
    ...p.chapters[0],
    id: "second-chapter",
    title: "Second chapter",
    pages: [newPage("second-chapter", 1)],
  });
  return p;
}
test("page deletion renumbers remaining stable IDs, preserves locks and can be undone without losing newer edits", () => {
  const p = book();
  const original = p.chapters[0].pages[1];
  original.status = "locked";
  original.lockedTypography = { ...p.typography };
  original.illustrationVersions = [
    { id: "old-version", image: "shared-image" } as IllustrationVersion,
  ];
  const { project: next, deleted } = deleteBookPage(p, original.id);
  assert.deepEqual(
    next.chapters[0].pages.map((page) => page.pageNumber),
    [1, 2],
  );
  assert.equal(next.chapters[0].pages[1].id, p.chapters[0].pages[2].id);
  assert.equal(p.chapters[0].pages.length, 3);
  next.chapters[0].pages[1] = {
    ...next.chapters[0].pages[1],
    storyText: "New edit after deletion",
  };
  const restored = restoreDeletedContent(next, deleted);
  assert.equal(
    restored.chapters[0].pages[2].storyText,
    "New edit after deletion",
  );
  assert.equal(restored.chapters[0].pages[1].status, "locked");
  assert.deepEqual(
    restored.chapters[0].pages[1].lockedTypography,
    p.typography,
  );
  assert.equal(
    restored.chapters[0].pages[1].illustrationVersions[0].image,
    "shared-image",
  );
  assert.equal(
    restoreDeletedContent(restored, deleted).chapters[0].pages.length,
    3,
  );
  assertProject(restored);
});
test("chapter deletion restores its original position and full contents without replacing surviving edits", () => {
  const p = book();
  const { project: next, deleted } = deleteBookChapter(p, p.chapters[0].id);
  assert.equal(next.chapters[0].id, "second-chapter");
  next.chapters[0] = { ...next.chapters[0], theme: "New theme" };
  const restored = restoreDeletedContent(next, deleted);
  assert.equal(restored.chapters[0].id, p.chapters[0].id);
  assert.equal(restored.chapters[0].pages.length, 3);
  assert.equal(restored.chapters[1].theme, "New theme");
  assertProject(restored);
});
test("the final chapter/page and missing targets cannot be deleted", () => {
  const p = createProject();
  assert.throws(
    () => deleteBookChapter(p, p.chapters[0].id),
    /at least one chapter/,
  );
  assert.throws(
    () => deleteBookPage(p, p.chapters[0].pages[0].id),
    /at least one page/,
  );
  assert.throws(() => deleteBookPage(p, "missing"), /no longer exists/);
  assert.throws(() => deleteBookChapter(p, "missing"), /no longer exists/);
  assertProject(p);
});
test("deletion removes waiting queue jobs and relabels survivors without disrupting an active completion", async () => {
  const p = book();
  p.characters[0].status = "locked";
  p.characters[0].characterSheetImage = "face";
  p.visualStyle.status = "locked";
  p.visualStyle.previewImage = "style";
  const jobs = p.chapters[0].pages.map((page) => makeChapterJob(p, page));
  let release!: () => void;
  const calls: string[] = [];
  const queue = new GenerationQueue(
    [],
    async (job) => {
      calls.push(job.pageId);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    () => {},
    (error) => {
      throw error;
    },
  );
  queue.enqueue(jobs);
  const next = deleteBookPage(p, p.chapters[0].pages[1].id).project;
  queue.reconcilePages(next);
  assert.equal(queue.jobs.length, 2);
  assert.equal(queue.jobs[1].label, "Chapter 1 · Page 2");
  assert.throws(
    () =>
      queue.reconcilePages(
        deleteBookPage(p, p.chapters[0].pages[0].id).project,
      ),
    /finish before deleting/,
  );
  release();
  for (let i = 0; i < 100 && calls.length < 2; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(calls, [
    p.chapters[0].pages[0].id,
    p.chapters[0].pages[2].id,
  ]);
  release();
  for (let i = 0; i < 100 && queue.jobs[1].status !== "completed"; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(
    queue.jobs.map((job) => job.status),
    ["completed", "completed"],
  );
});
