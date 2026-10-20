import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { createProject } from "../../lib/model";
import { createIllustrationHandler } from "../../lib/server/illustration-handler";

test("masked feedback repairs preserve unselected pixels, history, feedback and local reload", async ({
  page,
}) => {
  const book = createProject();
  const character = book.characters[0];
  character.status = "locked";
  character.characterSheetImage = "face-asset";
  character.faceOnly = true;
  character.faceViews = "multi-angle";
  book.visualStyle.status = "locked";
  book.visualStyle.previewImage = "style-asset";
  book.visualStyle.backgroundOnly = true;
  const story = book.chapters[0].pages[0];
  story.sceneDescription = "Ava looks at the river.";
  story.characterIds = [character.id];
  story.status = "locked";
  story.illustrationVersions = [
    {
      id: "original-version",
      image: "original-asset",
      model: "mock-canvas-v1",
      prompt: "Original illustration",
      createdAt: new Date().toISOString(),
      characterReferences: ["face-asset"],
      styleReference: "style-asset",
      sceneReferences: [],
      recipe: {
        kind: "scene",
        characters: [character],
        visualStyle: book.visualStyle,
        scene: story.sceneDescription,
        references: ["legacy-scene-photo-not-attached"],
        composition: "Wide",
        exclusions: "",
      },
    },
  ];
  story.selectedIllustrationId = "original-version";
  const red = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 220, g: 20, b: 30, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  let fail = true;
  let maskChecked = false;
  await page.route("**/api/illustrations", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: { available: true, provider: "OpenAI", model: "gpt-image-2.5-flare" },
      });
      return;
    }
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 429,
        json: { error: "Quota reached. Original is safe." },
      });
      return;
    }
    const handler = createIllustrationHandler(() => ({
      async generate(prompt, images, _signal, mask) {
        expect(images).toHaveLength(3);
        expect(images[0].name).toBe("original.png");
        expect(prompt).toContain("Canonical identity = Image 2");
        expect(prompt).toContain("Fix Ava’s eye shape");
        expect(mask).toBeDefined();
        const { data, info } = await sharp(
          Buffer.from(await mask!.arrayBuffer()),
        )
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect(info.width).toBe(64);
        expect(data[(24 * 64 + 24) * 4 + 3]).toBe(0);
        expect(data[3]).toBe(255);
        maskChecked = true;
        return { bytes: Uint8Array.from(red), model: "gpt-image-2.5-flare" };
      },
    }));
    const response = await handler(
      new Request(route.request().url(), {
        method: "POST",
        headers: route.request().headers(),
        body: Uint8Array.from(route.request().postDataBuffer()!),
      }),
    );
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  await page.addInitScript((project) => {
    if (!localStorage.getItem("tweak-test-seeded")) {
      localStorage.setItem("ava-book-project-v3", JSON.stringify(project));
      localStorage.setItem("tweak-test-seeded", "true");
    }
  }, book);
  await page.goto("/");
  await page.evaluate(async (project) => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const context = c.getContext("2d")!;
    context.fillStyle = "rgb(20,40,80)";
    context.fillRect(0, 0, 64, 64);
    const blob = await new Promise<Blob>((r) =>
      c.toBlob((b) => r(b!), "image/png"),
    );
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ava-book-assets-v3", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("assets");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("assets", "readwrite");
      for (const id of ["original-asset", "face-asset", "style-asset"])
        transaction.objectStore("assets").put(blob, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    localStorage.setItem("ava-book-project-v3", JSON.stringify(project));
  }, book);
  await page.reload();
  await page.getByRole("button", { name: /Chapter$/ }).click();
  await page.locator(".tweak-panel > summary").click();
  await expect(
    page.getByRole("button", { name: "Apply feedback to selected area" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Unlock Page", exact: true }).click();
  // Pointer selection is also supported; keyboard controls below set exact test coordinates.
  await page.getByLabel("Illustration area selector").scrollIntoViewIfNeeded();
  const box = await page.getByLabel("Illustration area selector").boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
  await page.mouse.up();
  await expect(page.locator(".tweak-selection")).toBeVisible();
  await page
    .getByRole("button", { name: "Select center area", exact: true })
    .click();
  await page
    .getByLabel("What should change in this area?")
    .fill("Fix Ava’s eye shape to match her approved face.");
  await page
    .getByRole("button", { name: "Apply feedback to selected area" })
    .click();
  await expect(page.locator(".global-error")).toContainText("Quota reached");
  await expect(page.locator(".versions button")).toHaveCount(1);
  await expect(page.getByLabel("What should change in this area?")).toHaveValue(
    "Fix Ava’s eye shape to match her approved face.",
  );
  await page
    .getByRole("button", { name: "Apply feedback to selected area" })
    .click();
  await expect(page.locator(".versions button")).toHaveCount(2);
  expect(maskChecked).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("ava-book-project-v3")!).chapters[0]
            .pages[0].illustrationVersions.length,
      ),
    )
    .toBe(2);
  const pixels = await page.evaluate(async () => {
    const project = JSON.parse(localStorage.getItem("ava-book-project-v3")!);
    const versions = project.chapters[0].pages[0].illustrationVersions;
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("ava-book-assets-v3", 1);
      r.onsuccess = () => resolve(r.result);
    });
    const read = (id: string) =>
      new Promise<Blob>((resolve) => {
        const r = db.transaction("assets").objectStore("assets").get(id);
        r.onsuccess = () => resolve(r.result);
      });
    const before = await createImageBitmap(await read(versions[0].image));
    const after = await createImageBitmap(await read(versions[1].image));
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d")!;
    context.drawImage(before, 0, 0);
    const original = context.getImageData(0, 0, 64, 64).data;
    context.clearRect(0, 0, 64, 64);
    context.drawImage(after, 0, 0);
    const edited = context.getImageData(0, 0, 64, 64).data;
    let changed = 0;
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const inside = x >= 16 && x < 36 && y >= 16 && y < 36;
        for (let channel = 0; channel < 4; channel++) {
          const i = (y * 64 + x) * 4 + channel;
          if (!inside && original[i] !== edited[i])
            throw new Error("Unselected pixel changed");
          if (inside && original[i] !== edited[i]) changed++;
        }
      }
    before.close();
    after.close();
    db.close();
    return {
      changed,
      feedback: versions[1].recipe.tweak.feedback,
      parent: versions[1].recipe.tweak.sourceVersionId,
      manifest: versions[1].referenceManifest[0].id,
    };
  });
  expect(pixels.changed).toBeGreaterThan(0);
  expect(pixels.feedback).toContain("eye shape");
  expect(pixels.parent).toBe("original-version");
  expect(pixels.manifest).toBe("original-asset");
  await page.locator(".versions button").first().click();
  await expect(page.locator(".versions button").first()).toHaveClass(
    /selected/,
  );
  await page.locator(".versions button").last().click();
  await page.waitForTimeout(350);
  await page.reload();
  await page.getByRole("button", { name: /Chapter$/ }).click();
  await expect(page.locator(".versions button")).toHaveCount(2);
  await expect(page.locator(".versions button").last()).toHaveClass(/selected/);
});
