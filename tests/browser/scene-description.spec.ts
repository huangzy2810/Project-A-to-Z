import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { createProject, type GenerationRecipe } from "../../lib/model";
import { createIllustrationHandler } from "../../lib/server/illustration-handler";
import { createSceneDescriptionHandler } from "../../lib/server/scene-description";
const draft =
  "Ava wears a red coat and white shoes, standing on the left and pointing across the river. Warm sunset light falls on the stone railing, with tall buildings in the distant background.";
async function setup(page: Page, text: string) {
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
  book.chapters[0].pages[0].sceneDescription = text;
  book.chapters[0].pages[0].characterIds = [book.characters[0].id];
  await page.addInitScript((book) => {
    if (localStorage.getItem("scene-test-seeded")) return;
    localStorage.setItem("scene-test-seeded", "yes");
    localStorage.setItem("ava-book-project-v1", "v2-sentinel");
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
        for (const id of ["face", "style"])
          transaction.objectStore("assets").put(blob, id);
        transaction.oncomplete = () => request.result.close();
      }, "image/png");
    };
  }, book);
  await page.goto("/");
  await page.getByRole("button", { name: /Chapter$/ }).click();
}
async function upload(page: Page) {
  const buffer = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "red" },
  })
    .png()
    .toBuffer();
  await page
    .locator('input[type="file"]')
    .last()
    .setInputFiles({ name: "scene.png", mimeType: "image/png", buffer });
}
test("photo draft is reviewable, editable and saved while scene photos never reach illustration or retries", async ({
  page,
}) => {
  const recipes: GenerationRecipe[] = [];
  let analyses = 0;
  const analysis = createSceneDescriptionHandler(() => ({
    async describe(photos, names) {
      analyses++;
      expect(photos).toHaveLength(1);
      expect(names).toEqual(["Ava"]);
      return draft;
    },
  }));
  await page.route("**/api/scene-description", async (route) => {
    const response = await analysis(
      new Request(route.request().url(), {
        method: "POST",
        headers: route.request().headers(),
        body: Uint8Array.from(route.request().postDataBuffer()!),
      }),
    );
    await route.fulfill({
      status: response.status,
      json: await response.json(),
    });
  });
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const handler = createIllustrationHandler(() => ({
    async generate(prompt, images) {
      expect(images).toHaveLength(2);
      expect(images.map((image) => image.name)).toEqual([
        "face.png",
        "style.png",
      ]);
      expect(prompt).toContain("Canonical identity = Image 1");
      expect(prompt).not.toContain("SCENE-ONLY REFERENCE");
      return { bytes: png, model: "gpt-image-1.5" };
    },
  }));
  await page.route("**/api/illustrations", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { available: true, provider: "OpenAI", model: "gpt-image-1.5" },
      });
    const request = new Request(route.request().url(), {
      method: "POST",
      headers: route.request().headers(),
      body: Uint8Array.from(route.request().postDataBuffer()!),
    });
    recipes.push(
      JSON.parse((await request.clone().formData()).get("recipe") as string),
    );
    const response = await handler(request);
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  await setup(page, "My carefully edited scene.");
  await upload(page);
  await expect(
    page.getByLabel("Scene photo draft", { exact: true }),
  ).toContainText(draft);
  await expect(page.getByLabel("What happens on this page?")).toHaveValue(
    "My carefully edited scene.",
  );
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByRole("button", { name: /Chapter$/ }).click();
  await expect(
    page.getByLabel("Scene photo draft", { exact: true }),
  ).toContainText(draft);
  await page
    .getByRole("button", { name: "Use photo draft", exact: true })
    .click();
  await expect(page.getByLabel("What happens on this page?")).toHaveValue(
    draft,
  );
  const refined = draft + " Ava holds a yellow balloon.";
  await page.getByLabel("What happens on this page?").fill(refined);
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.locator(".versions button")).toHaveCount(1);
  expect(recipes[0].scene).toBe(refined);
  expect(recipes[0].references).toEqual([]);
  await page.getByRole("button", { name: "Try Again", exact: true }).click();
  await expect(page.locator(".versions button")).toHaveCount(2);
  expect(recipes[1].references).toEqual([]);
  expect(analyses).toBe(1);
  await page.getByRole("button", { name: "Lock Page", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Draft scene from photos", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("What happens on this page?")).toBeDisabled();
  expect(
    await page.evaluate(() => localStorage.getItem("ava-book-project-v1")),
  ).toBe("v2-sentinel");
});
test("failed analysis keeps uploads and text; retry fills an empty scene and photo removal makes no request", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/illustrations", (route) =>
    route.fulfill({
      json: { available: false, provider: "OpenAI", model: "gpt-image-1.5" },
    }),
  );
  await page.route("**/api/scene-description", (route) => {
    calls++;
    return calls === 1
      ? route.fulfill({
          status: 503,
          json: {
            error: "Photo drafting needs an API key. Your scene text is safe.",
          },
        })
      : route.fulfill({ json: { description: draft } });
  });
  await setup(page, "");
  await upload(page);
  await expect(page.locator(".global-error")).toContainText("needs an API key");
  await expect(page.getByAltText("Reference photo 1")).toBeVisible();
  await expect(page.getByLabel("What happens on this page?")).toHaveValue("");
  await page
    .getByRole("button", { name: "Draft scene from photos", exact: true })
    .click();
  await expect(page.getByLabel("What happens on this page?")).toHaveValue(
    draft,
  );
  await page
    .getByRole("button", { name: "Remove photo 1", exact: true })
    .click();
  await expect(page.getByAltText("Reference photo 1")).toHaveCount(0);
  await expect(page.getByLabel("What happens on this page?")).toHaveValue(
    draft,
  );
  expect(calls).toBe(2);
});
