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
test("Flare adapter uses generation or multipart editing without legacy fidelity and with no retries", async () => {
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
  assert.equal(body.model, "gpt-image-2.5-flare");
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
  assert.equal(form.get("model"), "gpt-image-2.5-flare");
  assert.equal(form.has("input_fidelity"), false);
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

test("upstream model errors and nested network causes have safe actionable codes", async () => {
  const original = console.error;
  const logs: unknown[][] = [];
  console.error = (...args) => {
    logs.push(args);
  };
  try {
    const unavailable = createOpenAIProvider("test-only-credential", async () =>
      Response.json(
        {
          error: {
            message: "private provider detail",
            type: "invalid_request_error",
            code: "model_not_found",
          },
        },
        { status: 404 },
      ),
    );
    await assert.rejects(
      unavailable.generate("private scene", [], new AbortController().signal),
      (e) =>
        e instanceof ImageGenerationError &&
        /OPENAI_HTTP_404/.test(e.message) &&
        /model is unavailable/.test(e.message),
    );
    const disconnected = createOpenAIProvider(
      "test-only-credential",
      async () => {
        throw new TypeError("private transport detail", {
          cause: Object.assign(new Error("private cause"), {
            code: "ECONNRESET",
          }),
        });
      },
    );
    await assert.rejects(
      disconnected.generate("private scene", [], new AbortController().signal),
      (e) => e instanceof ImageGenerationError && /ECONNRESET/.test(e.message),
    );
    const output = JSON.stringify(logs);
    assert.doesNotMatch(
      output,
      /test-only-credential|private provider|private transport|private scene|private cause/,
    );
    assert.match(output, /ECONNRESET/);
    assert.match(output, /OPENAI_HTTP_404/);
  } finally {
    console.error = original;
  }
});

test("chapter approval checks prevent silent omission of character and style assets", async () => {
  const { sceneApprovalIssues } = await import("../lib/recipe");
  const p = createProject();
  const input = { ...recipe(), characters: [p.characters[0]] };
  assert.equal(sceneApprovalIssues(input).length, 2);
  const approved = {
    ...input,
    characters: [
      {
        ...p.characters[0],
        status: "locked" as const,
        characterSheetImage: "ava-sheet",
      },
    ],
    visualStyle: {
      ...p.visualStyle,
      status: "locked" as const,
      previewImage: "approved-style",
    },
  };
  assert.deepEqual(sceneApprovalIssues(approved), []);
  assert.deepEqual(
    referenceAssets(approved).map((r) => r.id),
    ["ava-sheet", "approved-style"],
  );
  assert.match(assemblePrompt(approved), /Approved style takes precedence/);
  const snapshot = structuredClone(approved);
  approved.visualStyle.previewImage = "new-style";
  approved.characters[0].characterSheetImage = "new-sheet";
  assert.deepEqual(
    referenceAssets(snapshot).map((r) => r.id),
    ["ava-sheet", "approved-style"],
  );
  assert.deepEqual(
    referenceAssets(approved).map((r) => r.id),
    ["new-sheet", "new-style"],
  );
});

test("style generation cannot include character identities even with legacy character inputs", async () => {
  const { prepareGenerationRecipe } = await import("../lib/recipe");
  const p = createProject();
  const input = {
    ...recipe(),
    kind: "style" as const,
    characters: [
      {
        ...p.characters[0],
        status: "locked" as const,
        characterSheetImage: "identity-sheet",
      },
    ],
    references: ["style-photo"],
    scene: "Ava and her family",
  };
  const normalized = prepareGenerationRecipe(input);
  assert.deepEqual(normalized.characters, []);
  assert.deepEqual(
    referenceAssets(input).map((r) => r.id),
    ["style-photo"],
  );
  const prompt = assemblePrompt(input);
  assert.match(prompt, /background-only/);
  assert.match(prompt, /No people, characters, faces/);
  assert.doesNotMatch(prompt, /Preserve character identity: Ava/);
  assert.doesNotMatch(prompt, /Ava and her family/);
});
test("character generation uses locked style in addition to identity photos and requires approval", async () => {
  const { generationApprovalIssues } = await import("../lib/recipe");
  const p = createProject();
  const input = {
    ...recipe(),
    kind: "character" as const,
    characters: [
      {
        ...p.characters[0],
        status: "locked" as const,
        referencePhotos: ["identity-photo"],
        primaryReferencePhoto: "identity-photo",
      },
    ],
  };
  assert.equal(generationApprovalIssues(input).length, 1);
  const approved = {
    ...input,
    visualStyle: {
      ...p.visualStyle,
      status: "locked" as const,
      previewImage: "background-style",
    },
  };
  assert.deepEqual(generationApprovalIssues(approved), []);
  assert.deepEqual(
    referenceAssets(approved).map((r) => r.id),
    ["identity-photo", "background-style"],
  );
  assert.match(
    assemblePrompt(approved),
    /Match the attached approved style sample/,
  );
  let called = false;
  const handler = createIllustrationHandler(() => ({
    async generate() {
      called = true;
      return { bytes: png, model: IMAGE_MODEL };
    },
  }));
  assert.equal((await handler(request(input))).status, 400);
  assert.equal(called, false);
});

test("every scene character has numbered canonical identity bindings without clothing-bearing raw photos", () => {
  const p = createProject();
  const input = {
    ...recipe(),
    characters: p.characters.map((c, i) => ({
      ...c,
      status: "locked" as const,
      characterSheetImage: `sheet-${i}`,
      primaryReferencePhoto: `photo-${i}`,
    })),
    visualStyle: {
      ...p.visualStyle,
      status: "locked" as const,
      previewImage: "style",
    },
    references: ["location"],
  };
  assert.deepEqual(
    referenceAssets(input).map((r) => r.id),
    ["sheet-0", "sheet-1", "sheet-2", "style", "location"],
  );
  const prompt = assemblePrompt(input);
  assert.match(prompt, /Ava\. Canonical identity = Image 1/);
  assert.match(prompt, /Mama\. Canonical identity = Image 2/);
  assert.match(prompt, /Papa\. Canonical identity = Image 3/);
  assert.match(prompt, /Never exchange identities/);
});
test("retries detect changed or unlocked Character Studio identities without changing the saved recipe", async () => {
  const { retryIdentityIssues, unselectedSceneCharacters } =
    await import("../lib/recipe");
  const p = createProject();
  const character = {
    ...p.characters[0],
    status: "locked" as const,
    characterSheetImage: "original",
  };
  const snapshot = { ...recipe(), characters: [character] };
  assert.deepEqual(retryIdentityIssues(snapshot, [character]), []);
  assert.match(
    retryIdentityIssues(snapshot, [
      { ...character, characterSheetImage: "new" },
    ])[0],
    /Edit & Regenerate/,
  );
  assert.match(
    retryIdentityIssues(snapshot, [{ ...character, status: "draft" }])[0],
    /Lock their character/,
  );
  assert.equal(snapshot.characters[0].characterSheetImage, "original");
  assert.deepEqual(
    unselectedSceneCharacters("Ava and Mama visit the Bund.", p.characters, [
      p.characters[0].id,
    ]),
    ["Mama"],
  );
  assert.deepEqual(
    unselectedSceneCharacters("A pavilion at sunset.", p.characters, []),
    [],
  );
});

test("scene name detection respects whole names and literal punctuation", async () => {
  const { unselectedSceneCharacters } = await import("../lib/recipe");
  const p = createProject();
  assert.deepEqual(
    unselectedSceneCharacters("Avana visits a pavilion.", p.characters, []),
    [],
  );
  const dotted = { ...p.characters[0], name: "Dr. Lin" };
  assert.deepEqual(
    unselectedSceneCharacters("DrX Lin walks away.", [dotted], []),
    [],
  );
  assert.deepEqual(unselectedSceneCharacters("Dr. Lin smiles.", [dotted], []), [
    "Dr. Lin",
  ]);
});

test("character portraits exclude clothing and chapter identity references never supply outfits", () => {
  const p = createProject();
  const character = {
    ...p.characters[0],
    status: "locked" as const,
    characterSheetImage: "face",
    primaryReferencePhoto: "clothed-photo",
    description: "Ava wearing a red coat",
  };
  const portrait = {
    ...recipe(),
    kind: "character" as const,
    characters: [character],
  };
  assert.match(assemblePrompt(portrait), /canonical face-only identity sheet/);
  assert.match(
    assemblePrompt(portrait),
    /No neck, shoulders, torso, full body, clothing/,
  );
  const scene = { ...recipe(), characters: [character] };
  assert.deepEqual(
    referenceAssets(scene).map((r) => r.id),
    ["face"],
  );
  assert.match(
    assemblePrompt(scene),
    /outfits and accessories may come from scene photographs/,
  );
});

test("scene photos supply clothing and placement without supplying identity", () => {
  const p = createProject();
  const input = {
    ...recipe(),
    characters: [
      {
        ...p.characters[0],
        status: "locked" as const,
        characterSheetImage: "ava-face",
      },
    ],
    visualStyle: {
      ...p.visualStyle,
      status: "locked" as const,
      previewImage: "style-sample",
    },
    references: ["chapter-photo", "page-photo"],
  };
  assert.deepEqual(
    referenceAssets(input).map((r) => r.role),
    ["identity", "style", "scene-layout", "scene-layout"],
  );
  const prompt = assemblePrompt(input);
  assert.match(prompt, /SCENE-ONLY REFERENCE — Image 3/);
  assert.match(prompt, /SCENE-ONLY REFERENCE — Image 4/);
  assert.match(
    prompt,
    /position, scale, outfits and accessories only, never identity/,
  );
  assert.match(
    prompt,
    /Discard their faces, hair, skin tone, age, gender and body shape/,
  );
  assert.match(prompt, /Source-photo crowds do not determine the story cast/);
  assert.match(
    prompt,
    /Explicit written scene instructions override source-photo clothing and placement/,
  );
  assert.match(prompt, /without copying the photographed wearer/);
  assert.doesNotMatch(
    prompt,
    /scene images for location, clothing, objects or pose/,
  );
  const tweak = {
    ...input,
    tweak: {
      sourceImage: "original",
      sourceVersionId: "version",
      feedback: "Fix the face",
      region: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
    },
  };
  assert.match(assemblePrompt(tweak), /SCENE-ONLY REFERENCE — Image 4/);
  assert.match(assemblePrompt(tweak), /SCENE-ONLY REFERENCE — Image 5/);
});

test("Flare reference edits succeed against an API that rejects legacy input_fidelity", async () => {
  let calls = 0;
  const transport: typeof fetch = async (_url, init) => {
    if (String(_url).startsWith("data:")) return fetch(_url, init);
    calls++;
    const form = init!.body as FormData;
    if (form.has("input_fidelity"))
      return Response.json(
        {
          error: {
            message: "Unknown parameter",
            param: "input_fidelity",
            code: "unsupported_parameter",
          },
        },
        { status: 400 },
      );
    assert.equal(form.get("model"), "gpt-image-2.5-flare");
    assert.equal(form.get("size"), "1024x1024");
    assert.equal(form.get("quality"), "high");
    assert.ok(form.get("image[]") instanceof File);
    return Response.json({ data: [{ b64_json: png.toString("base64") }] });
  };
  const result = await createOpenAIProvider(
    "test-only-credential",
    transport,
  ).generate(
    "Illustrate Ava with the approved sheet",
    [new File([png], "face.png", { type: "image/png" })],
    new AbortController().signal,
  );
  assert.equal(result.model, IMAGE_MODEL);
  assert.deepEqual(Buffer.from(result.bytes), png);
  assert.equal(calls, 1);
});

test("HTTP 400 diagnostics distinguish model, settings, image and moderation without exposing arbitrary values", async () => {
  const original = console.error;
  const logs: unknown[][] = [];
  console.error = (...args) => {
    logs.push(args);
  };
  try {
    const cases = [
      {
        param: "input_fidelity",
        code: "unsupported_parameter",
        expected: /parameter "input_fidelity".*unsupported_parameter/,
      },
      {
        param: "quality",
        code: "unsupported_value",
        expected: /parameter "quality".*unsupported_value/,
      },
      {
        param: "model",
        code: "model_not_found",
        expected: /configured image model.*gpt-image-2.5-flare/,
      },
      {
        param: "image[0]",
        code: "invalid_image",
        expected: /rejected a reference image/,
      },
      {
        param: "mask",
        code: "invalid_value",
        expected: /rejected the edit mask/,
      },
      {
        param: "prompt",
        code: "content_policy_violation",
        expected: /content rules/,
      },
      {
        param: "secret-test-key",
        code: "private-upstream-detail",
        expected: /without a recognized parameter or reason/,
      },
    ];
    for (const scenario of cases) {
      let calls = 0;
      const provider = createOpenAIProvider("secret-test-key", async () => {
        calls++;
        return Response.json(
          {
            error: {
              message: "private scene and secret-test-key",
              param: scenario.param,
              code: scenario.code,
            },
          },
          { status: 400 },
        );
      });
      await assert.rejects(
        provider.generate("private scene", [], new AbortController().signal),
        (error) => {
          assert.ok(error instanceof ImageGenerationError);
          assert.equal(error.status, 422);
          assert.match(error.message, scenario.expected);
          assert.match(error.message, /OPENAI_HTTP_400/);
          assert.doesNotMatch(
            error.message,
            /secret-test-key|private scene|private-upstream-detail/,
          );
          return true;
        },
      );
      assert.equal(calls, 1);
    }
    const output = JSON.stringify(logs);
    assert.match(output, /input_fidelity/);
    assert.match(output, /unsupported_parameter/);
    assert.doesNotMatch(
      output,
      /secret-test-key|private scene|private-upstream-detail/,
    );
  } finally {
    console.error = original;
  }
});
