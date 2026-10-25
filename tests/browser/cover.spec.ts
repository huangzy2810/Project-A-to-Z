import { test, expect } from "@playwright/test";
import sharp from "sharp";
import fs from "node:fs";
import { createIllustrationHandler } from "../../lib/server/illustration-handler";
import type { GenerationRecipe } from "../../lib/model";
test("cover step follows closing letter, accepts photos/text, preserves versions on failure and uses selected cover in preview and PDF", async ({
  page,
}) => {
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const recipes: GenerationRecipe[] = [];
  const counts: number[] = [];
  const handler = createIllustrationHandler(() => ({
    async generate(prompt, images) {
      expect(prompt).toContain("front-cover illustration");
      counts.push(images.length);
      return { bytes: png, model: "gpt-image-2.5-flare" };
    },
  }));
  let failNext = false;
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
    recipes.push(
      JSON.parse((await request.clone().formData()).get("recipe") as string),
    );
    if (failNext) {
      failNext = false;
      return route.fulfill({
        status: 429,
        json: { error: "Quota reached. Your previous cover is safe." },
      });
    }
    const response = await handler(request);
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Closing Letter$/ }).click();
  await page
    .getByRole("button", { name: "Next chapter →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Re-create Cover", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Re-create cover", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Cover reference photos", { exact: true })
    .setInputFiles({ name: "family.png", mimeType: "image/png", buffer: png });
  await expect(page.getByAltText("Reference photo 1")).toBeVisible();
  await page
    .getByRole("button", { name: "Re-create cover", exact: true })
    .click();
  await expect(
    page.getByLabel("Cover versions").getByRole("button"),
  ).toHaveCount(1);
  expect(recipes[0].kind).toBe("cover");
  expect(recipes[0].references).toHaveLength(1);
  expect(counts[0]).toBe(1);
  await expect(
    page.locator(".preview-page").getByAltText("Generated book cover"),
  ).toBeVisible();
  await page
    .getByLabel("Cover instructions")
    .fill("Our family enjoying a picnic under lanterns.");
  await page
    .getByRole("button", { name: "Re-create cover", exact: true })
    .click();
  await expect(
    page.getByLabel("Cover versions").getByRole("button"),
  ).toHaveCount(2);
  expect(recipes[1].scene).toBe("Our family enjoying a picnic under lanterns.");
  failNext = true;
  await page
    .getByRole("button", { name: "Re-create cover", exact: true })
    .click();
  await expect(page.locator(".global-error")).toContainText(
    "previous cover is safe",
  );
  await expect(
    page.getByLabel("Cover versions").getByRole("button"),
  ).toHaveCount(2);
  await page
    .getByLabel("Cover versions")
    .getByRole("button", { name: "1", exact: true })
    .click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByRole("button", { name: /Re-create Cover$/ }).click();
  await expect(
    page.getByLabel("Cover versions").getByRole("button"),
  ).toHaveCount(2);
  await expect(
    page
      .getByLabel("Cover versions")
      .getByRole("button", { name: "1", exact: true }),
  ).toHaveClass("selected");
  await page
    .getByRole("button", { name: "Use original cover", exact: true })
    .click();
  await expect(
    page.locator(".preview-page").getByAltText("Generated book cover"),
  ).toHaveCount(0);
  await page
    .getByLabel("Cover versions")
    .getByRole("button", { name: "2", exact: true })
    .click();
  await page.getByRole("button", { name: /Book Preview$/ }).click();
  await expect(
    page.locator(".preview-page").getByAltText("Generated book cover"),
  ).toBeVisible();
  await page.getByRole("button", { name: /Edit this page/ }).click();
  await expect(
    page.getByRole("heading", { name: "Re-create Cover", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Export PDF$/ }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Book as PDF" }).click();
  await expect(
    page.locator(".export-pages .cover img.generated-cover-image"),
  ).toHaveCount(1);
  const file = await download;
  const pdf = fs.readFileSync((await file.path())!);
  expect(pdf.toString("latin1")).toContain("/MediaBox [0 0 576. 576.]");
  expect(pdf.toString("latin1")).toMatch(/\/Count 3\b/);
});
