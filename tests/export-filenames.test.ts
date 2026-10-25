import test from "node:test";
import assert from "node:assert/strict";
import { jpegPageFilename, safeBookFilename } from "../lib/export-filenames";
test("JPEG names preserve book title case, spaces and Unicode with global page numbering", () => {
  assert.equal(
    jpegPageFilename("Ava’s Shanghai Book", 1, 4),
    "Ava’s Shanghai Book - Page 1.jpg",
  );
  assert.equal(jpegPageFilename("上海旅行记", 4, 4), "上海旅行记 - Page 4.jpg");
  assert.equal(jpegPageFilename("", 1, 1), "Book - Page 1.jpg");
});
test("zero-padded page numbers sort in reading order for larger books", () => {
  const names = Array.from({ length: 12 }, (_, i) =>
    jpegPageFilename("BOOK NAME", i + 1, 12),
  );
  assert.equal(names[0], "BOOK NAME - Page 01.jpg");
  assert.equal(names[11], "BOOK NAME - Page 12.jpg");
  assert.deepEqual([...names].sort(), names);
  assert.throws(() => jpegPageFilename("Book", 0, 4), /Invalid/);
  assert.throws(() => jpegPageFilename("Book", 5, 4), /Invalid/);
});
test("archive names cannot create paths and remain within common filename byte limits", () => {
  assert.doesNotMatch(
    safeBookFilename('../Book: "test" / \\ name?*<>|\u0000'),
    /[<>:"/\\|?*\u0000-\u001f]/,
  );
  assert.equal(safeBookFilename("..."), "Book");
  const name = jpegPageFilename("🦋".repeat(200), 12, 12);
  assert.ok(new TextEncoder().encode(name).length < 255);
  assert.equal(safeBookFilename("e\u0301"), "é");
});
