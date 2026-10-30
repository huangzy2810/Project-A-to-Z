import { BookProject, uid } from "./model";
export interface PhotoMemoryPage {
  id: string;
  photoIds: string[];
}
// Legacy books grouped photos automatically; preserve that order on first edit.
export function memoryPages(project: BookProject): PhotoMemoryPage[] {
  const size = project.exportSettings.memoryLayout;
  const source =
    project.photoMemoryPages ??
    (project.photoMemories.length
      ? [
          {
            id: "legacy-memories",
            photoIds: project.photoMemories.map((p) => p.id),
          },
        ]
      : []);
  const used = new Set(source.map((page) => page.id));
  return source.flatMap((page) =>
    Array.from(
      { length: Math.max(1, Math.ceil(page.photoIds.length / size)) },
      (_, i) => {
        let id = page.id;
        if (i > 0) {
          id = `${page.id}-${i}`;
          while (used.has(id)) id += "-next";
          used.add(id);
        }
        return { id, photoIds: page.photoIds.slice(i * size, (i + 1) * size) };
      },
    ),
  );
}
export function setMemoryPagePhotos(
  project: BookProject,
  pageId: string,
  images: string[],
): BookProject {
  const pages = memoryPages(project);
  if (!pages.some((p) => p.id === pageId)) return project;
  const photos = images.map(
    (image) =>
      project.photoMemories.find((p) => p.image === image) || {
        id: uid(),
        image,
        caption: "",
        position: 50,
      },
  );
  const photoMemoryPages = pages.map((p) =>
    p.id === pageId ? { ...p, photoIds: photos.map((p) => p.id) } : p,
  );
  const retained = new Set(photoMemoryPages.flatMap((p) => p.photoIds));
  const photoMemories = [
    ...project.photoMemories.filter((p) => retained.has(p.id)),
    ...photos.filter(
      (p) => !project.photoMemories.some((old) => old.id === p.id),
    ),
  ];
  const updated = { ...project, photoMemories, photoMemoryPages };
  return { ...updated, photoMemoryPages: memoryPages(updated) };
}
export function deleteMemoryPage(
  project: BookProject,
  id: string,
): BookProject {
  const photoMemoryPages = memoryPages(project).filter((p) => p.id !== id);
  const retained = new Set(photoMemoryPages.flatMap((p) => p.photoIds));
  return {
    ...project,
    photoMemoryPages,
    photoMemories: project.photoMemories.filter((p) => retained.has(p.id)),
  };
}
