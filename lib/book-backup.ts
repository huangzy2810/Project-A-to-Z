import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { assertProject, type BookProject, uid } from "./model";
import { getAsset, putAsset } from "./storage";
import { safeBookFilename } from "./export-filenames";

// Includes references stored in historical generation recipes and manifests.
export function bookAssetIds(project: BookProject): string[] {
  const ids = new Set<string>();
  const single = new Set([
    "image",
    "characterSheetImage",
    "primaryReferencePhoto",
    "previewImage",
    "sourceImage",
    "styleReference",
    "photo",
  ]);
  const multiple = new Set([
    "referencePhotos",
    "referenceImages",
    "references",
    "characterReferences",
    "sceneReferences",
    "photoIds",
  ]);
  function walk(value: unknown, key = "") {
    if (typeof value === "string" && (single.has(key) || multiple.has(key)))
      ids.add(value);
    else if (Array.isArray(value))
      value.forEach((item) => {
        if (key === "referenceManifest" && item && typeof item.id === "string")
          ids.add(item.id);
        walk(item, key);
      });
    else if (value && typeof value === "object")
      Object.entries(value).forEach(([k, v]) => walk(v, k));
  }
  walk(project);
  return [...ids].filter(Boolean);
}
export async function createBookBackup(project: BookProject): Promise<Blob> {
  assertProject(project);
  const assets: { id: string; type: string }[] = [];
  const files: Record<string, Uint8Array> = {};
  for (const id of bookAssetIds(project)) {
    const blob = await getAsset(id); // Never silently produce an incomplete backup.
    assets.push({ id, type: blob.type });
    files[`assets/${id}`] = new Uint8Array(await blob.arrayBuffer());
  }
  files["book.json"] = strToU8(
    JSON.stringify({ format: "ava-book-backup", version: 1, project, assets }),
  );
  const zipped = zipSync(files, { level: 0 });
  return new Blob([Uint8Array.from(zipped)], { type: "application/zip" });
}
export async function downloadBookBackup(project: BookProject) {
  const blob = await createBookBackup(project);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeBookFilename(project.title)} - Editable Book.zip`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function readBookBackup(file: File): Promise<BookProject> {
  if (file.size > 512 * 1024 * 1024)
    throw new Error("Choose a backup smaller than 512 MB.");
  // Bound decompressed data as well as upload size; no archive paths are written to disk.
  let total = 0;
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter(entry) {
      total += entry.originalSize;
      if (entry.originalSize > 64 * 1024 * 1024 || total > 512 * 1024 * 1024)
        throw new Error("This backup is too large to restore.");
      return entry.name === "book.json" || entry.name.startsWith("assets/");
    },
  });
  if (!files["book.json"])
    throw new Error("This ZIP is not an editable book backup.");
  const data = JSON.parse(strFromU8(files["book.json"]));
  if (
    data.format !== "ava-book-backup" ||
    data.version !== 1 ||
    !Array.isArray(data.assets)
  )
    throw new Error("Unsupported editable book backup.");
  assertProject(data.project);
  const manifest = new Map<string, string>();
  for (const asset of data.assets) {
    if (
      !asset ||
      typeof asset.id !== "string" ||
      !asset.id ||
      manifest.has(asset.id) ||
      !["image/png", "image/jpeg", "image/webp", "image/svg+xml"].includes(
        asset.type,
      )
    )
      throw new Error("The backup image list is invalid.");
    manifest.set(asset.id, asset.type);
  }
  const ids = bookAssetIds(data.project);
  // Validate every image before writing any restored data.
  for (const id of ids) {
    const bytes = files[`assets/${id}`];
    if (!manifest.has(id) || !bytes?.length)
      throw new Error(
        "An image is missing from this backup. Your current book is unchanged.",
      );
    if (manifest.get(id) !== "image/svg+xml") {
      const bitmap = await createImageBitmap(
        new Blob([Uint8Array.from(bytes)], { type: manifest.get(id) }),
      );
      bitmap.close();
    }
  }
  const replacement = new Map<string, string>();
  // New image IDs avoid overwriting images in the currently open book if import fails.
  for (const id of ids)
    replacement.set(
      id,
      await putAsset(
        new Blob([Uint8Array.from(files[`assets/${id}`])], {
          type: manifest.get(id),
        }),
      ),
    );
  function remap(value: unknown): unknown {
    if (typeof value === "string") return replacement.get(value) || value;
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, remap(entry)]),
      );
    return value;
  }
  const project = remap(data.project) as BookProject;
  project.id = uid(); // Restored books never replay an old book's queue.
  project.updatedAt = new Date().toISOString();
  assertProject(project);
  return project;
}
