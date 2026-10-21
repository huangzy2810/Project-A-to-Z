import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { createProject, type GenerationRecipe } from "../../lib/model";
import { createIllustrationHandler } from "../../lib/server/illustration-handler";
test("separate body approvals and cast lineup guide chapters, survive reload, and become stale after height edits", async ({
  page,
}) => {
  const book = createProject();
  book.characters = book.characters.slice(0, 2).map((c, i) => ({
    ...c,
    status: "locked",
    characterSheetImage: `face-${i}`,
    faceOnly: true,
    faceViews: "multi-angle",
  }));
  book.visualStyle = {
    ...book.visualStyle,
    status: "locked",
    previewImage: "style",
    backgroundOnly: true,
  };
  book.chapters[0].pages[0].characterIds = book.characters.map((c) => c.id);
  book.chapters[0].pages[0].sceneDescription =
    "Ava and Mama wave by the river wearing blue coats.";
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "blue" },
  })
    .png()
    .toBuffer();
  const recipes: GenerationRecipe[] = [];
  const manifests: string[][] = [];
  const prompts: string[] = [];
  const handler = createIllustrationHandler(() => ({
    async generate(prompt, images) {
      prompts.push(prompt);
      manifests.push(images.map((image) => image.name));
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
  await page.addInitScript((book) => {
    if (localStorage.getItem("body-test-seeded")) return;
    localStorage.setItem("body-test-seeded", "yes");
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
        for (const id of ["face-0", "face-1", "style"])
          transaction.objectStore("assets").put(blob, id);
        transaction.oncomplete = () => request.result.close();
      }, "image/png");
    };
  }, book);
  await page.goto("/");
  await page.getByRole("button", { name: /Character$/ }).click();
  await expect(
    page.getByRole("button", { name: "Generate body sheet", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Approximate standing height (cm)").fill("100");
  await page.getByLabel("Build / frame").fill("Small frame, narrow shoulders");
  await page
    .getByLabel("Body proportions and posture")
    .fill("Short legs relative to torso; relaxed upright stance");
  await page
    .getByLabel("Ava body reference photos", { exact: true })
    .setInputFiles({ name: "body.png", mimeType: "image/png", buffer: png });
  await expect(
    page.getByLabel("Body reference builder").getByAltText("Reference photo 1"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Generate body sheet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve body sheet", exact: true }),
  ).toBeEnabled();
  expect(recipes[0].kind).toBe("body");
  expect(manifests[0]).toHaveLength(3);
  expect(prompts[0]).toContain("neutral gray");
  await page
    .getByRole("button", { name: "Approve body sheet", exact: true })
    .click();
  await page.getByRole("button", { name: /^Mama/ }).click();
  await page.getByLabel("Approximate standing height (cm)").fill("170");
  await page.getByLabel("Build / frame").fill("Medium frame");
  await page
    .getByRole("button", { name: "Generate body sheet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve body sheet", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Approve body sheet", exact: true })
    .click();
  await page.getByText("Relative-height cast lineup", { exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Ava: 100 cm", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Mama: 170 cm", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Generate cast lineup", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve cast lineup", exact: true }),
  ).toBeEnabled();
  expect(recipes[2].kind).toBe("lineup");
  expect(manifests[2]).toHaveLength(5);
  expect(prompts[2]).toContain("Ava: 100 cm; Mama: 170 cm");
  await page
    .getByRole("button", { name: "Approve cast lineup", exact: true })
    .click();
  await page.getByRole("button", { name: /Chapter$/ }).click();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.locator(".versions button")).toHaveCount(1);
  expect(manifests[3]).toHaveLength(6);
  expect(prompts[3]).toContain("BODY CONTRACT — Ava: Image 3");
  expect(prompts[3]).toContain("HEIGHT CONTRACT — Image 5");
  const rawBodyId = recipes[0].characters[0].body!.referencePhotos[0];
  expect(manifests[3].some((name) => name.startsWith(rawBodyId))).toBe(false);
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByRole("button", { name: /Character$/ }).click();
  await expect(
    page.getByRole("button", { name: "Unlock body sheet", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Unlock body sheet", exact: true })
    .click();
  await page.getByLabel("Approximate standing height (cm)").fill("110");
  await expect(
    page.getByRole("button", { name: "Approve body sheet", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(/body sheet is out of date/).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: /Chapter$/ }).click();
  const before = recipes.length;
  await page
    .getByRole("button", { name: "Edit & Regenerate", exact: true })
    .click();
  await expect(page.locator(".global-error")).toContainText("body sheet");
  expect(recipes).toHaveLength(before);
  await expect(page.locator(".versions button")).toHaveCount(1);
});
