import { assertProject, BookProject } from "./model";
export const PROJECT_KEY = "ava-book-project-v3";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("ava-book-assets-v3", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("assets");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () =>
      reject(
        new Error(
          "Image storage is unavailable. Check your browser storage settings.",
        ),
      );
  });
}
export async function putAsset(blob: Blob): Promise<string> {
  const db = await database();
  const id = crypto.randomUUID();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("assets", "readwrite");
      t.objectStore("assets").put(blob, id);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
    return id;
  } finally {
    db.close();
  }
}
export async function getAsset(id: string): Promise<Blob> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction("assets").objectStore("assets").get(id);
      r.onsuccess = () =>
        r.result
          ? resolve(r.result)
          : reject(
              new Error(
                "An image is missing from local storage. Please upload it again.",
              ),
            );
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
// Book metadata uses its own database so existing image connections need no upgrade.
export const DATA_DATABASE = "ava-book-data-v3";
function dataDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATA_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("records");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error("Book storage is unavailable."));
    request.onblocked = () =>
      reject(
        new Error(
          "Book storage is blocked by another tab. Keep this book open and close other book tabs.",
        ),
      );
  });
}
async function readRecord(key: string): Promise<string | undefined> {
  const db = await dataDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("records");
      const request = tx.objectStore("records").get(key);
      let value: string | undefined;
      request.onsuccess = () => {
        value = request.result;
      };
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
let writes: Promise<unknown> = Promise.resolve();
export function writeRecord(
  key: string,
  value: string | undefined,
): Promise<void> {
  // Capture immutable serialized data at call time; commit in invocation order.
  const write = writes
    .catch(() => {})
    .then(async () => {
      const db = await dataDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("records", "readwrite");
          if (value === undefined) tx.objectStore("records").delete(key);
          else tx.objectStore("records").put(value, key);
          tx.oncomplete = () => resolve();
          tx.onabort = tx.onerror = () =>
            reject(tx.error || new Error("Book save failed."));
        });
      } finally {
        db.close();
      }
    });
  writes = write;
  return write;
}
export async function loadRecord(
  key: string,
  validate: (raw: string) => void,
): Promise<string | undefined> {
  const stored = await readRecord(key);
  if (stored !== undefined) {
    validate(stored);
    return stored;
  }
  // Read legacy data only when no IndexedDB copy exists. Never erase invalid data.
  let legacy: string | null;
  try {
    legacy = localStorage.getItem(key);
  } catch {
    throw new Error(
      "Legacy browser storage could not be read. Your saved data has been preserved; check browser storage permissions.",
    );
  }
  if (legacy === null) return undefined;
  validate(legacy);
  await writeRecord(key, legacy);
  if ((await readRecord(key)) !== legacy)
    throw new Error(
      "Book migration verification failed. Your original data has been kept.",
    );
  // Do not remove a legacy value another tab changed while migration was running.
  try {
    if (localStorage.getItem(key) === legacy) localStorage.removeItem(key);
  } catch {
    /* verified copy is already safe */
  }
  return legacy;
}
export async function loadProject(): Promise<BookProject | null> {
  const raw = await loadRecord(PROJECT_KEY, (raw) =>
    assertProject(JSON.parse(raw)),
  );
  return raw === undefined ? null : JSON.parse(raw);
}
export function saveProject(project: BookProject): Promise<void> {
  assertProject(project);
  return writeRecord(PROJECT_KEY, JSON.stringify(project));
}
export async function removeRecord(key: string) {
  await writeRecord(key, undefined);
  try {
    localStorage.removeItem(key);
  } catch {
    /* no legacy copy */
  }
}
export async function clearAssets() {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("assets", "readwrite");
      t.objectStore("assets").clear();
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}
export async function normalizeImage(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Please choose JPG, PNG or WEBP images.");
  if (file.size > 30 * 1024 * 1024)
    throw new Error("Please choose an image smaller than 30 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("This photo could not be read.")),
      "image/jpeg",
      0.92,
    ),
  );
}
