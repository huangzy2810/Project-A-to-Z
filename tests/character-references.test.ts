import test from "node:test";
import assert from "node:assert/strict";
import {
  assertProject,
  createProject,
  type GenerationRecipe,
} from "../lib/model";
import {
  bodyApprovalIssues,
  bodySignature,
  lineupMembers,
  lineupSignature,
  lineupApprovalIssues,
} from "../lib/character-references";
import {
  assemblePrompt,
  referenceAssets,
  generationApprovalIssues,
  prepareGenerationRecipe,
  retryIdentityIssues,
} from "../lib/recipe";
import { createIllustrationHandler } from "../lib/server/illustration-handler";
import { makeChapterJob, jobApprovalIssues } from "../lib/generation-queue";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQEBAKpZfQAAAABJRU5ErkJggg==",
  "base64",
);
function fixture() {
  const p = createProject();
  p.visualStyle.status = "locked";
  p.visualStyle.previewImage = "style";
  p.characters = p.characters.slice(0, 2).map((c, i) => ({
    ...c,
    status: "locked",
    characterSheetImage: `face-${i}`,
    primaryReferencePhoto: `raw-face-${i}`,
    referencePhotos: [`raw-face-${i}`],
    body: {
      heightCm: i ? 170 : 100,
      build: i ? "medium frame" : "small frame",
      proportions: "natural upright posture",
      referencePhotos: [`raw-body-${i}`],
    },
  }));
  for (const c of p.characters)
    c.body!.sheet = {
      image: `body-${c.name}`,
      prompt: "Body draft",
      model: "test",
      status: "locked",
      signature: bodySignature(c, p.visualStyle),
    };
  const members = lineupMembers(p.characters, p.visualStyle);
  p.castLineup = {
    members,
    sheet: {
      image: "lineup",
      prompt: "Cast draft",
      model: "test",
      status: "locked",
      signature: lineupSignature(members, p.visualStyle),
    },
  };
  p.chapters[0].pages[0].characterIds = p.characters.map((c) => c.id);
  p.chapters[0].pages[0].sceneDescription = "Ava and Mama wave by the river.";
  return p;
}
function recipe(kind: GenerationRecipe["kind"] = "scene"): GenerationRecipe {
  const p = fixture();
  return {
    kind,
    characters:
      kind === "body" || kind === "character"
        ? p.characters.slice(0, 1)
        : p.characters,
    visualStyle: p.visualStyle,
    castLineup: p.castLineup,
    scene: "Ava and Mama wave by the river.",
    references: [],
    composition: "Wide",
    exclusions: "",
    requiredElements: "red coats",
  };
}
test("face, body, lineup and scene references have distinct roles and never send raw body photos to chapters", () => {
  const face = recipe("character");
  assert.deepEqual(
    referenceAssets(face).map((r) => r.id),
    ["raw-face-0", "style"],
  );
  assert.deepEqual(
    referenceAssets(recipe("body")).map((r) => r.id),
    ["face-0", "raw-body-0", "style"],
  );
  assert.deepEqual(
    referenceAssets(recipe("lineup")).map((r) => r.id),
    ["face-0", "face-1", "body-Ava", "body-Mama", "style"],
  );
  const scene = recipe();
  scene.references = ["scene-photo"];
  assert.deepEqual(
    referenceAssets(scene).map((r) => [r.id, r.role]),
    [
      ["face-0", "identity"],
      ["face-1", "identity"],
      ["body-Ava", "body"],
      ["body-Mama", "body"],
      ["lineup", "lineup"],
      ["style", "style"],
    ],
  );
  const prompt = assemblePrompt(scene);
  assert.match(prompt, /Ava\. Canonical identity = Image 1/);
  assert.match(prompt, /BODY CONTRACT — Ava: Image 3/);
  assert.match(prompt, /HEIGHT CONTRACT — Image 5/);
  assert.match(prompt, /never extra lineup people/);
  assert.match(prompt, /Do not copy its neutral clothing/);
  assert.doesNotMatch(prompt, /raw-body|scene-photo/);
  assert.match(
    assemblePrompt({
      ...scene,
      tweak: {
        sourceImage: "original",
        sourceVersionId: "previous",
        feedback: "Fix proportions",
        region: { x: 0, y: 0, width: 0.5, height: 0.5 },
      },
    }),
    /HEIGHT CONTRACT — Image 6/,
  );
});
test("body and lineup prompts use neutral clothes, face bindings and shared-baseline height ratios", () => {
  const body = assemblePrompt(recipe("body"));
  assert.match(body, /front, side and three-quarter/);
  assert.match(body, /plain neutral gray/);
  assert.match(body, /fully clothed/i);
  assert.match(body, /facial identity = Image 1/);
  const lineup = assemblePrompt(recipe("lineup"));
  assert.match(lineup, /SAME ground baseline/);
  assert.match(lineup, /Ava: 100 cm; Mama: 170 cm/);
  assert.match(lineup, /body proportions = Image 3/);
  assert.match(lineup, /Do not make everyone the same height/);
  assert.match(
    assemblePrompt(recipe("character")),
    /No neck, shoulders, torso, full body, clothing/,
  );
});
test("approval gates enforce current body sheets and a lineup for multi-character upgraded scenes, without breaking legacy books", () => {
  const input = recipe();
  assert.deepEqual(generationApprovalIssues(input), []);
  input.castLineup = undefined;
  assert.match(
    generationApprovalIssues(input).join(" "),
    /approve a relative-height lineup/,
  );
  input.characters = [input.characters[0]];
  assert.deepEqual(generationApprovalIssues(input), []);
  input.characters[0].body!.sheet!.status = "draft";
  assert.match(
    generationApprovalIssues(input).join(" "),
    /approve Ava's body sheet/,
  );
  delete input.characters[0].body;
  assert.deepEqual(generationApprovalIssues(input), []);
  const body = recipe("body");
  body.characters[0].status = "draft";
  assert.match(
    generationApprovalIssues(body).join(" "),
    /Approve Ava's face sheet first/,
  );
});
test("height, build, face and style changes invalidate body and lineup approvals and queued snapshots", () => {
  for (const mutation of [
    (p: ReturnType<typeof fixture>) => (p.characters[0].body!.heightCm = 110),
    (p: ReturnType<typeof fixture>) =>
      (p.characters[0].body!.build = "broad frame"),
    (p: ReturnType<typeof fixture>) =>
      (p.characters[0].characterSheetImage = "new-face"),
    (p: ReturnType<typeof fixture>) =>
      (p.visualStyle.previewImage = "new-style"),
  ]) {
    const p = fixture();
    const job = makeChapterJob(p, p.chapters[0].pages[0]);
    mutation(p);
    assert.ok(bodyApprovalIssues(p.characters[0], p.visualStyle).length);
    assert.ok(
      lineupApprovalIssues(p.castLineup, p.characters, p.visualStyle).length,
    );
    assert.ok(jobApprovalIssues(p, job).length);
  }
});
test("trimmed saved recipes keep valid body signatures and retries do not fail on history/prompt metadata", () => {
  const input = recipe();
  input.characters[0].body!.history = [{ ...input.characters[0].body!.sheet! }];
  const saved = prepareGenerationRecipe(input);
  assert.equal(saved.characters[0].body!.history, undefined);
  assert.equal(saved.characters[0].body!.sheet!.prompt, "");
  assert.deepEqual(generationApprovalIssues(saved), []);
  assert.deepEqual(retryIdentityIssues(saved, input.characters), []);
  assert.equal(input.characters[0].body!.sheet!.prompt, "Body draft");
});
async function request(input: GenerationRecipe) {
  const normalized = prepareGenerationRecipe(input);
  const form = new FormData();
  form.set("recipe", JSON.stringify(normalized));
  referenceAssets(input).forEach((r) =>
    form.append(
      "images",
      new File([png], `${r.id}.png`, { type: "image/png" }),
    ),
  );
  return new Request("http://localhost:3000/api/illustrations", {
    method: "POST",
    headers: { origin: "http://localhost:3000" },
    body: form,
  });
}
test("real upload handler preserves body/lineup metadata, validates stale approvals and sends ordered files to provider", async () => {
  const calls: string[][] = [];
  const handler = createIllustrationHandler(() => ({
    async generate(prompt, files) {
      calls.push(files.map((f) => f.name));
      assert.match(prompt, /Body proportions/);
      return { bytes: png, model: "test" };
    },
  }));
  assert.equal((await handler(await request(recipe("body")))).status, 200);
  assert.equal((await handler(await request(recipe("lineup")))).status, 200);
  assert.equal((await handler(await request(recipe()))).status, 200);
  assert.deepEqual(calls[2], [
    "face-0.png",
    "face-1.png",
    "body-Ava.png",
    "body-Mama.png",
    "lineup.png",
    "style.png",
  ]);
  const stale = recipe();
  stale.characters[0].body!.heightCm = 120;
  assert.equal((await handler(await request(stale))).status, 400);
  assert.equal(calls.length, 3);
});

test("incomplete body measurements remain loadable drafts while generation rejects them", () => {
  const p = fixture();
  p.characters[0].body!.heightCm = 0;
  assert.doesNotThrow(() => assertProject(JSON.parse(JSON.stringify(p))));
  assert.match(
    bodyApprovalIssues(p.characters[0], p.visualStyle).join(" "),
    /standing height/,
  );
});

test("face generation is independent of incomplete body drafts and unrelated lineups", async () => {
  const input = recipe("character");
  input.characters[0].body!.heightCm = 0;
  const normalized = prepareGenerationRecipe(input);
  assert.equal(normalized.characters[0].body, undefined);
  assert.equal(normalized.castLineup, undefined);
  const handler = createIllustrationHandler(() => ({
    async generate(_prompt, files) {
      assert.equal(files.length, 2);
      return { bytes: png, model: "test" };
    },
  }));
  assert.equal((await handler(await request(input))).status, 200);
});
