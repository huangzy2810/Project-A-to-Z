import type { BookProject } from "./model";
export function deleteCharacter(project: BookProject, id: string): BookProject {
  return {
    ...project,
    characters: project.characters.filter((c) => c.id !== id),
    cover: project.cover
      ? {
          ...project.cover,
          characterIds: project.cover.characterIds?.filter((x) => x !== id),
        }
      : undefined,
    chapters: project.chapters.map((chapter) => ({
      ...chapter,
      pages: chapter.pages.map((page) => ({
        ...page,
        characterIds: page.characterIds.filter((x) => x !== id),
      })),
    })),
  };
}
