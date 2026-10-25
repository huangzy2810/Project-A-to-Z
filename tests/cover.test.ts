import test from "node:test";
import assert from "node:assert/strict";
import { createProject, assertProject } from "../lib/model";
import { coverRecipe, emptyCover, selectedCoverVersion } from "../lib/cover";
import { orderedPages } from "../components/BookPage";
import {
  assemblePrompt,
  referenceAssets,
  prepareGenerationRecipe,
} from "../lib/recipe";
import { createIllustrationHandler } from "../lib/server/illustration-handler";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQEBAKpZfQAAAABJRU5ErkJggg==",
  "base64",
);
test("cover supports photo-only, instructions-only or combined input, while empty input is rejected", () => {
  const p = createProject();
  assert.throws(() => coverRecipe(p), /photo or write cover instructions/);
  p.cover = { ...emptyCover(), referencePhotos: ["cover-photo"] };
  assert.deepEqual(coverRecipe(p).references, ["cover-photo"]);
  p.cover.instructions = "A family exploring a moonlit waterfront.";
  assert.equal(coverRecipe(p).scene, p.cover.instructions);
  p.cover.referencePhotos = [];
  assert.deepEqual(coverRecipe(p).references, []);
  assertProject(JSON.parse(JSON.stringify(p)));
});
test("cover references permit photographic subjects and likeness without applying chapter restrictions", () => {
  const p = createProject();
  p.visualStyle.status = "locked";
  p.visualStyle.previewImage = "style";
  p.cover = {
    ...emptyCover(),
    referencePhotos: ["family-photo"],
    instructions: "A family picnic among trees.",
  };
  const input = coverRecipe(p);
  assert.deepEqual(
    referenceAssets(input).map((r) => [r.id, r.role]),
    [
      ["style", "style"],
      ["family-photo", "cover"],
    ],
  );
  const prompt = assemblePrompt(input);
  assert.match(prompt, /front-cover illustration/);
  assert.match(prompt, /cover photos may guide subjects and likeness/i);
  assert.match(prompt, /Artwork only: no title/);
  assert.doesNotMatch(
    prompt,
    /SCENE-ONLY REFERENCE|Render only selected approved characters/,
  );
  assert.deepEqual(
    prepareGenerationRecipe({ ...input, kind: "scene" }).references,
    [],
  );
  assert.deepEqual(
    prepareGenerationRecipe({ ...input, characters: p.characters }).characters,
    [],
  );
});
test("selected generated cover remains the first printed page and original cover can be restored without removing history", () => {
  const p = createProject();
  const version = {
    id: "new-cover",
    image: "cover-asset",
    prompt: "A cover",
    characterReferences: [],
    sceneReferences: [],
    model: "test",
    createdAt: new Date().toISOString(),
  };
  p.cover = {
    ...emptyCover(),
    illustrationVersions: [version],
    selectedIllustrationId: version.id,
  };
  assert.equal(selectedCoverVersion(p)?.image, "cover-asset");
  assert.equal(orderedPages(p)[0].image, "cover-asset");
  assert.equal(orderedPages(p)[0].editStep, 6);
  p.cover.selectedIllustrationId = undefined;
  assert.equal(orderedPages(p)[0].image, undefined);
  assert.equal(p.cover.illustrationVersions.length, 1);
});
test("cover API sends uploaded photo bytes and freeform instructions to provider without requiring character approvals", async () => {
  const p = createProject();
  p.cover = {
    ...emptyCover(),
    instructions: "A picnic in the park",
    referencePhotos: ["family-photo"],
  };
  let calls = 0;
  const handle = createIllustrationHandler(() => ({
    async generate(prompt, photos) {
      calls++;
      assert.match(prompt, /A picnic in the park/);
      assert.deepEqual(Buffer.from(await photos[0].arrayBuffer()), png);
      return { bytes: png, model: "test" };
    },
  }));
  const form = new FormData();
  form.set("recipe", JSON.stringify(coverRecipe(p)));
  form.append("images", new File([png], "family.png", { type: "image/png" }));
  const response = await handle(
    new Request("http://localhost:3000/api/illustrations", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: form,
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test("cover provider receives approved cast before style and cover photos, with typography layout guidance", async () => {
  const p = createProject();
  p.characters[0] = {
    ...p.characters[0],
    status: "locked",
    characterSheetImage: "ava-sheet",
    description: "Round face, dark wavy hair",
  };
  p.visualStyle = {
    ...p.visualStyle,
    status: "locked",
    previewImage: "style-sheet",
  };
  p.typography = {
    ...p.typography,
    headingFont: "Verdana",
    bodyFont: "Arial",
    alignment: "right",
    textColor: "#123456",
  };
  p.cover = {
    ...emptyCover(),
    instructions: "Ava by the river",
    referencePhotos: ["cover-photo"],
  };
  const recipe = coverRecipe(p);
  assert.deepEqual(
    recipe.characters.map((c) => c.id),
    [p.characters[0].id],
  );
  assert.deepEqual(
    referenceAssets(recipe).map((r) => [r.id, r.role]),
    [
      ["ava-sheet", "identity"],
      ["style-sheet", "style"],
      ["cover-photo", "cover"],
    ],
  );
  const handler = createIllustrationHandler(() => ({
    async generate(prompt, photos) {
      assert.equal(photos.length, 3);
      assert.match(prompt, /Ava.*Round face, dark wavy hair/);
      assert.match(prompt, /Canonical identity = Image 1/);
      assert.match(
        prompt,
        /cover photos must not replace or alter these identities/,
      );
      assert.match(prompt, /heading font Verdana/);
      assert.match(prompt, /body font Arial/);
      assert.match(prompt, /alignment right, text color #123456/);
      assert.match(prompt, /Match the attached approved style sample/);
      assert.match(prompt, /do not draw any text/);
      return { bytes: png, model: "test" };
    },
  }));
  const form = new FormData();
  form.set("recipe", JSON.stringify(recipe));
  for (let i = 0; i < 3; i++)
    form.append(
      "images",
      new File([png], `reference-${i}.png`, { type: "image/png" }),
    );
  const response = await handler(
    new Request("http://localhost:3000/api/illustrations", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
      body: form,
    }),
  );
  assert.equal(response.status, 200);
});
