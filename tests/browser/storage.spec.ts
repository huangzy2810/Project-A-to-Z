import { test, expect } from "@playwright/test";
import fs from "node:fs";
import sharp from "sharp";
import { strFromU8, unzipSync, zipSync, strToU8 } from "fflate";
import { createProject } from "../../lib/model";
import { makeChapterJob, queueStorageKey } from "../../lib/generation-queue";
import { readSavedProject } from "./persistence";

test("migrates large book and queue, verifies copies, frees legacy keys and works with localStorage writes rejected", async ({
  page,
}) => {
  const book = createProject();
  book.settings.illustrationDirection = "A".repeat(1_500_000);
  book.characters[0].status = "locked";
  book.characters[0].characterSheetImage = "face";
  book.visualStyle.status = "locked";
  book.visualStyle.previewImage = "style";
  const story = book.chapters[0].pages[0];
  story.sceneDescription = "Ava explores the waterfront.";
  story.characterIds = [book.characters[0].id];
  const job = makeChapterJob(book, story);
  await page.addInitScript(
    ({ book, job, key }) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("ava-book-project-v3", JSON.stringify(book));
        localStorage.setItem(key, JSON.stringify([job]));
        localStorage.setItem("ava-book-project-v1", "keep-v2");
        sessionStorage.setItem("seeded", "yes");
      }
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("ava-book"))
          throw new DOMException(
            "Simulated localStorage quota",
            "QuotaExceededError",
          );
        return original.call(this, key, value);
      };
    },
    { book, job, key: queueStorageKey(book.id) },
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open project settings" }),
  ).toContainText("Saved on this device");
  await expect(page.getByLabel("Illustration queue")).toContainText("Paused");
  expect(
    (await readSavedProject(page)).settings.illustrationDirection,
  ).toHaveLength(1_500_000);
  expect(
    await page.evaluate(
      (key) => [
        localStorage.getItem("ava-book-project-v3"),
        localStorage.getItem(key),
        localStorage.getItem("ava-book-project-v1"),
      ],
      queueStorageKey(book.id),
    ),
  ).toEqual([null, null, "keep-v2"]);
  await page
    .getByLabel("What shall we call your book?")
    .fill("Migrated safely");
  await expect
    .poll(() => readSavedProject(page).then((p) => p.title))
    .toBe("Migrated safely");
  await page.reload();
  await expect(page.getByLabel("What shall we call your book?")).toHaveValue(
    "Migrated safely",
  );
  await expect(page.getByLabel("Illustration queue")).toContainText("Paused");
});

test("failed migration retains original localStorage and reports storage error instead of opening an empty book", async ({
  page,
}) => {
  const book = createProject();
  await page.addInitScript((book) => {
    localStorage.setItem("ava-book-project-v3", JSON.stringify(book));
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const request = put.apply(this, args);
      if (this.name === "records") this.transaction.abort();
      return request;
    };
  }, book);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your saved book needs attention" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("ava-book-project-v3")!).id,
    ),
  ).toBe(book.id);
});

test("editable backup round trip restores text, photos and image history; missing-image backups leave current book unchanged", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("What shall we call your book?").fill("My backup book");
  await page.getByRole("button", { name: /Character$/ }).click();
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Reference photos", { exact: true })
    .setInputFiles({ name: "face.png", mimeType: "image/png", buffer: png });
  await expect(page.getByAltText("Reference photo 1")).toBeVisible();
  await page.getByRole("button", { name: "Open project settings" }).click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download editable backup", exact: true })
    .click();
  const download = await downloading;
  const bytes = fs.readFileSync((await download.path())!);
  const files = unzipSync(bytes);
  const backup = JSON.parse(strFromU8(files["book.json"]));
  expect(backup.project.title).toBe("My backup book");
  expect(backup.assets).toHaveLength(1);
  expect(files[`assets/${backup.assets[0].id}`].length).toBeGreaterThan(0);
  const oldId = backup.project.id;
  const broken = zipSync({ "book.json": strToU8(JSON.stringify(backup)) });
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByLabel("Restore editable backup", { exact: true })
    .setInputFiles({
      name: "broken.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(broken),
    });
  await expect(page.locator(".global-error")).toContainText(
    "An image is missing",
  );
  expect((await readSavedProject(page)).title).toBe("My backup book");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Reset Project", exact: true })
    .click();
  await page.getByRole("button", { name: "Open project settings" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByLabel("Restore editable backup", { exact: true })
    .setInputFiles({
      name: "book.zip",
      mimeType: "application/zip",
      buffer: bytes,
    });
  await expect
    .poll(() => readSavedProject(page).then((p) => p.title))
    .toBe("My backup book");
  expect((await readSavedProject(page)).id).not.toBe(oldId);
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: /Character$/ }).click();
  await expect(page.getByAltText("Reference photo 1")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("What shall we call your book?")).toHaveValue(
    "My backup book",
  );
  await page.getByRole("button", { name: /Character$/ }).click();
  await expect(page.getByAltText("Reference photo 1")).toBeVisible();
});

test("failed autosave keeps the live book available for backup and explicit save retry", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open project settings" }),
  ).toContainText("Saved on this device");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "records")
        throw new DOMException("Simulated device quota", "QuotaExceededError");
      return original.apply(this, args);
    };
    window.addEventListener(
      "restore-storage-test",
      () => {
        IDBObjectStore.prototype.put = original;
      },
      { once: true },
    );
  });
  await page
    .getByLabel("What shall we call your book?")
    .fill("Unsaved recovery book");
  await expect(
    page.getByRole("button", { name: "Open project settings" }),
  ).toContainText("Not saved");
  await page.getByRole("button", { name: "Open project settings" }).click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download editable backup", exact: true })
    .click();
  const bytes = fs.readFileSync((await (await downloading).path())!);
  expect(
    JSON.parse(strFromU8(unzipSync(bytes)["book.json"])).project.title,
  ).toBe("Unsaved recovery book");
  await page.evaluate(() =>
    window.dispatchEvent(new Event("restore-storage-test")),
  );
  await page
    .getByRole("button", { name: "Retry saving book", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Open project settings" }),
  ).toContainText("Saved on this device");
  expect((await readSavedProject(page)).title).toBe("Unsaved recovery book");
});
