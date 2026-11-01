import test from "node:test";
import assert from "node:assert/strict";
import { createProject } from "../lib/model";
import { bookAssetIds } from "../lib/book-backup";
test("editable backups include images from selected and historical versions, raw photos and nested tweak recipes without mistaking text for assets", () => {
  const p = createProject();
  p.title = "not-an-asset";
  p.characters[0].referencePhotos = ["raw-face"];
  p.visualStyle.previewImage = "style";
  p.closingMessage.photo = "letter";
  p.photoMemories = [
    {
      id: "memory-id",
      image: "memory-image",
      caption: "not-an-asset",
      position: 50,
    },
  ];
  p.chapters[0].pages[0].scenePhotoDraft = {
    description: "Draft",
    photoIds: ["scene"],
  };
  p.chapters[0].pages[0].illustrationVersions = [
    {
      id: "old-version",
      image: "old-image",
      prompt: "not-an-asset",
      createdAt: "",
      model: "test",
      characterReferences: ["old-face"],
      sceneReferences: [],
      recipe: {
        characters: [],
        visualStyle: p.visualStyle,
        scene: "not-an-asset",
        references: [],
        composition: "",
        exclusions: "",
        tweak: {
          sourceImage: "original-edit",
          sourceVersionId: "version-id",
          feedback: "not-an-asset",
          region: { x: 0, y: 0, width: 1, height: 1 },
        },
      },
    },
  ];
  assert.deepEqual(
    new Set(bookAssetIds(p)),
    new Set([
      "raw-face",
      "style",
      "letter",
      "memory-image",
      "scene",
      "old-image",
      "old-face",
      "original-edit",
    ]),
  );
});
