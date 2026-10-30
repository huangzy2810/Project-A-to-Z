import { test, expect } from "@playwright/test";
import { createProject } from "../../lib/model";
import sharp from "sharp";

test("setup placeholder and deleting all characters preserve the book and allow adding a new character", async ({
  page,
}) => {
  const p = createProject();
  p.chapters[0].pages[0].characterIds = p.characters.map((c) => c.id);
  p.cover = {
    instructions: "Family",
    referencePhotos: [],
    illustrationVersions: [],
    characterIds: p.characters.map((c) => c.id),
  };
  await page.addInitScript((book) => {
    if (!localStorage.getItem("ava-book-project-v3"))
      localStorage.setItem("ava-book-project-v3", JSON.stringify(book));
  }, p);
  await page.goto("/");
  await expect(page.locator(".preview-page")).toContainText(
    "Generated images will appear here.",
  );
  await expect(page.locator(".preview-page .book-page")).toHaveCount(0);
  await page.getByRole("button", { name: /Character$/ }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Delete character", exact: true })
    .click();
  await expect(page.getByLabel("Character name", { exact: true })).toHaveValue(
    "Ava",
  );
  for (let i = 0; i < 3; i++) {
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Delete character", exact: true })
      .click();
  }
  await expect(
    page.getByText("No characters yet. Use + Add to create one."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generate Character", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("ava-book-project-v3")!).characters
            .length,
      ),
    )
    .toBe(0);
  await page.reload();
  await page.getByRole("button", { name: /Chapter$/ }).click();
  await expect(
    page
      .getByRole("group", { name: "Who appears in this scene?" })
      .getByRole("checkbox"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Character$/ }).click();
  page.once("dialog", (dialog) => dialog.accept("Grandma"));
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  await expect(page.getByLabel("Character name", { exact: true })).toHaveValue(
    "Grandma",
  );
});

test("photo memory pages add, preview separately, persist and delete including final page", async ({
  page,
}) => {
  const png = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  await page.goto("/");
  await page.getByRole("button", { name: /Photo Memories$/ }).click();
  await page
    .getByRole("button", { name: "Add memory page", exact: true })
    .click();
  await page
    .getByLabel("Memory photos", { exact: true })
    .setInputFiles({ name: "one.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Memory 1 · caption").fill("First memory");
  await page
    .getByRole("button", { name: "Add memory page", exact: true })
    .click();
  await expect(page.getByLabel("Memory 1 · caption")).toHaveCount(0);
  await expect(
    page.locator(".preview-page").getByAltText("First memory"),
  ).toHaveCount(0);
  await page
    .getByLabel("Memory photos", { exact: true })
    .setInputFiles({ name: "two.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Memory 1 · caption").fill("Second memory");
  await expect(
    page.locator(".preview-page").getByAltText("Second memory"),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem("ava-book-project-v3") || "null",
          )?.photoMemories.at(-1)?.caption,
      ),
    )
    .toBe("Second memory");
  await page.reload();
  await page.getByRole("button", { name: /Photo Memories$/ }).click();
  await expect(page.getByLabel("Memory 1 · caption")).toHaveValue(
    "First memory",
  );
  await page
    .getByRole("button", { name: "Memory page 2", exact: true })
    .click();
  await expect(page.getByLabel("Memory 1 · caption")).toHaveValue(
    "Second memory",
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Delete memory page", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Memory page 2", exact: true }),
  ).toBeVisible();
  for (let i = 0; i < 2; i++) {
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "Delete memory page", exact: true })
      .click();
  }
  await expect(
    page.getByText("Add a memory page to upload photos."),
  ).toBeVisible();
  await page.getByRole("button", { name: /Book Preview$/ }).click();
  await expect(page.locator(".page-list")).not.toContainText(
    "Our Shanghai Memories",
  );
});
