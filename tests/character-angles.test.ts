import test from "node:test";
import assert from "node:assert/strict";
import {
  createProject,
  assertProject,
  type Character,
  type FaceAngle,
} from "../lib/model";
import {
  angleRecipe,
  angleApproved,
  withAngle,
  identityImage,
} from "../lib/character-angles";
import {
  referenceAssets,
  assemblePrompt,
  generationApprovalIssues,
  retryIdentityIssues,
  prepareGenerationRecipe,
} from "../lib/recipe";
import { sceneRecipe, makeChapterJob } from "../lib/generation-queue";
import { createIllustrationHandler } from "../lib/server/illustration-handler";
import { bookAssetIds } from "../lib/book-backup";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQEBAKpZfQAAAABJRU5ErkJggg==",
  "base64",
);
function approved(c: Character) {
  return withAngle(c, "front", {
    referencePhotos: ["raw-front"],
    primaryReferencePhoto: "raw-front",
    image: `${c.id}-front`,
    status: "locked",
  });
}
function book() {
  const p = createProject();
  p.visualStyle = { ...p.visualStyle, status: "locked", previewImage: "style" };
  p.characters[0] = approved(p.characters[0]);
  p.chapters[0].pages[0].characterIds = [p.characters[0].id];
  p.chapters[0].pages[0].sceneDescription = "Ava explores the riverbank.";
  return p;
}
test("front generation needs a source photo, and other angles require an approved front; missing-angle photos explicitly use the approved front", () => {
  const p = book();
  assert.throws(
    () => angleRecipe(p, createProject().characters[0], "front"),
    /front-facing photo/,
  );
  const locked = p.characters[0];
  const draft = withAngle(locked, "front", { status: "draft" });
  assert.throws(
    () => angleRecipe(p, draft, "left-profile"),
    /Approve the Front/,
  );
  const fallback = angleRecipe(p, locked, "right-profile");
  assert.deepEqual(generationApprovalIssues(fallback), []);
  assert.deepEqual(
    referenceAssets(fallback).map((r) => r.id),
    [locked.angleReferences!.front!.image, "style"],
  );
  assert.match(assemblePrompt(fallback), /nose must point to the right edge/);
  assert.match(
    assemblePrompt(fallback),
    /No photo for this angle was supplied/,
  );
  assert.match(assemblePrompt(fallback), /never a multi-view sheet or grid/);
});
test("angle-specific photos and approved front are attached without leaking the other angle photos or legacy grid", () => {
  const p = book();
  let c = withAngle(p.characters[0], "left-profile", {
    referencePhotos: ["left-photo"],
    primaryReferencePhoto: "left-photo",
  });
  c = withAngle(c, "right-profile", { referencePhotos: ["right-photo"] });
  const left = angleRecipe(p, c, "left-profile");
  assert.deepEqual(
    referenceAssets(left).map((r) => r.id),
    [c.angleReferences!.front!.image, "left-photo", "style"],
  );
  assert.doesNotMatch(assemblePrompt(left), /2 × 2 grid/);
  assert.match(assemblePrompt(left), /nose must point to the left edge/);
  assert.deepEqual(
    referenceAssets(angleRecipe(p, c, "front")).map((r) => r.id),
    ["raw-front", "style"],
  );
});
test("chapters bind each selected character to its requested approved portrait, submit one identity image per character and reject missing or stale angle approvals", () => {
  const p = book();
  const first = p.characters[0];
  p.characters[0] = withAngle(first, "left-profile", {
    image: "left-face",
    referencePhotos: ["left-source"],
    status: "locked",
    frontReference: first.angleReferences!.front!.image,
  });
  p.characters[1] = approved(p.characters[1]);
  const page = p.chapters[0].pages[0];
  page.sceneDescription = "Ava and Mama walk beside the river.";
  page.characterIds.push(p.characters[1].id);
  page.characterFacing = {
    [first.id]: "left-profile",
    [p.characters[1].id]: "front",
  };
  const recipe = sceneRecipe(p, page);
  assert.deepEqual(generationApprovalIssues(recipe), []);
  assert.deepEqual(
    referenceAssets(recipe).map((r) => r.id),
    ["left-face", p.characters[1].angleReferences!.front!.image, "style"],
  );
  const prompt = assemblePrompt(recipe);
  assert.match(
    prompt,
    /Ava\. Canonical identity = Image 1.*Required head direction: Left profile/,
  );
  assert.match(
    prompt,
    /Mama\. Canonical identity = Image 2.*Required head direction: Front/,
  );
  assert.doesNotMatch(prompt, /left-source|raw-front|Front identity anchor/);
  const job = makeChapterJob(p, page);
  p.characters[0] = withAngle(p.characters[0], "right-profile", {
    image: "unrelated-change",
    status: "draft",
  });
  assert.deepEqual(retryIdentityIssues(job.recipe, p.characters), []);
  p.characters[0] = withAngle(p.characters[0], "front", {
    image: "new-front",
    status: "locked",
  });
  assert.equal(angleApproved(p.characters[0], "left-profile"), false);
  assert.match(
    retryIdentityIssues(job.recipe, p.characters).join(" "),
    /approve.*Left profile/,
  );
  assert.throws(() => makeChapterJob(p, page), /approve.*Left profile/);
});
test("real upload handler retains facing fields and sends the matching portrait to the image provider; unapproved angles never invoke it", async () => {
  const p = book();
  const c = p.characters[0];
  p.characters[0] = withAngle(c, "right-profile", {
    image: "profile",
    status: "locked",
    frontReference: c.angleReferences!.front!.image,
  });
  const page = p.chapters[0].pages[0];
  page.characterFacing = { [c.id]: "right-profile" };
  let calls = 0;
  const handler = createIllustrationHandler(() => ({
    async generate(prompt, files) {
      calls++;
      assert.match(prompt, /approved Right profile portrait/);
      assert.match(
        prompt,
        /Canonical identity = Image 1.*Required head direction: Right profile/,
      );
      assert.deepEqual(
        files.map((file) => file.name),
        ["profile.png", "style.png"],
      );
      assert.doesNotMatch(prompt, /Front identity anchor/);
      return { bytes: png, model: "test" };
    },
  }));
  const request = () => {
    const recipe = sceneRecipe(p, page);
    const form = new FormData();
    form.set("recipe", JSON.stringify(recipe));
    for (const ref of referenceAssets(recipe))
      form.append(
        "images",
        new File([png], `${ref.id}.png`, { type: "image/png" }),
      );
    return new Request("http://localhost:3000/api/illustrations", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: form,
    });
  };
  assert.equal((await handler(request())).status, 200);
  p.characters[0] = withAngle(p.characters[0], "right-profile", {
    status: "draft",
  });
  assert.notEqual((await handler(request())).status, 200);
  assert.equal(calls, 1);
});
test("legacy references remain available, invalid angle data is rejected, and backups include all angle photos and historical portraits", () => {
  const p = book();
  const legacy = {
    ...createProject().characters[0],
    status: "locked" as const,
    characterSheetImage: "legacy-sheet",
  };
  assert.equal(identityImage(legacy), "legacy-sheet");
  p.characters[0] = withAngle(p.characters[0], "left-profile", {
    referencePhotos: ["left-source"],
    image: "left-face",
    previousImages: ["old-left"],
    frontReference: "old-front",
  });
  for (const id of ["left-source", "left-face", "old-left", "old-front"])
    assert.ok(bookAssetIds(p).includes(id));
  assertProject(p);
  p.chapters[0].pages[0].characterFacing = {
    [p.characters[0].id]: "sideways" as FaceAngle,
  };
  assert.throws(() => assertProject(p));
});

test("generation snapshots omit portrait history and generated prompts while retaining exact angle bindings", () => {
  const p = book();
  p.characters[0].angleReferences!.front!.generatedPrompt = "x".repeat(100_000);
  p.characters[0].angleReferences!.front!.previousImages = ["old-face"];
  const recipe = prepareGenerationRecipe(
    sceneRecipe(p, p.chapters[0].pages[0]),
  );
  assert.ok(JSON.stringify(recipe).length < 10_000);
  assert.equal(
    recipe.characters[0].angleReferences!.front!.image,
    p.characters[0].angleReferences!.front!.image,
  );
  assert.equal(
    recipe.characters[0].angleReferences!.front!.generatedPrompt,
    undefined,
  );
  assert.equal(
    p.characters[0].angleReferences!.front!.generatedPrompt!.length,
    100_000,
  );
});
