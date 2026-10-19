import test from "node:test";
import assert from "node:assert/strict";
import {
  createSceneDescriptionHandler,
  createSceneDescriptionProvider,
  SCENE_DESCRIPTION_INSTRUCTIONS,
  SCENE_DESCRIPTION_MODEL,
} from "../lib/server/scene-description";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQEBAKpZfQAAAABJRU5ErkJggg==",
  "base64",
);
function request(
  photos: File[] = [new File([png], "scene.png", { type: "image/png" })],
  names = '["Ava"]',
) {
  const form = new FormData();
  form.set("characters", names);
  photos.forEach((photo) => form.append("photos", photo));
  return new Request("http://localhost:3000/api/scene-description", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
    body: form,
  });
}
test("vision adapter sends scene photos separately with complete drafting instructions and no storage", async () => {
  let calls = 0;
  const transport: typeof fetch = async (url, init) => {
    calls++;
    assert.match(String(url), /\/responses$/);
    const body = JSON.parse(init!.body as string);
    assert.equal(body.model, SCENE_DESCRIPTION_MODEL);
    assert.equal(body.store, false);
    assert.equal(body.instructions, SCENE_DESCRIPTION_INSTRUCTIONS);
    for (const keyword of [
      "clothing",
      "pose",
      "background",
      "lighting",
      "ONLY source",
      "do not prescribe",
      "positional labels",
    ])
      assert.ok(body.instructions.includes(keyword));
    assert.match(
      body.input[0].content[1].image_url,
      /^data:image\/png;base64,/,
    );
    assert.equal(body.input[0].content[1].detail, "high");
    assert.equal(body.input[0].content.length, 2);
    return Response.json({
      id: "response",
      object: "response",
      status: "completed",
      output: [
        {
          id: "msg",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "The child on the left wears a red coat and points across the river.",
              annotations: [],
            },
          ],
        },
      ],
    });
  };
  const provider = createSceneDescriptionProvider("test-only-key", transport);
  const handle = createSceneDescriptionHandler(() => provider);
  const response = await handle(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match((await response.json()).description, /red coat/);
  assert.equal(calls, 1);
});
test("photo drafting rejects bad origins, invalid uploads, oversized inputs and invalid context before provider calls", async () => {
  let calls = 0;
  const handle = createSceneDescriptionHandler(() => ({
    async describe() {
      calls++;
      return "Scene";
    },
  }));
  const cross = request();
  cross.headers.set("origin", "https://other.example");
  assert.equal((await handle(cross)).status, 403);
  assert.equal((await handle(request([]))).status, 400);
  assert.equal(
    (
      await handle(
        request(
          Array.from(
            { length: 5 },
            () => new File([png], "photo.png", { type: "image/png" }),
          ),
        ),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handle(
        request([new File(["invalid"], "photo.png", { type: "image/png" })]),
      )
    ).status,
    400,
  );
  assert.equal((await handle(request(undefined, "not json"))).status, 400);
  const huge = request();
  huge.headers.set("content-length", String(30 * 1024 * 1024));
  assert.equal((await handle(huge)).status, 413);
  assert.equal(
    (
      await handle(
        request([
          new File([new Uint8Array(8 * 1024 * 1024 + 1)], "photo.png", {
            type: "image/png",
          }),
        ]),
      )
    ).status,
    413,
  );
  assert.equal(calls, 0);
  assert.equal(
    (await createSceneDescriptionHandler(() => undefined)(request())).status,
    503,
  );
});
test("concurrent photo drafts are blocked and a provider failure permits a later retry", async () => {
  let release!: () => void;
  let first = true;
  const handle = createSceneDescriptionHandler(() => ({
    async describe() {
      if (first) {
        first = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        throw new Error("private upstream detail");
      }
      return "A child looks at a river.";
    },
  }));
  const pending = handle(request());
  while (!release) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal((await handle(request())).status, 429);
  release();
  const failed = await pending;
  assert.equal(failed.status, 502);
  assert.doesNotMatch(await failed.text(), /private upstream detail/);
  assert.equal((await handle(request())).status, 200);
});
test("vision errors do not expose credentials or raw upstream messages", async () => {
  const provider = createSceneDescriptionProvider("secret-test-key", async () =>
    Response.json(
      { error: { message: "secret-test-key private details" } },
      { status: 401 },
    ),
  );
  const response = await createSceneDescriptionHandler(() => provider)(
    request(),
  );
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.match(text, /Check the API key/);
  assert.doesNotMatch(text, /secret-test-key|private details/);
});
