import { test, expect } from "@playwright/test";
import fs from "node:fs";
test("complete local book workflow, reload, locked pages and square PDF", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Book Setup", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("What shall we call your book?")
    .fill("Ava’s Wonderful Shanghai");
  await page.getByRole("button", { name: "Begin our story" }).click();
  const photo = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 400;
      c.height = 400;
      const x = c.getContext("2d")!;
      x.fillStyle = "#c4a36f";
      x.fillRect(0, 0, 400, 400);
      return c.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  await page.locator("input[type=file]").setInputFiles({
    name: "reference.png",
    mimeType: "image/png",
    buffer: photo,
  });
  await expect(page.getByAltText("Reference photo 1")).toBeVisible();
  for (const name of ["Ava", "Mama", "Papa"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page
      .getByRole("button", { name: "Generate Character", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Lock Character", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Lock Character", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Unlock Character", exact: true }),
    ).toBeVisible();
  }
  await page.getByRole("button", { name: /Visual Style$/ }).click();
  await page
    .getByRole("button", { name: "Generate Style", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Lock Style", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Lock Style", exact: true }).click();
  await page.getByRole("button", { name: /Chapter$/ }).click();
  await page.getByRole("checkbox", { name: "Ava" }).check();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Lock Page", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Try Again", exact: true }).click();
  await expect(page.locator(".versions button")).toHaveCount(2);
  await page.locator(".versions button").first().click();
  await page.getByRole("button", { name: "Lock Page", exact: true }).click();
  await expect(page.getByLabel("The words on this page")).toBeDisabled();
  await page.getByRole("button", { name: /Typography$/ }).click();
  await page.getByLabel("Story size").fill("24");
  await page.getByRole("button", { name: /Chapter$/ }).click();
  await expect(
    page.getByRole("button", { name: "Unlock Page", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Photo Memories$/ }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "trip.png", mimeType: "image/png", buffer: photo });
  await expect(page.getByLabel("Memory 1 · caption")).toBeVisible();
  await page.getByLabel("Memory 1 · caption").fill("Our first day");
  await page.waitForTimeout(400);
  await page.reload();
  await expect(page.getByLabel("What shall we call your book?")).toHaveValue(
    "Ava’s Wonderful Shanghai",
  );
  await page.getByRole("button", { name: /Photo Memories$/ }).click();
  await expect(page.getByLabel("Memory 1 · caption")).toHaveValue(
    "Our first day",
  );
  await expect(page.getByAltText("Our first day")).toBeVisible();
  await page.getByRole("button", { name: /Export PDF$/ }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Book as PDF" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const pdf = fs.readFileSync(path!);
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(pdf.toString("latin1")).toContain("/MediaBox [0 0 576. 576.]");
  expect(pdf.toString("latin1")).toMatch(/\/Count 4\b/);
  expect(errors).toEqual([]);
  await page.screenshot({ path: "/tmp/ava-book-desktop.png", fullPage: true });
});
test("mobile usable and invalid uploads report an error", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Begin our story" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "bad.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("bad"),
  });
  await expect(page.locator(".error")).toContainText("JPG, PNG or WEBP");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/ava-book-mobile.png", fullPage: true });
});

test("corrupted saves are preserved and reset requires confirmation", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("ava-book-project-v1", "{broken"),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Your saved book needs attention" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("ava-book-project-v1")),
  ).toBe("{broken");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Reset Project" }).click();
  await expect(
    page.getByRole("heading", { name: "Your saved book needs attention" }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Reset Project" }).click();
  await expect(page.getByLabel("What shall we call your book?")).toHaveValue(
    "Ava’s Shanghai Adventure",
  );
});

test("export rejects overflowing text rather than clipping it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Chapter$/ }).click();
  await page
    .getByLabel("The words on this page")
    .fill("A very long adventure. ".repeat(300));
  await page.getByRole("button", { name: /Export PDF$/ }).click();
  await page.getByRole("button", { name: "Export Book as PDF" }).click();
  await expect(page.locator(".global-error")).toContainText(
    "more text than fits",
  );
});
