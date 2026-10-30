import test from "node:test";
import assert from "node:assert/strict";
import { createProject, assertProject } from "../lib/model";
import { deleteCharacter } from "../lib/characters";
import {
  memoryPages,
  setMemoryPagePhotos,
  deleteMemoryPage,
} from "../lib/photo-memory-pages";
import { orderedPages } from "../components/BookPage";

test("character deletion removes cast selections, preserves artwork and supports an empty studio", () => {
  let p = createProject();
  const id = p.characters[0].id;
  p.chapters[0].pages[0].characterIds = [id, p.characters[1].id];
  p.chapters[0].pages[0].status = "locked";
  p.cover = {
    instructions: "Family",
    characterIds: [id],
    referencePhotos: [],
    illustrationVersions: [],
  };
  const story = p.chapters[0].pages[0].storyText;
  p = deleteCharacter(p, id);
  assert.equal(p.characters.length, 2);
  assert.deepEqual(p.cover?.characterIds, []);
  assert.deepEqual(p.chapters[0].pages[0].characterIds, [p.characters[0].id]);
  assert.equal(p.chapters[0].pages[0].status, "locked");
  assert.equal(p.chapters[0].pages[0].storyText, story);
  for (const c of p.characters) p = deleteCharacter(p, c.id);
  assert.equal(p.characters.length, 0);
  assertProject(p);
});

test("legacy memory photos keep order and captions; explicit pages can be added, split and deleted without dropping other content", () => {
  let p = createProject();
  p.photoMemories = Array.from({ length: 5 }, (_, i) => ({
    id: `photo-${i}`,
    image: `asset-${i}`,
    caption: `Caption ${i}`,
    position: i,
  }));
  const initial = memoryPages(p);
  assert.equal(initial.length, 3);
  assert.deepEqual(
    initial.flatMap((page) => page.photoIds),
    p.photoMemories.map((photo) => photo.id),
  );
  p.photoMemoryPages = [...initial, { id: "blank", photoIds: [] }];
  assert.equal(
    orderedPages(p).filter((page) => page.kind === "memories").length,
    4,
  );
  p = setMemoryPagePhotos(p, "blank", ["new-1", "new-2", "new-3"]);
  assert.equal(memoryPages(p).length, 5);
  assert.equal(new Set(memoryPages(p).map((page) => page.id)).size, 5);
  p = deleteMemoryPage(p, initial[1].id);
  const printed = orderedPages(p).filter((page) => page.kind === "memories");
  assert.equal(printed.length, 4);
  assert.deepEqual(
    printed.flatMap((page) => page.photos!.map((photo) => photo.image)),
    ["asset-0", "asset-1", "asset-4", "new-1", "new-2", "new-3"],
  );
  assert.equal(
    p.photoMemories.find((photo) => photo.id === "photo-4")?.caption,
    "Caption 4",
  );
  for (const page of memoryPages(p)) p = deleteMemoryPage(p, page.id);
  assert.deepEqual(p.photoMemories, []);
  assert.deepEqual(memoryPages(p), []);
  assert.equal(
    orderedPages(p).filter((page) => page.kind === "memories").length,
    0,
  );
  assertProject(p);
});

test("layout changes preserve all photos and unique page IDs even when page suffixes already exist", () => {
  const p = createProject();
  p.exportSettings.memoryLayout = 1;
  p.photoMemoryPages = [
    { id: "page", photoIds: ["a", "b", "c"] },
    { id: "page-1", photoIds: ["d"] },
  ];
  const pages = memoryPages(p);
  assert.equal(new Set(pages.map((page) => page.id)).size, 4);
  assert.deepEqual(
    pages.flatMap((page) => page.photoIds),
    ["a", "b", "c", "d"],
  );
});
