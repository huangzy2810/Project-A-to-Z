import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import {
  createProject,
  newPage,
  type BookProject,
  type GenerationRecipe,
} from "../../lib/model";
import {
  makeChapterJob,
  queueStorageKey,
  type GenerationJob,
} from "../../lib/generation-queue";
import { createIllustrationHandler } from "../../lib/server/illustration-handler";
function fixture(): BookProject {
  const book = createProject();
  book.characters[0] = {
    ...book.characters[0],
    status: "locked",
    characterSheetImage: "face",
    faceOnly: true,
    faceViews: "multi-angle",
  };
  book.visualStyle = {
    ...book.visualStyle,
    status: "locked",
    previewImage: "style",
    backgroundOnly: true,
  };
  book.chapters[0].pages = [1, 2, 3, 4].map((number) => ({
    ...newPage(book.chapters[0].id, number),
    sceneDescription: number === 4 ? "" : `Ava explores scene ${number}.`,
    characterIds: [book.characters[0].id],
  }));
  const locked = book.chapters[0].pages[2];
  locked.status = "locked";
  locked.lockedTypography = { ...book.typography };
  locked.illustrationVersions = [
    {
      id: "old-version",
      image: "original",
      prompt: "Original",
      characterReferences: ["face"],
      styleReference: "style",
      sceneReferences: [],
      createdAt: new Date().toISOString(),
      model: "old-model",
    },
  ];
  locked.selectedIllustrationId = "old-version";
  return book;
}
async function seed(page: Page, book: BookProject, jobs: GenerationJob[] = []) {
  await page.addInitScript(
    ({ book, jobs, key }) => {
      if (localStorage.getItem("queue-test-seeded")) return;
      localStorage.setItem("queue-test-seeded", "yes");
      localStorage.setItem("ava-book-project-v3", JSON.stringify(book));
      localStorage.setItem(key, JSON.stringify(jobs));
      const request = indexedDB.open("ava-book-assets-v3", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("assets");
      request.onsuccess = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        canvas.getContext("2d")!.fillRect(0, 0, 64, 64);
        canvas.toBlob((blob) => {
          const transaction = request.result.transaction("assets", "readwrite");
          for (const id of ["face", "style", "original"])
            transaction.objectStore("assets").put(blob, id);
          transaction.oncomplete = () => request.result.close();
        }, "image/png");
      };
    },
    { book, jobs, key: queueStorageKey(book.id) },
  );
  await page.goto("/");
  await page.getByRole("button", { name: /Chapter$/ }).click();
}
async function mockImages(page: Page) {
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const calls: GenerationRecipe[] = [];
  const releases: (() => void)[] = [];
  let active = 0,
    maxActive = 0;
  const handler = createIllustrationHandler(() => ({
    async generate(_prompt, images) {
      expect(images).toHaveLength(2);
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return { bytes: png, model: "gpt-image-2.5-flare" };
    },
  }));
  await page.route("**/api/illustrations", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          available: true,
          model: "gpt-image-2.5-flare",
          provider: "OpenAI",
        },
      });
    const request = new Request(route.request().url(), {
      method: "POST",
      headers: route.request().headers(),
      body: Uint8Array.from(route.request().postDataBuffer()!),
    });
    calls.push(
      JSON.parse((await request.clone().formData()).get("recipe") as string),
    );
    const response = await handler(request);
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  return { calls, releases, maxActive: () => maxActive };
}
test("navigate and enqueue other pages while sequential results reach the original pages without losing edits", async ({
  page,
}) => {
  const book = fixture();
  const api = await mockImages(page);
  await seed(page, book);
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(() => api.releases.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Page 2", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await page
    .getByLabel("What happens on this page?")
    .fill("Ava follows a yellow kite.");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByLabel("What happens on this page?")).toBeDisabled();
  expect(api.calls).toHaveLength(1);
  await page.getByRole("button", { name: "Page 4", exact: true }).click();
  await page
    .getByLabel("The words on this page")
    .fill("Keep this new edit while images finish.");
  await page.getByRole("button", { name: /Visual Style$/ }).click();
  await expect(
    page.getByRole("button", { name: "Unlock Style", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Chapter$/ }).click();
  api.releases[0]();
  await expect.poll(() => api.releases.length).toBe(2);
  expect(api.calls[1].scene).toBe("Ava follows a yellow kite.");
  api.releases[1]();
  await expect(page.getByLabel("Illustration queue")).toContainText("2 ready");
  await expect(page.getByLabel("The words on this page")).toHaveValue(
    "Keep this new edit while images finish.",
  );
  await expect(page.locator(".versions button")).toHaveCount(0);
  await page.getByRole("button", { name: "Page 1", exact: true }).click();
  await expect(page.locator(".versions button")).toHaveCount(1);
  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await expect(page.locator(".versions button")).toHaveCount(1);
  expect(api.maxActive()).toBe(1);
});
test("whole-book shortcut requires locked-page opt-in, skips empty scenes and preserves versions and locks", async ({
  page,
}) => {
  const book = fixture();
  const api = await mockImages(page);
  await seed(page, book);
  await page
    .getByText("Regenerate all chapter illustrations", { exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Queue 2 chapter illustrations",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel(
      "Include locked pages and replace their selected illustrations. Pages remain locked.",
    )
    .check();
  await page
    .getByRole("button", { name: "Queue 3 chapter illustrations", exact: true })
    .click();
  for (let i = 0; i < 3; i++) {
    await expect.poll(() => api.releases.length).toBe(i + 1);
    api.releases[i]();
  }
  await expect(page.getByLabel("Illustration queue")).toContainText("3 ready");
  expect(api.calls.map((recipe) => recipe.scene)).toEqual(
    book.chapters[0].pages.slice(0, 3).map((p) => p.sceneDescription),
  );
  await page.getByRole("button", { name: /Page 3/ }).click();
  await expect(page.locator(".versions button")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Unlock Page", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("What happens on this page?")).toBeDisabled();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("ava-book-project-v3")!),
  );
  expect(saved.chapters[0].pages[2].lockedTypography).toEqual(book.typography);
  expect(saved.chapters[0].pages[2].illustrationVersions[0].id).toBe(
    "old-version",
  );
});
test("reload recovery never replays an interrupted request and resumes waiting jobs only on demand", async ({
  page,
}) => {
  const book = fixture();
  const jobs = book.chapters[0].pages
    .slice(0, 2)
    .map((p) => makeChapterJob(book, p));
  jobs[0].status = "running";
  const api = await mockImages(page);
  await seed(page, book, jobs);
  await expect(page.getByLabel("Illustration queue")).toContainText(
    "Interrupted",
  );
  await expect(page.getByLabel("Illustration queue")).toContainText("Paused");
  expect(api.calls).toHaveLength(0);
  await page
    .getByRole("button", { name: "Resume waiting jobs", exact: true })
    .click();
  await expect.poll(() => api.releases.length).toBe(1);
  expect(api.calls[0].scene).toBe(book.chapters[0].pages[1].sceneDescription);
  api.releases[0]();
  await expect(page.getByLabel("Illustration queue")).toContainText("1 ready");
  await page.reload();
  await expect(page.getByLabel("Illustration queue")).toContainText(
    "Interrupted",
  );
  expect(api.calls).toHaveLength(1);
});
