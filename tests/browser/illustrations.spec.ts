import { test, expect } from "@playwright/test";
import { createIllustrationHandler } from "../../lib/server/illustration-handler";
import type { GenerationRecipe } from "../../lib/model";
import { referenceAssets } from "../../lib/recipe";

test("AI client sends image references, retains retries and history, and never falls back after an error", async ({
  page,
}) => {
  const requests: GenerationRecipe[] = [];
  const imageCounts: number[] = [];
  let failNext = false;
  await page.route("**/api/illustrations", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: { available: true, provider: "OpenAI", model: "gpt-image-1.5" },
      });
      return;
    }
    const request = new Request(route.request().url(), {
      method: "POST",
      headers: route.request().headers(),
      body: Uint8Array.from(route.request().postDataBuffer()!),
    });
    const inspect = await request.clone().formData();
    requests.push(JSON.parse(inspect.get("recipe") as string));
    const handler = createIllustrationHandler(() => ({
      async generate(_prompt, images) {
        imageCounts.push(images.length);
        return {
          bytes: Uint8Array.from(photo),
          model: "gpt-image-1.5",
        };
      },
    }));
    if (failNext) {
      failNext = false;
      await route.fulfill({
        status: 429,
        json: {
          error: "Image API quota reached. Your previous images are safe.",
        },
      });
      return;
    }
    const response = await handler(request);
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  await page.goto("/");
  const photo = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      const x = c.getContext("2d")!;
      x.fillStyle = "#c78f73";
      x.fillRect(0, 0, 64, 64);
      return c.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  const upload = () =>
    page.locator("input[type=file]").last().setInputFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: photo,
    });
  await page.getByRole("button", { name: "Begin our story" }).click();
  await expect(page.locator(".generation-notice")).toContainText(
    "AI illustrations",
  );
  await upload();
  await expect(page.getByAltText("Reference photo 1")).toBeVisible();
  await page
    .getByRole("button", { name: "Generate Character", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Lock Character", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Lock Character", exact: true })
    .click();
  expect(requests[0].kind).toBe("character");
  expect(imageCounts[0]).toBe(1);
  await page.getByRole("button", { name: /Visual Style$/ }).click();
  await upload();
  await expect(page.getByAltText("Reference photo 1")).toBeVisible();
  await page
    .getByRole("button", { name: "Generate Style", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Lock Style", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Lock Style", exact: true }).click();
  expect(imageCounts[1]).toBe(2);
  await page.getByRole("button", { name: /Chapter$/ }).click();
  await page.getByRole("checkbox", { name: "Ava" }).check();
  await upload();
  await expect(page.getByAltText("Reference photo 1")).toBeVisible();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.locator(".versions button")).toHaveCount(1);
  expect(imageCounts[2]).toBe(4);
  expect(referenceAssets(requests[2]).map((r) => r.label)).toEqual([
    "Ava: approved identity reference",
    "Approved visual style sample",
    "Visual style reference 1",
    "Scene reference 1",
  ]);
  const originalScene = requests[2].scene;
  await page
    .getByLabel("What happens on this page?")
    .fill("Ava sees lanterns in the garden.");
  await page.getByRole("button", { name: "Try Again", exact: true }).click();
  await expect(page.locator(".versions button")).toHaveCount(2);
  expect(requests[3].scene).toBe(originalScene);
  expect(requests[3]).toEqual(requests[2]);
  await page
    .getByRole("button", { name: "Edit & Regenerate", exact: true })
    .click();
  await expect(page.locator(".versions button")).toHaveCount(3);
  expect(requests[4].scene).toBe("Ava sees lanterns in the garden.");
  failNext = true;
  await page.getByRole("button", { name: "Try Again", exact: true }).click();
  await expect(page.locator(".global-error")).toContainText("quota reached");
  await expect(page.locator(".versions button")).toHaveCount(3);
  await page.getByRole("button", { name: "Open project settings" }).click();
  await page.getByLabel("Illustration mode").selectOption("mock");
  await page.getByRole("button", { name: "Close settings" }).click();
  const count = requests.length;
  await page.getByRole("button", { name: "Try Again", exact: true }).click();
  await expect(page.locator(".versions button")).toHaveCount(4);
  expect(requests.length).toBe(count);
  await page.getByRole("button", { name: "Lock Page", exact: true }).click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByRole("button", { name: /Chapter$/ }).click();
  await expect(page.locator(".versions button")).toHaveCount(4);
  await expect(
    page.getByRole("button", { name: "Unlock Page", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".generation-notice")).toContainText(
    "Sample artwork",
  );
});

test("missing configuration explicitly uses samples, while configuration errors stop generation", async ({
  page,
}) => {
  await page.route("**/api/illustrations", (route) =>
    route.fulfill({
      json: { available: false, provider: "OpenAI", model: "gpt-image-1.5" },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Begin our story" }).click();
  await expect(page.locator(".generation-notice")).toContainText(
    "AI not configured",
  );
  await page.unroute("**/api/illustrations");
  await page.route("**/api/illustrations", (route) =>
    route.fulfill({ status: 503, json: { error: "Settings unavailable" } }),
  );
  await page
    .getByRole("button", { name: "Generate Character", exact: true })
    .click();
  await expect(page.locator(".global-error")).toContainText("Could not check");
  await expect(
    page.getByRole("button", { name: "Lock Character", exact: true }),
  ).toBeDisabled();
});

test("automatic mode refreshes its label if the credential becomes unavailable", async ({
  page,
}) => {
  let available = true,
    posts = 0;
  await page.route("**/api/illustrations", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      await route.abort();
      return;
    }
    await route.fulfill({
      json: { available, provider: "OpenAI", model: "gpt-image-1.5" },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Begin our story" }).click();
  await expect(page.locator(".generation-notice")).toContainText(
    "AI illustrations",
  );
  available = false;
  await page
    .getByRole("button", { name: "Generate Character", exact: true })
    .click();
  await expect(page.locator(".generation-notice")).toContainText(
    "AI not configured",
  );
  await expect(
    page.getByRole("button", { name: "Lock Character", exact: true }),
  ).toBeEnabled();
  expect(posts).toBe(0);
});
