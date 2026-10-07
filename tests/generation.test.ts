import test from "node:test";
import assert from "node:assert/strict";
import { createProject, GenerationRecipe } from "../lib/model";
import { assemblePrompt, referenceAssets } from "../lib/recipe";
import { createIllustrationHandler } from "../lib/server/illustration-handler";
import {
  createOpenAIProvider,
  ImageGenerationError,
  IMAGE_MODEL,
} from "../lib/server/image-provider";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQEBAKpZfQAAAABJRU5ErkJggg==",
  "base64",
);
function recipe(): GenerationRecipe {
  const p = createProject();
  return {
    characters: [],
    visualStyle: p.visualStyle,
    scene: "Ava explores the Bund",
    references: [],
    composition: "Wide shot",
    exclusions: "cars",
    kind: "scene",
  };
}
function request(
  input: GenerationRecipe,
  files: File[] = [],
  origin = "http://localhost:3000",
) {
  const form = new FormData();
  form.set("recipe", JSON.stringify(input));
  files.forEach((f) => form.append("images", f));
  return new Request("http://localhost:3000/api/illustrations", {
    method: "POST",
    headers: { Origin: origin },
    body: form,
  });
}
test("references have explicit roles, deduplicate and preserve identity-first order", () => {
  const p = createProject();
  const c = {
    ...p.characters[0],
    status: "locked" as const,
    characterSheetImage: "sheet",
    primaryReferencePhoto: "portrait",
    referencePhotos: ["portrait"],
  };
  const input = {
    ...recipe(),
    characters: [c, p.characters[1]],
    visualStyle: {
      ...p.visualStyle,
      status: "locked" as const,
      previewImage: "style",
      referenceImages: ["inspiration"],
    },
    references: ["scene", "style"],
  };
  assert.deepEqual(
    referenceAssets(input).map((r) => r.id),
    ["sheet", "style", "inspiration", "scene"],
  );
  const prompt = assemblePrompt(input);
  assert.match(prompt, /Image 1: Ava: approved identity reference/);
  assert.match(prompt, /Image 4: Scene reference 1/);
  assert.doesNotMatch(prompt, /identity reference.*Mama/);
  assert.match(prompt, /Character: Mama/);
  assert.match(prompt, /no|Exclude/);
});
test("character sheets use primary and uploaded photos instead of stale sheet", () => {
  const p = createProject();
  const c = {
    ...p.characters[0],
    status: "locked" as const,
    characterSheetImage: "stale-sheet",
    primaryReferencePhoto: "b",
    referencePhotos: ["a", "b"],
  };
  assert.deepEqual(
    referenceAssets({
      ...recipe(),
      kind: "character",
      characters: [c],
      references: ["a", "b"],
    }).map((r) => r.id),
    ["b", "a"],
  );
});
test("unconfigured API returns a clear error without accepting uploads", async () => {
  const handle = createIllustrationHandler(() => undefined);
  const response = await handle(request(recipe()));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /IMAGE_API_KEY/);
});
test("handler sends validated references and recipe to provider and returns uncached PNG", async () => {
  let calls = 0;
  const handle = createIllustrationHandler(() => ({
    async generate(prompt, images) {
      calls++;
      assert.match(prompt, /Ava explores/);
      assert.equal(images.length, 1);
      assert.deepEqual(Buffer.from(await images[0].arrayBuffer()), png);
      return { bytes: png, model: IMAGE_MODEL };
    },
  }));
  const response = await handle(
    request({ ...recipe(), references: ["photo"] }, [
      new File([png], "photo.png", { type: "image/png" }),
    ]),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-illustration-model"), IMAGE_MODEL);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  assert.equal(calls, 1);
});
test("missing, forged and excessive references do not invoke provider", async () => {
  let calls = 0;
  const handle = createIllustrationHandler(() => ({
    async generate() {
      calls++;
      return { bytes: png, model: IMAGE_MODEL };
    },
  }));
  assert.equal(
    (await handle(request({ ...recipe(), references: ["photo"] }))).status,
    400,
  );
  assert.equal(
    (
      await handle(
        request({ ...recipe(), references: ["photo"] }, [
          new File(["bad"], "bad.png", { type: "image/png" }),
        ]),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handle(
        request({
          ...recipe(),
          references: Array.from({ length: 17 }, (_, i) => `photo-${i}`),
        }),
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
});
test("cross-origin requests and oversized bodies are rejected", async () => {
  let calls = 0;
  const handle = createIllustrationHandler(() => ({
    async generate() {
      calls++;
      return { bytes: png, model: IMAGE_MODEL };
    },
  }));
  assert.equal(
    (await handle(request(recipe(), [], "https://other.example"))).status,
    403,
  );
  const r = request(recipe());
  r.headers.set("content-length", String(30 * 1024 * 1024));
  assert.equal((await handle(r)).status, 413);
  assert.equal(calls, 0);
});
test("provider errors are shown safely and a later retry is permitted", async () => {
  let calls = 0;
  const handle = createIllustrationHandler(() => ({
    async generate() {
      if (calls++ === 0) throw new ImageGenerationError(429, "Quota reached.");
      return { bytes: png, model: IMAGE_MODEL };
    },
  }));
  const failure = await handle(request(recipe()));
  assert.equal(failure.status, 429);
  assert.equal((await failure.json()).error, "Quota reached.");
  assert.equal((await handle(request(recipe()))).status, 200);
});
test("concurrent requests do not create duplicate paid generations", async () => {
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  const handle = createIllustrationHandler(() => ({
    async generate() {
      await wait;
      return { bytes: png, model: IMAGE_MODEL };
    },
  }));
  const first = handle(request(recipe()));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await handle(request(recipe()))).status, 429);
  release();
  assert.equal((await first).status, 200);
});
test("OpenAI adapter uses generation or multipart editing with high fidelity and no retries", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const transport: typeof fetch = async (input, init) => {
    if (String(input).startsWith("data:")) return fetch(input, init);
    calls.push({ url: String(input), init });
    return Response.json({ data: [{ b64_json: png.toString("base64") }] });
  };
  const provider = createOpenAIProvider("test-only-credential", transport);
  await provider.generate("Draw a storybook", [], new AbortController().signal);
  assert.match(calls[0].url, /\/images\/generations$/);
  const body = JSON.parse(calls[0].init!.body as string);
  assert.equal(body.model, IMAGE_MODEL);
  assert.equal(body.size, "1024x1024");
  assert.equal(body.n, 1);
  assert.equal(body.output_format, "png");
  await provider.generate(
    "Use this likeness",
    [new File([png], "reference.png", { type: "image/png" })],
    new AbortController().signal,
  );
  assert.match(calls[1].url, /\/images\/edits$/);
  const form = calls[1].init!.body as FormData;
  assert.equal(form.get("input_fidelity"), "high");
  assert.equal(form.get("prompt"), "Use this likeness");
  assert.equal(
    Array.from(form.values()).filter((v) => v instanceof File).length,
    1,
  );
});
test("OpenAI errors never leak credentials or upstream messages", async () => {
  let calls = 0;
  const transport: typeof fetch = async () => {
    calls++;
    return Response.json(
      {
        error: {
          message: "private provider detail",
          type: "invalid_request_error",
        },
      },
      { status: 401 },
    );
  };
  const provider = createOpenAIProvider("test-only-credential", transport);
  await assert.rejects(
    provider.generate("Draw", [], new AbortController().signal),
    (e) =>
      e instanceof ImageGenerationError &&
      e.status === 503 &&
      !e.message.includes("private provider detail") &&
      !e.message.includes("test-only-credential"),
  );
  assert.equal(calls, 1);
});

test("same-origin validation uses the incoming Host when Next binds to 0.0.0.0", async () => {
  const handle = createIllustrationHandler(() => undefined);
  const req = new Request("http://0.0.0.0:3000/api/illustrations", {
    method: "POST",
    headers: { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" },
  });
  assert.equal((await handle(req)).status, 503);
});
