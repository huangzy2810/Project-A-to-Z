import { test, expect, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import sharp from "sharp";
import fs from "node:fs";
import { createProject, type BookProject } from "../../lib/model";
async function seed(page: Page, project: BookProject) {
  await page.route("**/api/illustrations", (route) =>
    route.fulfill({
      json: {
        available: false,
        provider: "OpenAI",
        model: "gpt-image-2.5-flare",
      },
    }),
  );
  await page.addInitScript((book) => {
    if (localStorage.getItem("jpeg-test-seeded")) return;
    localStorage.setItem("jpeg-test-seeded", "yes");
    localStorage.setItem("ava-book-project-v3", JSON.stringify(book));
    const request = indexedDB.open("ava-book-assets-v3", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("assets");
    request.onsuccess = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "blue";
      context.fillRect(0, 0, 64, 64);
      canvas.toBlob((blob) => {
        const transaction = request.result.transaction("assets", "readwrite");
        for (const id of ["cover-image", "memory-image"])
          transaction.objectStore("assets").put(blob, id);
        transaction.oncomplete = () => request.result.close();
      }, "image/png");
    };
  }, project);
  await page.goto("/");
  await page.getByRole("button", { name: /Export PDF & JPEG$/ }).click();
}
test("JPEG archive contains full 2400-square pages in reading order with exact book-title filenames and selected cover", async ({
  page,
}) => {
  const book = createProject();
  book.title = "Ava’s Shanghai Book";
  book.cover = {
    instructions: "Blue cover",
    referencePhotos: [],
    illustrationVersions: [
      {
        id: "selected-cover",
        image: "cover-image",
        model: "test",
        prompt: "Blue cover",
        characterReferences: [],
        sceneReferences: [],
        createdAt: new Date().toISOString(),
      },
    ],
    selectedIllustrationId: "selected-cover",
  };
  book.photoMemories = [
    {
      id: "memory",
      image: "memory-image",
      caption: "A wonderful day",
      position: 50,
    },
  ];
  await seed(page, book);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Book as JPEG (ZIP)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "Ava’s Shanghai Book - JPEG Pages.zip",
  );
  const files = unzipSync(fs.readFileSync((await download.path())!));
  const names = Object.keys(files);
  expect(names).toEqual(
    [1, 2, 3, 4].map((page) => `Ava’s Shanghai Book - Page ${page}.jpg`),
  );
  for (const name of names) {
    const metadata = await sharp(files[name]).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(2400);
    expect(metadata.height).toBe(2400);
  }
  const pixel = await sharp(files[names[0]])
    .extract({ left: 1200, top: 500, width: 1, height: 1 })
    .raw()
    .toBuffer();
  expect(pixel[2]).toBeGreaterThan(240);
  expect(pixel[0]).toBeLessThan(15);
  expect(
    Buffer.from(files[names[0]]).equals(Buffer.from(files[names[1]])),
  ).toBe(false);
  await expect(
    page.getByRole("button", { name: "Export Book as JPEG (ZIP)" }),
  ).toBeEnabled();
  await expect(page.locator(".global-error")).toHaveCount(0);
});
test("JPEG export rejects overflowing story text without downloading a partial archive", async ({
  page,
}) => {
  const book = createProject();
  book.chapters[0].pages[0].storyText = "A very long story. ".repeat(500);
  book.typography.bodySize = 40;
  let downloads = 0;
  page.on("download", () => {
    downloads++;
  });
  await seed(page, book);
  await page.getByRole("button", { name: "Export Book as JPEG (ZIP)" }).click();
  await expect(page.locator(".global-error")).toContainText(
    "Page 2 has more text than fits",
  );
  await expect(
    page.getByRole("button", { name: "Export Book as JPEG (ZIP)" }),
  ).toBeEnabled();
  expect(downloads).toBe(0);
});
