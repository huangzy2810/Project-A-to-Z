import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { pixelRegion, validRegion } from "../lib/regions";
import { editMask } from "../lib/server/edit-mask";
import { createIllustrationHandler } from "../lib/server/illustration-handler";
import {
  createOpenAIProvider,
  IMAGE_MODEL,
} from "../lib/server/image-provider";
import { assemblePrompt, generationReferenceManifest } from "../lib/recipe";
import { createProject, GenerationRecipe } from "../lib/model";
function recipe(): GenerationRecipe {
  const p = createProject();
  return {
    kind: "scene",
    characters: [],
    visualStyle: p.visualStyle,
    scene: "A quiet riverside",
    references: [],
    composition: "Wide",
    exclusions: "",
    tweak: {
      sourceImage: "original-asset",
      sourceVersionId: "original-version",
      feedback: "Repair this face",
      region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    },
  };
}
async function original() {
  return new File(
    [
      Uint8Array.from(
        await sharp({
          create: { width: 16, height: 16, channels: 4, background: "#335577" },
        })
          .png()
          .toBuffer(),
      ),
    ],
    "original.png",
    { type: "image/png" },
  );
}
function request(input: GenerationRecipe, file?: File) {
  const form = new FormData();
  form.set("recipe", JSON.stringify(input));
  if (file) form.set("original", file);
  return new Request("http://localhost:3000/api/illustrations", {
    method: "POST",
    headers: { Origin: "http://localhost:3000" },
    body: form,
  });
}
test("regions reject invalid selections and quantize to bounded source pixels", () => {
  assert.equal(validRegion({ x: 0, y: 0, width: 0, height: 0.5 }), false);
  assert.equal(validRegion({ x: 0.9, y: 0, width: 0.2, height: 0.5 }), false);
  assert.equal(validRegion({ x: NaN, y: 0, width: 0.2, height: 0.5 }), false);
  assert.deepEqual(
    pixelRegion({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 16, 16),
    { x: 4, y: 4, width: 8, height: 8 },
  );
  assert.deepEqual(
    pixelRegion({ x: 0.99, y: 0.99, width: 0.01, height: 0.01 }, 16, 16),
    { x: 15, y: 15, width: 1, height: 1 },
  );
});
test("mask matches original dimensions and is transparent only inside selected area", async () => {
  const mask = await editMask(await original(), recipe().tweak!.region);
  const { data, info } = await sharp(Buffer.from(await mask.arrayBuffer()))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 16);
  assert.equal(info.height, 16);
  let editable = 0;
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const alpha = data[(y * 16 + x) * 4 + 3];
      const inside = x >= 4 && x < 12 && y >= 4 && y < 12;
      assert.equal(alpha, inside ? 0 : 255);
      if (!alpha) editable++;
    }
  assert.equal(editable, 64);
});
test("API prepends original, generates mask and keeps failed edits recoverable", async () => {
  const source = await original();
  let calls = 0;
  const handle = createIllustrationHandler(() => ({
    async generate(prompt, images, _signal, mask) {
      calls++;
      assert.match(prompt, /Repair Image 1/);
      assert.match(prompt, /Requested local change: Repair this face/);
      assert.equal(images.length, 1);
      assert.equal(images[0].name, "original.png");
      assert.ok(mask);
      const metadata = await sharp(
        Buffer.from(await mask.arrayBuffer()),
      ).metadata();
      assert.equal(metadata.width, 16);
      return {
        bytes: new Uint8Array(await source.arrayBuffer()),
        model: IMAGE_MODEL,
      };
    },
  }));
  assert.equal((await handle(request(recipe()))).status, 400);
  assert.equal(calls, 0);
  assert.equal(
    (
      await handle(
        request(
          {
            ...recipe(),
            tweak: {
              ...recipe().tweak!,
              region: { x: 0.9, y: 0, width: 0.5, height: 0.2 },
            },
          },
          source,
        ),
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
  assert.equal((await handle(request(recipe(), source))).status, 200);
  assert.equal(calls, 1);
});
test("tweak identity image numbers account for original image first", () => {
  const p = createProject();
  const input = {
    ...recipe(),
    characters: [
      {
        ...p.characters[0],
        status: "locked" as const,
        characterSheetImage: "approved-face",
      },
    ],
  };
  assert.match(assemblePrompt(input), /Ava\. Canonical identity = Image 2/);
  assert.deepEqual(
    generationReferenceManifest(input).map((r) => r.id),
    ["original-asset", "approved-face"],
  );
});
test("official SDK sends mask alongside original via multipart editing", async () => {
  const source = await original();
  const mask = await editMask(source, recipe().tweak!.region);
  let form: FormData | undefined;
  const transport: typeof fetch = async (input, init) => {
    if (String(input).startsWith("data:")) return fetch(input, init);
    form = init?.body as FormData;
    return Response.json({
      data: [
        {
          b64_json: Buffer.from(await source.arrayBuffer()).toString("base64"),
        },
      ],
    });
  };
  await createOpenAIProvider("test-only-credential", transport).generate(
    "Repair the marked face",
    [source],
    new AbortController().signal,
    mask,
  );
  assert.ok(form);
  assert.equal(form.get("model"), "gpt-image-2.5-flare");
  assert.ok(form.get("mask") instanceof File);
  assert.equal((form.get("mask") as File).size, mask.size);
  assert.equal(form.has("input_fidelity"), false);
  assert.equal(
    Array.from(form.values()).filter((v) => v instanceof File).length,
    2,
  );
});
test("four-view face sheet requires consistent identity and excludes bodies and clothing", () => {
  const input = { ...recipe(), kind: "character" as const, tweak: undefined };
  const prompt = assemblePrompt(input);
  assert.match(prompt, /exactly four tightly cropped views/);
  assert.match(prompt, /front, three-quarter, side profile, and front smiling/);
  assert.match(prompt, /No neck, shoulders, torso, full body, clothing/);
  assert.match(prompt, /identical across all four views/);
});
