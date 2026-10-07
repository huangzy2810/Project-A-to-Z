import test from "node:test";
import assert from "node:assert/strict";
import { createProject, updatePage, assertProject } from "../lib/model";
import { assemblePrompt } from "../lib/generation";
import { orderedPages } from "../components/BookPage";
test("default book has a complete editable structure and reading order", () => {
  const p = createProject();
  assertProject(p);
  assert.equal(p.characters.length, 3);
  assert.equal(p.settings.bookSize, "8 × 8 inches");
  assert.deepEqual(
    orderedPages(p).map((p) => p.kind),
    ["cover", "story", "letter"],
  );
  assertProject(JSON.parse(JSON.stringify(p)));
});
test("locked pages reject changes until explicitly unlocked", () => {
  let p = createProject();
  const s = p.chapters[0].pages[0];
  p = updatePage(p, s.id, {
    status: "locked",
    lockedTypography: { ...p.typography },
  });
  p = updatePage(p, s.id, { storyText: "overwrite" });
  assert.equal(p.chapters[0].pages[0].storyText, s.storyText);
  p = updatePage(p, s.id, { status: "draft" });
  p = updatePage(p, s.id, { storyText: "edited" });
  assert.equal(p.chapters[0].pages[0].storyText, "edited");
});
test("prompt uses approved selected identities, references and exclusions", () => {
  const p = createProject();
  p.characters[0].status = "locked";
  const prompt = assemblePrompt({
    characters: [p.characters[0], p.characters[1]],
    visualStyle: p.visualStyle,
    scene: "At the Bund",
    references: ["photo-id"],
    composition: "Wide shot",
    exclusions: "cars",
    requiredElements: "red scarf",
  });
  assert.match(prompt, /Preserve character identity: Ava/);
  assert.doesNotMatch(prompt, /Preserve character identity: Mama/);
  assert.match(prompt, /photo-id/);
  assert.match(prompt, /red scarf/);
  assert.match(prompt, /no|Exclude/);
});
test("memory layouts preserve every photograph in reading order", () => {
  const p = createProject();
  p.photoMemories = Array.from({ length: 5 }, (_, i) => ({
    id: String(i),
    image: String(i),
    caption: "",
    position: 50,
  }));
  const pages = orderedPages(p).filter((p) => p.kind === "memories");
  assert.equal(pages.length, 3);
  assert.deepEqual(
    pages.flatMap((p) => p.photos!.map((p) => p.image)),
    ["0", "1", "2", "3", "4"],
  );
});
test("invalid saved projects are rejected", () => {
  assert.throws(() => assertProject({ schemaVersion: 42 }));
  assert.throws(() => assertProject(null));
});
