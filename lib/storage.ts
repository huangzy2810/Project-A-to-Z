import { assertProject, BookProject } from "./model";
export const PROJECT_KEY = "ava-book-project-v1";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("ava-book-assets", 1);
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
export function loadProject(): BookProject | null {
  const raw = localStorage.getItem(PROJECT_KEY);
  if (!raw) return null;
  const value = JSON.parse(raw);
  assertProject(value);
  return value;
}
export function saveProject(p: BookProject) {
  localStorage.setItem(PROJECT_KEY, JSON.stringify(p));
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
