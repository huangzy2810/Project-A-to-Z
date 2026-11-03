import { test, expect } from "@playwright/test";
import sharp from "sharp";
import { createProject, type GenerationRecipe } from "../../lib/model";
import { createIllustrationHandler } from "../../lib/server/illustration-handler";
import { referenceAssets } from "../../lib/recipe";
import { readSavedProject } from "./persistence";

test("individual portraits use assigned photos, front approval gates other views, fallback works, and chapters attach the selected approved angle", async ({
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
    async generate(prompt, files) {
      counts.push(files.length);
      if (prompt.includes("front-cover")) throw new Error("Not a cover test");
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
  await page.goto("/");
  await page.getByRole("button", { name: "Begin our story" }).click();
  await page
    .getByRole("button", { name: "Generate Style", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Lock Style", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Lock Style", exact: true }).click();
  await page.getByRole("button", { name: /Character$/ }).click();
  const tabs = page.getByRole("group", { name: "Portrait angle" });
  await expect(tabs.getByRole("button")).toHaveCount(4);
  await tabs
    .getByRole("button", { name: "Right profile", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Generate from approved front reference",
      exact: true,
    }),
  ).toBeDisabled();
  await tabs.getByRole("button", { name: "Front", exact: true }).click();
  await page.getByLabel("Reference photos", { exact: true }).setInputFiles([
    { name: "front.png", mimeType: "image/png", buffer: png },
    { name: "left.png", mimeType: "image/png", buffer: png },
  ]);
  await page
    .getByLabel("Photo 2 angle", { exact: true })
    .selectOption("left-profile");
  await expect(page.getByAltText("Reference photo 2")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Generate Character", exact: true })
    .click();
  await expect(page.getByAltText("Front illustrated portrait")).toBeVisible();
  expect(recipes[1].characterAngle).toBe("front");
  expect(counts[1]).toBe(2); // assigned front photo + style; no left photo
  await page
    .getByRole("button", { name: "Lock Character", exact: true })
    .click();
  await tabs.getByRole("button", { name: "Left profile", exact: true }).click();
  await expect(page.getByAltText("Reference photo 1")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Generate Left profile portrait",
      exact: true,
    })
    .click();
  await expect(
    page.getByAltText("Left profile illustrated portrait"),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/v4-character-angles.png",
    fullPage: true,
  });
  expect(recipes[2].characterAngle).toBe("left-profile");
  expect(counts[2]).toBe(3); // approved front + assigned left photo + style
  await page
    .getByRole("button", { name: "Approve Left profile", exact: true })
    .click();
  await tabs
    .getByRole("button", { name: "Right profile", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Generate from approved front reference",
      exact: true,
    })
    .click();
  await expect(
    page.getByAltText("Right profile illustrated portrait"),
  ).toBeVisible();
  expect(recipes[3].characterAngle).toBe("right-profile");
  expect(counts[3]).toBe(2); // fallback has no raw angle photo
  await page
    .getByRole("button", { name: "Approve Right profile", exact: true })
    .click();
  await page.getByRole("button", { name: /Chapter$/ }).click();
  await page.getByRole("checkbox", { name: "Ava" }).check();
  await page
    .getByLabel("What happens on this page?")
    .fill("Ava waves beside the river.");
  await page
    .getByLabel("Ava · facing direction", { exact: true })
    .selectOption("three-quarter");
  const before = recipes.length;
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.locator(".global-error")).toContainText(
    "Three-quarter portrait",
  );
  expect(recipes).toHaveLength(before);
  await page
    .getByLabel("Ava · facing direction", { exact: true })
    .selectOption("left-profile");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.locator(".versions button")).toHaveCount(1);
  const scene = recipes.at(-1)!;
  const character = scene.characters[0];
  expect(scene.characterFacing?.[character.id]).toBe("left-profile");
  expect(
    referenceAssets(scene)
      .filter((reference) => reference.role === "identity")
      .map((r) => r.id),
  ).toEqual([character.angleReferences!["left-profile"]!.image]);
  expect(counts.at(-1)).toBe(2); // one character portrait + style
  await expect
    .poll(() =>
      readSavedProject(page).then(
        (p) => p.chapters[0].pages[0].illustrationVersions.length,
      ),
    )
    .toBe(1);
  await page.reload();
  await page.getByRole("button", { name: /Chapter$/ }).click();
  await expect(
    page.getByLabel("Ava · facing direction", { exact: true }),
  ).toHaveValue("left-profile");
  await page.getByRole("button", { name: /Character$/ }).click();
  await tabs
    .getByRole("button", { name: "Left profile ✓", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Unlock Left profile", exact: true }),
  ).toBeVisible();
});

test("existing sheets remain usable until explicit angle setup, and the previous sheet is preserved", async ({
  page,
}) => {
  const book = createProject();
  book.characters[0] = {
    ...book.characters[0],
    characterSheetImage: "legacy-sheet",
    status: "locked",
    referencePhotos: ["legacy-source"],
  };
  await page.addInitScript((book) => {
    if (!sessionStorage.getItem("angle-legacy-seeded")) {
      localStorage.setItem("ava-book-project-v3", JSON.stringify(book));
      sessionStorage.setItem("angle-legacy-seeded", "yes");
    }
    const r = indexedDB.open("ava-book-assets-v3", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("assets");
    r.onsuccess = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 32;
      canvas.toBlob((blob) => {
        const tx = r.result.transaction("assets", "readwrite");
        for (const id of ["legacy-sheet", "legacy-source"])
          tx.objectStore("assets").put(blob, id);
        tx.oncomplete = () => r.result.close();
      }, "image/png");
    };
  }, book);
  await page.goto("/");
  await page.getByRole("button", { name: /Character$/ }).click();
  await expect(
    page.getByRole("button", { name: "Unlock Character", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Angle references", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Set up angle references", exact: true })
    .click();
  await expect(
    page.getByLabel("Angle references", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("View previous character sheet", { exact: true })
    .click();
  await expect(page.getByAltText("Previous character sheet")).toBeVisible();
  await expect
    .poll(() =>
      readSavedProject(page).then((p) => p.characters[0].legacySheetImage),
    )
    .toBe("legacy-sheet");
});
