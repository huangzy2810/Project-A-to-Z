export type Status = "draft" | "locked";
export type Position = "bottom" | "top" | "separate";
export interface Typography {
  headingFont: string;
  bodyFont: string;
  headingSize: number;
  bodySize: number;
  lineHeight: number;
  alignment: "left" | "center" | "right";
  textColor: string;
  defaultTextPosition: Position;
}
export interface Character {
  id: string;
  name: string;
  relationship: string;
  description: string;
  referencePhotos: string[];
  primaryReferencePhoto?: string;
  characterSheetImage?: string;
  generatedPrompt?: string;
  status: Status;
}
export interface VisualStyle {
  description: string;
  referenceImages: string[];
  generatedStylePrompt: string;
  previewImage?: string;
  status: Status;
}
export interface GenerationRecipe {
  characters: Character[];
  visualStyle: VisualStyle;
  scene: string;
  references: string[];
  composition: string;
  requiredElements?: string;
  exclusions: string;
  kind?: "character" | "style" | "scene";
}
export interface IllustrationVersion {
  recipe?: GenerationRecipe;
  id: string;
  image: string;
  prompt: string;
  characterReferences: string[];
  styleReference?: string;
  sceneReferences: string[];
  model: string;
  createdAt: string;
}
export interface StoryPage {
  id: string;
  chapterId: string;
  pageNumber: number;
  sceneDescription: string;
  storyText: string;
  characterIds: string[];
  referencePhotos: string[];
  compositionNotes: string;
  requiredElements: string;
  excludedElements: string;
  generatedPrompt?: string;
  illustrationVersions: IllustrationVersion[];
  selectedIllustrationId?: string;
  status: Status;
  lockedTypography?: Typography;
}
export interface Chapter {
  id: string;
  title: string;
  theme: string;
  description: string;
  referencePhotos: string[];
  pages: StoryPage[];
}
export interface BookProject {
  schemaVersion: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  settings: {
    title: string;
    subtitle: string;
    targetAge: string;
    tone: string;
    bookSize: "8 × 8 inches";
    illustrationDirection: string;
    defaultLayout: Position;
  };
  characters: Character[];
  visualStyle: VisualStyle;
  typography: Typography;
  chapters: Chapter[];
  closingMessage: {
    heading: string;
    message: string;
    signature: string;
    date: string;
    photo?: string;
  };
  photoMemories: {
    id: string;
    image: string;
    caption: string;
    position: number;
  }[];
  exportSettings: { safeMargin: number; memoryLayout: 1 | 2 | 4 };
}
export const uid = () => crypto.randomUUID();
export function newPage(chapterId: string, pageNumber: number): StoryPage {
  return {
    id: uid(),
    chapterId,
    pageNumber,
    sceneDescription: "",
    storyText: "",
    characterIds: [],
    referencePhotos: [],
    compositionNotes: "",
    requiredElements: "",
    excludedElements: "",
    illustrationVersions: [],
    status: "draft",
  };
}
export function createProject(): BookProject {
  const now = new Date().toISOString();
  const chapterId = uid();
  return {
    schemaVersion: 1,
    id: uid(),
    title: "Ava’s Shanghai Adventure",
    createdAt: now,
    updatedAt: now,
    settings: {
      title: "Ava’s Shanghai Adventure",
      subtitle: "A little adventure. A lifetime of memories.",
      targetAge: "3–7",
      tone: "Warm & wonder-filled",
      bookSize: "8 × 8 inches",
      illustrationDirection:
        "Ava discovers Shanghai with Mama and Papa, one little adventure at a time.",
      defaultLayout: "bottom",
    },
    characters: ["Ava", "Mama", "Papa"].map((name) => ({
      id: uid(),
      name,
      relationship: name === "Ava" ? "Our little explorer" : "Parent",
      description:
        name === "Ava"
          ? "A curious little girl with a big imagination and a love of discovering new places."
          : "A kind, loving companion on Ava’s adventure.",
      referencePhotos: [],
      status: "draft",
    })),
    visualStyle: {
      description:
        "Soft watercolor, warm pastels, delicate pencil lines, and a gentle storybook feeling.",
      referenceImages: [],
      generatedStylePrompt: "",
      status: "draft",
    },
    typography: {
      headingFont: "Georgia",
      bodyFont: "Georgia",
      headingSize: 30,
      bodySize: 20,
      lineHeight: 1.5,
      alignment: "center",
      textColor: "#493e35",
      defaultTextPosition: "bottom",
    },
    chapters: [
      {
        id: chapterId,
        title: "Hello, Shanghai",
        theme: "A new city, a new adventure",
        description: "",
        referencePhotos: [],
        pages: [
          {
            ...newPage(chapterId, 1),
            sceneDescription:
              "Ava, Mama and Papa stroll along the Bund at sunset, looking at the sparkling Shanghai skyline.",
            storyText:
              "Ava held Mama’s hand and looked across the river. A whole new world was waiting to say hello.",
          },
        ],
      },
    ],
    closingMessage: {
      heading: "For our darling Ava",
      message:
        "May you always be curious, brave, and full of wonder. Every adventure is more beautiful with you.",
      signature: "With all our love, Mama & Papa",
      date: "",
    },
    photoMemories: [],
    exportSettings: { safeMargin: 0.25, memoryLayout: 2 },
  };
}
export function updatePage(
  project: BookProject,
  id: string,
  patch: Partial<StoryPage>,
): BookProject {
  return {
    ...project,
    chapters: project.chapters.map((c) => ({
      ...c,
      pages: c.pages.map((p) =>
        p.id !== id
          ? p
          : p.status === "locked" && patch.status !== "draft"
            ? p
            : { ...p, ...patch },
      ),
    })),
  };
}
export function assertProject(value: unknown): asserts value is BookProject {
  const p = value as BookProject;
  if (
    !p ||
    p.schemaVersion !== 1 ||
    typeof p.id !== "string" ||
    typeof p.title !== "string" ||
    !p.settings ||
    !p.typography ||
    !p.visualStyle ||
    !p.closingMessage ||
    !p.exportSettings ||
    !Array.isArray(p.characters) ||
    !Array.isArray(p.chapters) ||
    !Array.isArray(p.photoMemories) ||
    p.characters.length === 0 ||
    p.chapters.length === 0 ||
    !Array.isArray(p.visualStyle.referenceImages) ||
    ![1, 2, 4].includes(p.exportSettings.memoryLayout) ||
    p.characters.some(
      (c) =>
        !c ||
        typeof c.name !== "string" ||
        typeof c.description !== "string" ||
        !Array.isArray(c.referencePhotos) ||
        !["draft", "locked"].includes(c.status),
    ) ||
    p.chapters.some(
      (c) =>
        !c ||
        !Array.isArray(c.pages) ||
        !c.pages.length ||
        !Array.isArray(c.referencePhotos) ||
        typeof c.title !== "string" ||
        c.pages.some(
          (s) =>
            !s ||
            typeof s.storyText !== "string" ||
            typeof s.sceneDescription !== "string" ||
            !Array.isArray(s.characterIds) ||
            !Array.isArray(s.referencePhotos) ||
            !Array.isArray(s.illustrationVersions) ||
            !["draft", "locked"].includes(s.status),
        ),
    )
  )
    throw new Error(
      "The saved book could not be read. Your saved data has been preserved. Reset only if you want to start a new book.",
    );
}
