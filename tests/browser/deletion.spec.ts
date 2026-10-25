import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { createProject, newPage, type BookProject } from "../../lib/model";
function fixture() {
  const p = createProject();
  p.characters[0] = {
    ...p.characters[0],
    status: "locked",
    characterSheetImage: "face",
    faceOnly: true,
    faceViews: "multi-angle",
  };
  p.visualStyle = {
    ...p.visualStyle,
    status: "locked",
    previewImage: "style",
    backgroundOnly: true,
  };
  p.chapters[0].pages = [1, 2, 3].map((n) => ({
    ...newPage(p.chapters[0].id, n),
    sceneDescription: `Ava explores scene ${n}.`,
    characterIds: [p.characters[0].id],
  }));
  p.chapters[0].pages[1].status = "locked";
  p.chapters[0].pages[1].lockedTypography = { ...p.typography };
  p.chapters[0].pages[1].illustrationVersions = [
    {
      id: "old-version",
      image: "original",
      model: "test",
      prompt: "Old image",
      characterReferences: [],
      sceneReferences: [],
      createdAt: new Date().toISOString(),
    },
  ];
  p.chapters[0].pages[1].selectedIllustrationId = "old-version";
  p.chapters.push({
    id: "second-chapter",
    title: "Second chapter",
    theme: "",
    description: "",
    referencePhotos: [],
    pages: [newPage("second-chapter", 1)],
  });
  return p;
}
async function seed(page: Page, book: BookProject) {
  await page.addInitScript((book) => {
    if (localStorage.getItem("deletion-test-seeded")) return;
    localStorage.setItem("deletion-test-seeded", "yes");
    localStorage.setItem("ava-book-project-v3", JSON.stringify(book));
    const request = indexedDB.open("ava-book-assets-v3", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("assets");
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
  }, book);
  await page.goto("/");
  await page.getByRole("button", { name: /Chapter$/ }).click();
}
test("page and chapter deletion confirm, undo safely, renumber, and persist across reload", async ({
  page,
}) => {
  await page.route("**/api/illustrations", (route) =>
    route.fulfill({
      json: {
        available: false,
        model: "gpt-image-2.5-flare",
        provider: "OpenAI",
      },
    }),
  );
  await seed(page, fixture());
  await page.getByRole("button", { name: /Page 2/ }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Delete page", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Page 3", exact: true }),
  ).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("including locked content");
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Delete page", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Page 3", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("What happens on this page?")).toHaveValue(
    "Ava explores scene 3.",
  );
  await page
    .getByLabel("The words on this page")
    .fill("Preserve this newer edit.");
  await page
    .getByRole("button", { name: "Undo deletion", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Unlock Page", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".versions button")).toHaveCount(1);
  await page.getByRole("button", { name: "Page 3", exact: true }).click();
  await expect(page.getByLabel("The words on this page")).toHaveValue(
    "Preserve this newer edit.",
  );
  await page.getByLabel("Chapter", { exact: true }).selectOption("1");
  await expect(
    page.getByRole("button", { name: "Delete page", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete chapter", exact: true })
    .click();
  await expect(
    page.getByLabel("Chapter", { exact: true }).locator("option"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Delete chapter", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Undo deletion", exact: true })
    .click();
  await expect(
    page.getByLabel("Chapter", { exact: true }).locator("option"),
  ).toHaveCount(2);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete chapter", exact: true })
    .click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByRole("button", { name: /Chapter$/ }).click();
  await expect(
    page.getByLabel("Chapter", { exact: true }).locator("option"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Undo deletion", exact: true }),
  ).toHaveCount(0);
});
test("deleting a waiting page removes its queued job while running pages and chapters stay protected", async ({
  page,
}) => {
  const book = fixture();
  book.chapters[0].pages[1].status = "draft";
  let requests = 0;
  let release!: () => void;
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  await page.route("**/api/illustrations", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          available: true,
          model: "gpt-image-2.5-flare",
          provider: "OpenAI",
        },
      });
    requests++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ status: 200, contentType: "image/png", body: png });
  });
  await seed(page, book);
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(
    page.getByRole("button", { name: "Delete page", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Delete chapter", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await page
    .getByRole("button", { name: "Edit & Regenerate", exact: true })
    .click();
  await expect(page.getByLabel("What happens on this page?")).toBeDisabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete page", exact: true }).click();
  await expect(page.getByLabel("Illustration queue").locator("li")).toHaveCount(
    1,
  );
  await expect(page.getByLabel("What happens on this page?")).toHaveValue(
    "Ava explores scene 3.",
  );
  release();
  await expect(page.getByLabel("Illustration queue")).toContainText("1 ready");
  await page
    .getByRole("button", { name: "Undo deletion", exact: true })
    .click();
  await expect(page.getByLabel("What happens on this page?")).toHaveValue(
    "Ava explores scene 2.",
  );
  await expect(page.getByLabel("What happens on this page?")).toBeEnabled();
  expect(requests).toBe(1);
  await page.getByRole("button", { name: "Page 1", exact: true }).click();
  await expect(page.locator(".versions button")).toHaveCount(1);
});
