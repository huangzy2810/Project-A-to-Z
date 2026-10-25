import type { BookProject, Chapter, StoryPage } from "./model";
export type DeletedContent =
  | { kind: "page"; chapterId: string; index: number; page: StoryPage }
  | { kind: "chapter"; index: number; chapter: Chapter };
function numbered(pages: StoryPage[]) {
  return pages.map((page, index) => ({ ...page, pageNumber: index + 1 }));
}
export function deleteBookPage(
  project: BookProject,
  pageId: string,
): { project: BookProject; deleted: DeletedContent } {
  const chapter = project.chapters.find((c) =>
    c.pages.some((p) => p.id === pageId),
  );
  if (!chapter) throw new Error("This page no longer exists.");
  if (chapter.pages.length === 1)
    throw new Error(
      "Keep at least one page in each chapter. Delete the chapter instead, or add a blank page first.",
    );
  const index = chapter.pages.findIndex((p) => p.id === pageId);
  return {
    project: {
      ...project,
      chapters: project.chapters.map((c) =>
        c.id === chapter.id
          ? { ...c, pages: numbered(c.pages.filter((p) => p.id !== pageId)) }
          : c,
      ),
    },
    deleted: {
      kind: "page",
      chapterId: chapter.id,
      index,
      page: chapter.pages[index],
    },
  };
}
export function deleteBookChapter(
  project: BookProject,
  chapterId: string,
): { project: BookProject; deleted: DeletedContent } {
  const index = project.chapters.findIndex((c) => c.id === chapterId);
  if (index < 0) throw new Error("This chapter no longer exists.");
  if (project.chapters.length === 1)
    throw new Error(
      "Keep at least one chapter in the book. Add another chapter first.",
    );
  return {
    project: {
      ...project,
      chapters: project.chapters.filter((c) => c.id !== chapterId),
    },
    deleted: { kind: "chapter", index, chapter: project.chapters[index] },
  };
}
export function restoreDeletedContent(
  project: BookProject,
  deleted: DeletedContent,
): BookProject {
  if (deleted.kind === "chapter") {
    if (project.chapters.some((c) => c.id === deleted.chapter.id))
      return project;
    const chapters = [...project.chapters];
    chapters.splice(
      Math.min(deleted.index, chapters.length),
      0,
      deleted.chapter,
    );
    return { ...project, chapters };
  }
  const chapter = project.chapters.find((c) => c.id === deleted.chapterId);
  if (!chapter) throw new Error("The original chapter no longer exists.");
  if (chapter.pages.some((p) => p.id === deleted.page.id)) return project;
  const pages = [...chapter.pages];
  pages.splice(Math.min(deleted.index, pages.length), 0, deleted.page);
  return {
    ...project,
    chapters: project.chapters.map((c) =>
      c.id === chapter.id ? { ...c, pages: numbered(pages) } : c,
    ),
  };
}
