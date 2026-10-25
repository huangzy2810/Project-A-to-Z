"use client";
import ImageTweaker from "./ImageTweaker";
import { coverRecipe, emptyCover, selectedCoverVersion } from "@/lib/cover";
import type { CoverDesign } from "@/lib/model";
import {
  deleteBookPage,
  deleteBookChapter,
  restoreDeletedContent,
  type DeletedContent,
} from "@/lib/book-structure";
import { BulkRegeneration, GenerationQueuePanel } from "./GenerationQueuePanel";
import {
  GenerationQueue,
  makeChapterJob,
  pendingJob,
  queueStorageKey,
  restoreQueue,
  jobApprovalIssues,
  applyQueuedVersion,
  type GenerationJob,
} from "@/lib/generation-queue";
import { describeScenePhotos } from "@/lib/scene-description";
import type { ImageRegion } from "@/lib/regions";
import { useEffect, useRef, useState } from "react";
import {
  BookProject,
  Chapter,
  Character,
  createProject,
  newPage,
  StoryPage,
  uid,
  updatePage,
} from "@/lib/model";
import {
  clearAssets,
  loadProject,
  PROJECT_KEY,
  saveProject,
} from "@/lib/storage";
import {
  illustrationService,
  generationStatus,
  GenerationInput,
  GenerationStatus,
} from "@/lib/generation";
import { AssetImage, BookPage, orderedPages, RenderPage } from "./BookPage";
import DropZone from "./DropZone";
import { exportPdf } from "@/lib/pdf";
import { exportJpegs } from "@/lib/jpeg";
import {
  generationApprovalIssues,
  referenceAssets,
  retryIdentityIssues,
} from "@/lib/recipe";
const steps = [
  "Book Setup",
  "Visual Style",
  "Character Studio",
  "Typography & Layout",
  "Chapter Builder",
  "Closing Letter",
  "Re-create Cover",
  "Photo Memories",
  "Book Preview",
  "Export PDF & JPEG",
];
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export default function BookEditor() {
  const [project, setProject] = useState<BookProject | null>(null);
  const [ready, setReady] = useState(false);
  const [generationInfo, setGenerationInfo] = useState<GenerationStatus | null>(
    null,
  );
  const [generationSettingsError, setGenerationSettingsError] = useState(false);
  const [step, setStep] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [characterIndex, setCharacterIndex] = useState(0);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [deletedContent, setDeletedContent] = useState<DeletedContent | null>(
    null,
  );
  const [saveState, setSaveState] = useState("Saved on this device");
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const exportRoot = useRef<HTMLDivElement>(null);
  const generationRef = useRef(false);
  const queueRef = useRef<GenerationQueue | null>(null);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const queueActive = jobs.some(pendingJob);
  const latestProject = useRef<BookProject | null>(null);
  latestProject.current = project;
  useEffect(() => {
    const controller = new AbortController();
    generationStatus(controller.signal)
      .then(setGenerationInfo)
      .catch(() => {
        if (!controller.signal.aborted) setGenerationSettingsError(true);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    try {
      setProject(loadProject() || createProject());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Saved book could not be read.",
      );
      setStorageBlocked(true);
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!project?.id) return;
    const key = queueStorageKey(project.id);
    let live = true;
    try {
      const restored = restoreQueue(localStorage.getItem(key), project.id);
      const queue = new GenerationQueue(
        restored,
        async (job) => {
          const current = latestProject.current;
          if (!live || !current)
            throw new Error("This book is no longer open.");
          const issues = jobApprovalIssues(current, job);
          if (issues.length) throw new Error(issues.join(" "));
          if (generationRef.current)
            throw new Error(
              "Another generation is active. Retry this queued page after it finishes.",
            );
          generationRef.current = true;
          try {
            const service = await illustrationService(
              job.mode,
              setGenerationInfo,
            );
            const version = await service.generate(job.recipe);
            if (!live || !latestProject.current)
              throw new Error("This book is no longer open.");
            const next = applyQueuedVersion(
              latestProject.current,
              job,
              version,
            );
            saveProject(next);
            latestProject.current = next;
            setProject(next);
          } catch (e) {
            setError(
              `${job.label}: ${e instanceof Error ? e.message : "Generation failed."}`,
            );
            throw e;
          } finally {
            generationRef.current = false;
          }
        },
        (next) => {
          localStorage.setItem(key, JSON.stringify(next));
          if (live) setJobs(structuredClone(next));
        },
        () => {
          if (queueRef.current) setJobs(structuredClone(queueRef.current.jobs));
          setError(
            "The generation queue could not be saved. Processing stopped; check browser storage before retrying.",
          );
        },
      );
      queueRef.current = queue;
      localStorage.setItem(key, JSON.stringify(restored));
      setJobs(restored);
      return () => {
        live = false;
        queue.dispose();
        if (queueRef.current === queue) queueRef.current = null;
      };
    } catch (e) {
      queueRef.current?.dispose();
      queueRef.current = null;
      setJobs([]);
      setError(
        e instanceof Error ? e.message : "Could not open the generation queue.",
      );
    }
  }, [project?.id]);
  useEffect(() => {
    if (!queueActive) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [queueActive]);
  useEffect(() => {
    if (!project || !ready || storageBlocked) return;
    setSaveState("Saving…");
    const timer = setTimeout(() => {
      try {
        saveProject(project);
        setSaveState("Saved on this device");
      } catch {
        setSaveState("Not saved");
        setError(
          "Your browser could not save this book. Storage may be full or disabled. Keep this tab open until storage is available.",
        );
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [project, ready, storageBlocked]);
  useEffect(() => {
    const flush = () => {
      if (latestProject.current && !storageBlocked) {
        try {
          saveProject(latestProject.current);
        } catch {
          /* The autosave banner reports storage failures. */
        }
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [storageBlocked]);
  useEffect(() => {
    if (!drawer && !settings) return;
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawer(false);
        setSettings(false);
      }
      if (event.key === "Tab") {
        const dialog = document.querySelector('[role="dialog"]');
        const items = dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input, select, textarea, a[href]",
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  }, [drawer, settings]);
  function change(fn: (p: BookProject) => BookProject) {
    const current = latestProject.current;
    if (current) {
      const next = { ...fn(current), updatedAt: new Date().toISOString() };
      latestProject.current = next;
      setProject(next);
    }
  }
  function go(n: number) {
    if (busy) return;
    setStep(n);
    setError("");
    setDrawer(false);
  }
  async function reset() {
    if (
      !confirm(
        "Reset this book? All locally saved stories, photos and illustrations will be deleted.",
      )
    )
      return;
    try {
      await clearAssets();
      localStorage.removeItem(PROJECT_KEY);
      if (project) localStorage.removeItem(queueStorageKey(project.id));
      setProject(createProject());
      setDeletedContent(null);
      setStorageBlocked(false);
      setStep(0);
      setCharacterIndex(0);
      setChapterIndex(0);
      setPageIndex(0);
      setSettings(false);
      setError("");
    } catch {
      setError("Could not reset local storage. Your book has been kept.");
    }
  }
  if (!ready) return <main className="loading">Opening your storybook…</main>;
  if (!project)
    return (
      <main className="loading">
        <h1>Your saved book needs attention</h1>
        <p role="alert">{error}</p>
        <p>The saved data has been preserved.</p>
        <button onClick={reset}>Reset Project</button>
      </main>
    );
  const p = project;
  const sampleMode =
    p.generationMode === "mock" || generationInfo?.available === false;
  const generationLabel =
    p.generationMode === "mock"
      ? "Sample artwork"
      : generationSettingsError
        ? "Illustration settings unavailable"
        : !generationInfo
          ? "Checking illustration settings…"
          : generationInfo.available
            ? "AI illustrations"
            : "Sample artwork · AI not configured";
  const character = p.characters[characterIndex] || p.characters[0];
  const chapter = p.chapters[chapterIndex] || p.chapters[0];
  const page = chapter?.pages[pageIndex] || chapter?.pages[0];
  const pageQueued = jobs.some(
    (job) => job.pageId === page?.id && pendingJob(job),
  );
  const operationBusy = !!busy || queueActive;
  const allPages = orderedPages(p);
  const cover = p.cover || emptyCover();
  const selectedCover = selectedCoverVersion(p);
  const preview = allPages[Math.min(previewIndex, allPages.length - 1)];
  function patchCharacter(patch: Partial<Character>) {
    change((p) => ({
      ...p,
      characters: p.characters.map((c) =>
        c.id !== character.id
          ? c
          : c.status === "locked" && patch.status !== "draft"
            ? c
            : { ...c, ...patch },
      ),
    }));
  }
  function patchChapter(patch: Partial<Chapter>) {
    change((p) => ({
      ...p,
      chapters: p.chapters.map((c) =>
        c.id === chapter.id ? { ...c, ...patch } : c,
      ),
    }));
  }
  function patchPage(patch: Partial<StoryPage>) {
    change((p) => updatePage(p, page.id, patch));
  }
  function deleteContent(kind: "page" | "chapter") {
    const ids = kind === "page" ? [page.id] : chapter.pages.map((p) => p.id);
    const label =
      kind === "page"
        ? `Page ${page.pageNumber}`
        : `chapter “${chapter.title}” and all ${chapter.pages.length} pages`;
    if (
      busy ||
      jobs.some((job) => job.status === "running" && ids.includes(job.pageId))
    )
      return;
    if (
      !confirm(
        `Delete ${label}? This removes its text and all saved illustration versions from the book${(kind === "chapter" && chapter.pages.some((p) => p.status === "locked")) || (kind === "page" && page.status === "locked") ? ", including locked content" : ""}. Waiting generation jobs for these pages will be removed. You can undo this deletion until your next deletion or reload.`,
      )
    )
      return;
    try {
      const current = latestProject.current!;
      const result =
        kind === "page"
          ? deleteBookPage(current, page.id)
          : deleteBookChapter(current, chapter.id);
      if (!queueRef.current)
        throw new Error(
          "The generation queue is unavailable. Reload before deleting pages.",
        );
      queueRef.current.reconcilePages(result.project);
      change(() => result.project);
      setDeletedContent(result.deleted);
      setChapterIndex(
        kind === "chapter"
          ? Math.min(chapterIndex, result.project.chapters.length - 1)
          : result.project.chapters.findIndex((c) => c.id === chapter.id),
      );
      setPageIndex(
        kind === "chapter"
          ? 0
          : Math.min(
              pageIndex,
              result.project.chapters.find((c) => c.id === chapter.id)!.pages
                .length - 1,
            ),
      );
      setPreviewIndex(0);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not delete this content.",
      );
    }
  }
  function undoDeletion() {
    if (!deletedContent || busy) return;
    try {
      const next = restoreDeletedContent(
        latestProject.current!,
        deletedContent,
      );
      queueRef.current?.reconcilePages(next);
      change(() => next);
      const chapterId =
        deletedContent.kind === "chapter"
          ? deletedContent.chapter.id
          : deletedContent.chapterId;
      const restoredChapterIndex = next.chapters.findIndex(
        (c) => c.id === chapterId,
      );
      setChapterIndex(restoredChapterIndex);
      setPageIndex(
        deletedContent.kind === "chapter"
          ? 0
          : next.chapters[restoredChapterIndex].pages.findIndex(
              (p) => p.id === deletedContent.page.id,
            ),
      );
      setPreviewIndex(0);
      setDeletedContent(null);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not restore deleted content.",
      );
    }
  }
  async function draftScene(photoIds: string[]) {
    if (generationRef.current || queueActive || page.status === "locked")
      return;
    generationRef.current = true;
    setBusy("photo-draft");
    setError("");
    const targetId = page.id;
    try {
      const description = await describeScenePhotos(
        [...new Set(photoIds)],
        p.characters
          .filter((c) => page.characterIds.includes(c.id))
          .map((c) => c.name),
      );
      change((current) => {
        const target = current.chapters
          .flatMap((c) => c.pages)
          .find((s) => s.id === targetId);
        if (!target || target.status === "locked") return current;
        return updatePage(
          current,
          targetId,
          target.sceneDescription.trim()
            ? { scenePhotoDraft: { description, photoIds } }
            : { sceneDescription: description, scenePhotoDraft: undefined },
        );
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Photo analysis failed. Your scene text is safe.",
      );
    } finally {
      setBusy("");
      generationRef.current = false;
    }
  }
  function queueJobs(next: GenerationJob[]) {
    try {
      if (busy) throw new Error("Wait for the current operation to finish.");
      if (!queueRef.current)
        throw new Error(
          "The generation queue is unavailable. Check browser storage.",
        );
      queueRef.current.enqueue(next);
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not queue illustrations.",
      );
    }
  }
  function queueAction(action: () => void) {
    try {
      action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the queue.");
    }
  }
  async function generate(
    kind: "character" | "style" | "scene",
    retry = false,
  ) {
    if (kind === "scene") {
      try {
        queueJobs([makeChapterJob(p, page, false, retry)]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not queue this page.");
      }
      return;
    }
    if (generationRef.current || queueActive) return;
    if (
      (kind === "character" && character.status === "locked") ||
      (kind === "style" && p.visualStyle.status === "locked")
    )
      return;
    generationRef.current = true;
    setBusy(kind);
    setError("");
    try {
      const service = await illustrationService(
        p.generationMode || "auto",
        setGenerationInfo,
      );
      const input: GenerationInput = {
        characters:
          kind === "character" ? [{ ...character, status: "locked" }] : [],
        visualStyle: p.visualStyle,
        scene:
          kind === "character"
            ? `${character.name}: ${character.description}. A four-view face-only identity sheet: front, three-quarter, profile, and smiling. No clothing, body, accessories or scenery.`
            : "An empty Shanghai waterfront landscape with a river, skyline and gentle trees. Background only; no people, characters, faces or animals.",
        references:
          kind === "character"
            ? character.referencePhotos
            : p.visualStyle.referenceImages,
        composition: "Gentle storybook composition",
        requiredElements: "",
        exclusions: "",
        kind,
      };
      const issues = generationApprovalIssues(input);
      if (issues.length) throw new Error(issues.join(" "));
      const v = await service.generate(input);
      if (kind === "character")
        patchCharacter({
          characterSheetImage: v.image,
          generationModel: v.model,
          generatedPrompt: v.prompt,
          styleReference: v.styleReference,
          faceOnly: true,
          faceViews: "multi-angle",
        });
      if (kind === "style")
        change((p) => ({
          ...p,
          visualStyle: {
            ...p.visualStyle,
            previewImage: v.image,
            backgroundOnly: true,
            generationModel: v.model,
            generatedStylePrompt: v.prompt,
          },
        }));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Generation failed. Your previous images are safe.",
      );
    } finally {
      setBusy("");
      generationRef.current = false;
    }
  }
  async function tweakImage(
    feedback: string,
    region: ImageRegion,
  ): Promise<boolean> {
    if (
      generationRef.current ||
      queueActive ||
      page.status === "locked" ||
      !selected
    )
      return false;
    generationRef.current = true;
    setBusy("tweak");
    setError("");
    try {
      if (!selected.recipe)
        throw new Error(
          "This older illustration has no saved recipe. Use Edit & Regenerate before applying a partial edit.",
        );
      const characters = page.characterIds.map((id) => {
        const current = p.characters.find((c) => c.id === id);
        if (!current)
          throw new Error(
            "A selected character is missing from Character Studio. Restore the character before repairing this image.",
          );
        return current;
      });
      const input: GenerationInput = {
        ...selected.recipe,
        characters,
        tweak: {
          sourceImage: selected.image,
          sourceVersionId: selected.id,
          feedback,
          region,
        },
      };
      const issues = generationApprovalIssues(input);
      if (issues.length) throw new Error(issues.join(" "));
      const service = await illustrationService(
        p.generationMode || "auto",
        setGenerationInfo,
      );
      const version = await service.generate(input);
      patchPage({
        illustrationVersions: [...page.illustrationVersions, version],
        selectedIllustrationId: version.id,
        generatedPrompt: version.prompt,
      });
      return true;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The edit failed. Your original illustration is safe.",
      );
      return false;
    } finally {
      setBusy("");
      generationRef.current = false;
    }
  }
  function patchCover(patch: Partial<CoverDesign>) {
    change((current) => ({
      ...current,
      cover: { ...(current.cover || emptyCover()), ...patch },
    }));
  }
  async function generateCover() {
    if (generationRef.current || queueActive) return;
    generationRef.current = true;
    setBusy("cover");
    setError("");
    try {
      const input = coverRecipe(p);
      const service = await illustrationService(
        p.generationMode || "auto",
        setGenerationInfo,
      );
      const version = await service.generate(input);
      change((current) => ({
        ...current,
        cover: {
          ...(current.cover || emptyCover()),
          illustrationVersions: [
            ...(current.cover?.illustrationVersions || []),
            version,
          ],
          selectedIllustrationId: version.id,
        },
      }));
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Cover generation failed. Your previous cover is safe.",
      );
    } finally {
      generationRef.current = false;
      setBusy("");
    }
  }
  async function download(format: "pdf" | "jpeg") {
    setBusy(format);
    setError("");
    setExportProgress(0);
    try {
      await new Promise((r) => setTimeout(r, 200));
      await (format === "jpeg" ? exportJpegs : exportPdf)(
        Array.from(exportRoot.current!.children) as HTMLElement[],
        p.title,
        setExportProgress,
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Book export failed. Please try again.",
      );
    } finally {
      setBusy("");
    }
  }
  const selected = page?.illustrationVersions.find(
    (v) => v.id === page.selectedIllustrationId,
  );
  const isLocked =
    step === 2
      ? character.status === "locked"
      : step === 1
        ? p.visualStyle.status === "locked"
        : step === 4
          ? page.status === "locked"
          : false;
  let right: React.ReactNode = <BookPage project={p} page={allPages[0]} />;
  if (step === 2)
    right = (
      <div className="studio-preview">
        {character.characterSheetImage ? (
          <AssetImage
            id={character.characterSheetImage}
            alt={`${character.name} character sheet`}
          />
        ) : (
          <div className="empty-preview">
            <div className="portrait">☺</div>
            <h3>Meet {character.name}</h3>
            <p>
              A few familiar faces.
              <br />
              One wonderful little character.
            </p>
            <small>Your face-only reference will appear here.</small>
          </div>
        )}
      </div>
    );
  if (step === 1)
    right = (
      <div className="studio-preview">
        {p.visualStyle.previewImage ? (
          <AssetImage id={p.visualStyle.previewImage} alt="Style sample" />
        ) : (
          <div className="empty-preview">
            <div className="swatches">
              <i />
              <i />
              <i />
              <i />
            </div>
            <h3>A world of your own</h3>
            <p>
              Find the colors and textures
              <br />
              that feel like your story.
            </p>
          </div>
        )}
      </div>
    );
  if (step === 3 || step === 4)
    right = (
      <BookPage
        project={p}
        editing
        page={{
          id: page.id,
          kind: "story",
          text: page.storyText,
          image: selected?.image,
          typography: step === 4 ? page.lockedTypography : undefined,
          editStep: 4,
        }}
      />
    );
  if (step === 6) right = <BookPage project={p} page={allPages[0]} />;
  if (step === 5)
    right = (
      <BookPage project={p} page={allPages.find((x) => x.kind === "letter")!} />
    );
  if (step === 7)
    right = p.photoMemories.length ? (
      <BookPage
        project={p}
        page={allPages.find((x) => x.kind === "memories")!}
      />
    ) : (
      <div className="empty-preview">
        <span className="empty-icon">▧</span>
        <h3>The moments in between</h3>
        <p>
          Your real photographs belong here.
          <br />
          The smiles, the snacks, the little discoveries.
        </p>
      </div>
    );
  if (step >= 8) right = <BookPage project={p} page={preview} />;
  return (
    <div className="app-shell">
      <header>
        <button
          className="drawer-button"
          onClick={() => setDrawer(true)}
          aria-label="Open Book Drawer"
        >
          ☰ <span>Book Drawer</span>
        </button>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go(0);
          }}
        >
          little chapters<span>BOOKS MADE OF MEMORIES</span>
        </a>
        <button
          className="save-status"
          onClick={() => setSettings(true)}
          aria-label="Open project settings"
        >
          <i className={saveState === "Not saved" ? "unsaved" : ""} />
          {saveState}
          <span> ⚙︎</span>
        </button>
      </header>
      <div className="intro">
        <span className="eyebrow">
          AVA’S SHANGHAI ADVENTURE BOOK CREATOR · MVP v3
        </span>
        <h1>
          {
            [
              "Every adventure deserves a book.",
              "Give your story a little magic.",
              "The people who make it special.",
              "Make room for every word.",
              "One little adventure at a time.",
              "A few words from the heart.",
              "A fresh beginning for your book.",
              "Keep the real moments, too.",
              "Your story, from beginning to end.",
              "A keepsake, ready to take home.",
            ][step]
          }
        </h1>
        <p>
          {
            [
              "Start with a name, a feeling, and a little imagination.",
              "Choose a gentle visual world for your family’s adventure.",
              "Turn familiar faces into the heroes of your story, in your chosen style.",
              "Let your words and pictures find their perfect balance.",
              "Tell the story on the left. Watch it come to life on the right.",
              "A letter she can return to, again and again.",
              "Re-create the cover with your photos and imagination.",
              "The photographs that bring you right back.",
              "Turn through the pages you’ve made together.",
              "A square 8 × 8 inch book, made with love.",
            ][step]
          }
        </p>
      </div>
      <nav className="progress" aria-label="Book creation steps">
        {steps.map((name, i) => (
          <button
            key={name}
            onClick={() => go(i)}
            disabled={!!busy}
            aria-current={step === i ? "step" : undefined}
            className={step === i ? "active" : i < step ? "visited" : ""}
          >
            <span>{i < step ? "✓" : String(i + 1).padStart(2, "0")}</span>
            <small>
              {name
                .replace(" Studio", "")
                .replace(" & Layout", "")
                .replace(" Builder", "")}
            </small>
          </button>
        ))}
      </nav>
      {error && (
        <div className="error global-error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      <GenerationQueuePanel
        jobs={jobs}
        disabled={!!busy}
        onStop={() => queueAction(() => queueRef.current?.stop())}
        onResume={() => queueAction(() => queueRef.current?.resume())}
        onRetry={(id) => queueAction(() => queueRef.current?.retry(id))}
      />
      <main className="spread">
        <section className="input-page">
          <div className="page-heading">
            <span className="eyebrow">
              CHAPTER {String(step + 1).padStart(2, "0")} / YOUR BOOK
            </span>
            <span className="small-status">
              {isLocked ? "✓ Locked" : "In the making"}
            </span>
          </div>
          <h2>{steps[step]}</h2>
          {[1, 2, 4].includes(step) && (
            <div className="generation-notice" role="status">
              <strong>{generationLabel}</strong>
              <p>
                {sampleMode
                  ? "Sample illustrations are drawn locally. Enable AI in project settings when your server credential is configured."
                  : generationInfo?.available
                    ? "Generating sends this illustration’s references to OpenAI. It may take up to three minutes and uses your API credits."
                    : "Your existing images and book stay safely saved."}
              </p>
              {busy && busy !== "pdf" && busy !== "jpeg" && (
                <span>
                  Creating a new illustration… Your previous versions are safe.
                </span>
              )}
            </div>
          )}
          {step === 0 && (
            <>
              <p className="section-description">
                A wonderful story starts with a little intention.
              </p>
              <Field label="What shall we call your book?">
                <input
                  value={p.title}
                  onChange={(e) =>
                    change((p) => ({
                      ...p,
                      title: e.target.value,
                      settings: { ...p.settings, title: e.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="A little subtitle (optional)">
                <input
                  value={p.settings.subtitle}
                  onChange={(e) =>
                    change((p) => ({
                      ...p,
                      settings: { ...p.settings, subtitle: e.target.value },
                    }))
                  }
                />
              </Field>
              <Field label="How should the story feel?">
                <select
                  value={p.settings.tone}
                  onChange={(e) =>
                    change((p) => ({
                      ...p,
                      settings: { ...p.settings, tone: e.target.value },
                    }))
                  }
                >
                  {[
                    "Warm & wonder-filled",
                    "Playful & adventurous",
                    "Gentle & dreamy",
                    "Brave & curious",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Tell us a little about the adventure">
                <textarea
                  rows={4}
                  value={p.settings.illustrationDirection}
                  onChange={(e) =>
                    change((p) => ({
                      ...p,
                      settings: {
                        ...p.settings,
                        illustrationDirection: e.target.value,
                      },
                    }))
                  }
                />
              </Field>
              <div className="format-card">
                <span>▤</span>
                <div>
                  <strong>A little book. A big adventure.</strong>
                  <p>8 × 8 inch square · Made for little hands</p>
                </div>
              </div>
              <button className="primary wide" onClick={() => go(1)}>
                Begin our story <span>→</span>
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <p className="help">
                Generate four face-only views—front, three-quarter, profile and
                smiling—using your locked style and photos. Clothing, bodies,
                accessories and scenery are excluded.
              </p>
              {character.characterSheetImage &&
                character.faceOnly &&
                character.faceViews !== "multi-angle" && (
                  <p className="help">
                    This older reference contains one face view. Unlock and
                    regenerate it to make a multi-angle face sheet.
                  </p>
                )}
              {character.characterSheetImage && !character.faceOnly && (
                <p className="help">
                  This older reference may contain clothing or a body. Unlock
                  and regenerate it as a multi-angle face-only sheet.
                </p>
              )}
              {character.characterSheetImage &&
                character.styleReference !== p.visualStyle.previewImage && (
                  <p className="help">
                    This sheet uses an earlier style or was made without a style
                    reference. Unlock and regenerate it to apply the current
                    style.
                  </p>
                )}
              <div className="tabs">
                {p.characters.map((c, i) => (
                  <button
                    disabled={operationBusy}
                    key={c.id}
                    className={characterIndex === i ? "selected" : ""}
                    onClick={() => setCharacterIndex(i)}
                  >
                    {c.name}
                    {c.status === "locked" ? " ✓" : ""}
                  </button>
                ))}
                <button
                  disabled={operationBusy}
                  onClick={() => {
                    const name = prompt("What is their name?");
                    if (name?.trim()) {
                      change((p) => ({
                        ...p,
                        characters: [
                          ...p.characters,
                          {
                            id: uid(),
                            name: name.trim(),
                            description: "",
                            relationship: "",
                            referencePhotos: [],
                            status: "draft",
                          },
                        ],
                      }));
                      setCharacterIndex(p.characters.length);
                    }
                  }}
                >
                  + Add
                </button>
              </div>
              <fieldset disabled={isLocked || operationBusy}>
                <Field label="Character name">
                  <input
                    value={character.name}
                    onChange={(e) => patchCharacter({ name: e.target.value })}
                  />
                </Field>
                <Field label="Their place in the family">
                  <input
                    value={character.relationship}
                    onChange={(e) =>
                      patchCharacter({ relationship: e.target.value })
                    }
                  />
                </Field>
                <Field label="What makes them, them?">
                  <textarea
                    value={character.description}
                    onChange={(e) =>
                      patchCharacter({ description: e.target.value })
                    }
                    rows={3}
                  />
                </Field>
                <p className="help">
                  For best results, add 3–6 clear photos showing their face from
                  different angles.
                </p>
                <DropZone
                  images={character.referencePhotos}
                  primary={character.primaryReferencePhoto}
                  disabled={isLocked || operationBusy}
                  onPrimary={(id) =>
                    patchCharacter({ primaryReferencePhoto: id })
                  }
                  onChange={(ids) =>
                    patchCharacter({
                      referencePhotos: ids,
                      primaryReferencePhoto: ids.includes(
                        character.primaryReferencePhoto || "",
                      )
                        ? character.primaryReferencePhoto
                        : ids[0],
                    })
                  }
                />
              </fieldset>
              <div className="actions">
                <button
                  className="primary"
                  disabled={isLocked || operationBusy || !character.name.trim()}
                  onClick={() => generate("character")}
                >
                  {busy === "character"
                    ? "Drawing…"
                    : character.characterSheetImage
                      ? "Try Again"
                      : "Generate Character"}
                </button>
                <button
                  disabled={
                    operationBusy ||
                    (!character.characterSheetImage && !isLocked)
                  }
                  onClick={() =>
                    patchCharacter({ status: isLocked ? "draft" : "locked" })
                  }
                >
                  {isLocked ? "Unlock Character" : "Lock Character"}
                </button>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <p className="section-description">
                Choose the colors, textures and backgrounds of your story. This
                sample contains no characters.
              </p>
              {p.visualStyle.previewImage && !p.visualStyle.backgroundOnly && (
                <p className="help">
                  This older sample may include characters. Unlock and
                  regenerate it for a background-only reference.
                </p>
              )}
              <fieldset disabled={isLocked || operationBusy}>
                <Field label="What should your story look like?">
                  <textarea
                    rows={5}
                    value={p.visualStyle.description}
                    onChange={(e) =>
                      change((p) => ({
                        ...p,
                        visualStyle: {
                          ...p.visualStyle,
                          description: e.target.value,
                        },
                      }))
                    }
                  />
                </Field>
                <p className="help">
                  Have a look you love? Add a few reference pictures.
                </p>
                <DropZone
                  disabled={isLocked || operationBusy}
                  images={p.visualStyle.referenceImages}
                  onChange={(ids) =>
                    change((p) => ({
                      ...p,
                      visualStyle: { ...p.visualStyle, referenceImages: ids },
                    }))
                  }
                />
              </fieldset>
              <div className="actions">
                <button
                  className="primary"
                  disabled={isLocked || operationBusy}
                  onClick={() => generate("style")}
                >
                  {busy === "style"
                    ? "Painting…"
                    : p.visualStyle.previewImage
                      ? "Try Again"
                      : "Generate Style"}
                </button>
                <button
                  disabled={
                    operationBusy || (!p.visualStyle.previewImage && !isLocked)
                  }
                  onClick={() =>
                    change((p) => ({
                      ...p,
                      visualStyle: {
                        ...p.visualStyle,
                        status: isLocked ? "draft" : "locked",
                      },
                    }))
                  }
                >
                  {isLocked ? "Unlock Style" : "Lock Style"}
                </button>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <p className="section-description">
                Words stay separate from pictures, so your story is always
                editable.
              </p>
              {(["headingFont", "bodyFont"] as const).map((key) => (
                <Field
                  key={key}
                  label={key === "headingFont" ? "Heading font" : "Story font"}
                >
                  <select
                    value={p.typography[key]}
                    onChange={(e) =>
                      change((p) => ({
                        ...p,
                        typography: { ...p.typography, [key]: e.target.value },
                      }))
                    }
                  >
                    {[
                      "Georgia",
                      "Palatino",
                      "Arial",
                      "Verdana",
                      "Courier New",
                    ].map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </Field>
              ))}
              <div className="field-row">
                <Field label="Heading size">
                  <input
                    type="number"
                    min={18}
                    max={48}
                    value={p.typography.headingSize}
                    onChange={(e) =>
                      change((p) => ({
                        ...p,
                        typography: {
                          ...p.typography,
                          headingSize: Math.min(
                            48,
                            Math.max(18, +e.target.value),
                          ),
                        },
                      }))
                    }
                  />
                </Field>
                <Field label="Story size">
                  <input
                    type="number"
                    min={12}
                    max={32}
                    value={p.typography.bodySize}
                    onChange={(e) =>
                      change((p) => ({
                        ...p,
                        typography: {
                          ...p.typography,
                          bodySize: Math.min(32, Math.max(12, +e.target.value)),
                        },
                      }))
                    }
                  />
                </Field>
              </div>
              <Field label="Text alignment">
                <select
                  value={p.typography.alignment}
                  onChange={(e) =>
                    change((p) => ({
                      ...p,
                      typography: {
                        ...p.typography,
                        alignment: e.target.value as
                          "left" | "center" | "right",
                      },
                    }))
                  }
                >
                  {["left", "center", "right"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </Field>
              <Field label="Where should the words go?">
                <select
                  value={p.typography.defaultTextPosition}
                  onChange={(e) =>
                    change((p) => ({
                      ...p,
                      typography: {
                        ...p.typography,
                        defaultTextPosition: e.target.value as
                          "top" | "bottom" | "separate",
                      },
                    }))
                  }
                >
                  <option value="bottom">At the bottom of the picture</option>
                  <option value="top">At the top of the picture</option>
                  <option value="separate">In a separate space below</option>
                </select>
              </Field>
              <Field label={`Line spacing · ${p.typography.lineHeight}`}>
                <input
                  type="range"
                  min={1}
                  max={2}
                  step={0.1}
                  value={p.typography.lineHeight}
                  onChange={(e) =>
                    change((p) => ({
                      ...p,
                      typography: {
                        ...p.typography,
                        lineHeight: +e.target.value,
                      },
                    }))
                  }
                />
              </Field>
              <Field label="Text color">
                <input
                  type="color"
                  value={p.typography.textColor}
                  onChange={(e) =>
                    change((p) => ({
                      ...p,
                      typography: {
                        ...p.typography,
                        textColor: e.target.value,
                      },
                    }))
                  }
                />
              </Field>
              <p className="help">
                Locked pages keep the typography they were approved with. New
                choices apply to future pages.
              </p>
            </>
          )}
          {step === 4 && (
            <>
              <BulkRegeneration
                project={p}
                jobs={jobs}
                disabled={!!busy}
                onQueue={queueJobs}
              />
              <div className="field-row">
                <Field label="Chapter">
                  <select
                    aria-label="Chapter"
                    value={chapterIndex}
                    disabled={!!busy}
                    onChange={(e) => {
                      setChapterIndex(+e.target.value);
                      setPageIndex(0);
                    }}
                  >
                    {p.chapters.map((c, i) => (
                      <option key={c.id} value={i}>
                        {i + 1}. {c.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  disabled={!!busy}
                  onClick={() => {
                    const id = uid();
                    change((p) => ({
                      ...p,
                      chapters: [
                        ...p.chapters,
                        {
                          id,
                          title: `Chapter ${p.chapters.length + 1}`,
                          theme: "",
                          description: "",
                          referencePhotos: [],
                          pages: [newPage(id, 1)],
                        },
                      ],
                    }));
                    setChapterIndex(p.chapters.length);
                    setPageIndex(0);
                  }}
                >
                  + Chapter
                </button>
                <button
                  className="danger"
                  disabled={
                    !!busy ||
                    p.chapters.length <= 1 ||
                    jobs.some(
                      (job) =>
                        job.status === "running" &&
                        chapter.pages.some((p) => p.id === job.pageId),
                    )
                  }
                  onClick={() => deleteContent("chapter")}
                >
                  Delete chapter
                </button>
              </div>
              <details className="chapter-details">
                <summary>Chapter details & reference photos</summary>
                <Field label="Chapter title">
                  <input
                    value={chapter.title}
                    onChange={(e) => patchChapter({ title: e.target.value })}
                  />
                </Field>
                <Field label="Theme / context">
                  <textarea
                    value={chapter.theme}
                    onChange={(e) => patchChapter({ theme: e.target.value })}
                  />
                </Field>
                <p className="help">
                  Upload photos to draft a scene for the current page. Photos
                  are analyzed for details, but are never attached to
                  illustration requests. Keep up to four scene photos per draft.
                </p>
                <DropZone
                  disabled={isLocked || operationBusy || pageQueued}
                  images={chapter.referencePhotos}
                  onChange={(ids) => patchChapter({ referencePhotos: ids })}
                  onUploaded={(ids) =>
                    draftScene([...ids, ...page.referencePhotos])
                  }
                />
              </details>
              <div className="tabs">
                {chapter.pages.map((s, i) => (
                  <button
                    disabled={!!busy}
                    key={s.id}
                    className={pageIndex === i ? "selected" : ""}
                    onClick={() => setPageIndex(i)}
                  >
                    Page {i + 1}
                    {s.status === "locked" ? " ✓" : ""}
                  </button>
                ))}
                <button
                  disabled={!!busy}
                  onClick={() => {
                    patchChapter({
                      pages: [
                        ...chapter.pages,
                        newPage(chapter.id, chapter.pages.length + 1),
                      ],
                    });
                    setPageIndex(chapter.pages.length);
                  }}
                >
                  + Page
                </button>
                <button
                  className="danger"
                  disabled={
                    !!busy ||
                    chapter.pages.length <= 1 ||
                    jobs.some(
                      (job) =>
                        job.status === "running" && job.pageId === page.id,
                    )
                  }
                  onClick={() => deleteContent("page")}
                >
                  Delete page
                </button>
              </div>
              <p className="help">
                Keep at least one chapter and one page per chapter. Wait for a
                page’s active illustration to finish before deleting it or its
                chapter. Locked content can be deleted after confirmation.
              </p>
              {deletedContent && (
                <div className="reference-summary" role="status">
                  Deleted {deletedContent.kind === "page" ? "page" : "chapter"}.{" "}
                  <button disabled={!!busy} onClick={undoDeletion}>
                    Undo deletion
                  </button>
                  <small>
                    {" "}
                    Available until your next deletion or reload. Removed
                    generation jobs are not restarted.
                  </small>
                </div>
              )}
              <fieldset disabled={isLocked || !!busy || pageQueued}>
                <Field label="What happens on this page?">
                  <textarea
                    rows={3}
                    value={page.sceneDescription}
                    onChange={(e) =>
                      patchPage({ sceneDescription: e.target.value })
                    }
                  />
                </Field>
                {page.scenePhotoDraft && (
                  <div
                    className="reference-summary"
                    aria-label="Scene photo draft"
                  >
                    <strong>Scene draft from your photos</strong>
                    <p>
                      Your current scene text is unchanged. Review this draft,
                      then use it and refine the scene above. Replace positional
                      labels with character names where needed.
                    </p>
                    <p style={{ whiteSpace: "pre-wrap" }}>
                      {page.scenePhotoDraft.description}
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        patchPage({
                          sceneDescription: page.scenePhotoDraft!.description,
                          scenePhotoDraft: undefined,
                        })
                      }
                    >
                      Use photo draft
                    </button>
                    <button
                      type="button"
                      onClick={() => patchPage({ scenePhotoDraft: undefined })}
                    >
                      Discard photo draft
                    </button>
                  </div>
                )}
                <Field
                  label="The words on this page"
                  hint="Keep it short and sweet; a little space lets the picture breathe."
                >
                  <textarea
                    rows={3}
                    value={page.storyText}
                    onChange={(e) => patchPage({ storyText: e.target.value })}
                  />
                </Field>
                <span className="field-label">Who appears in this scene?</span>
                <div className="character-choices">
                  {p.characters.map((c) => (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={page.characterIds.includes(c.id)}
                        onChange={(e) =>
                          patchPage({
                            characterIds: e.target.checked
                              ? [...page.characterIds, c.id]
                              : page.characterIds.filter((id) => id !== c.id),
                          })
                        }
                      />
                      {c.name}
                      {c.status === "locked" ? " ✓" : ""}
                    </label>
                  ))}
                </div>
                {selected &&
                  retryIdentityIssues(selected.recipe, p.characters).length >
                    0 && (
                    <p className="help">
                      The selected version uses older or unapproved character
                      references. Use Edit &amp; Regenerate after locking the
                      current characters.
                    </p>
                  )}
                <div
                  className="reference-summary"
                  aria-label="Chapter illustration references"
                >
                  <strong>
                    References for Generate / Edit &amp; Regenerate
                  </strong>
                  <p>
                    Style:{" "}
                    {p.visualStyle.status === "locked" &&
                    p.visualStyle.previewImage
                      ? "Approved style sample"
                      : "Not approved — generate and lock your style first"}
                  </p>
                  <p>
                    Characters:{" "}
                    {page.characterIds.length
                      ? p.characters
                          .filter((c) => page.characterIds.includes(c.id))
                          .map(
                            (c) =>
                              `${c.name} (${c.status === "locked" && c.characterSheetImage ? "approved sheet" : "needs approval"})`,
                          )
                          .join(", ")
                      : "None selected — no character identity images will be sent"}
                  </p>
                  <p>
                    Scene photos are used for text drafting only and are not
                    attached to illustration requests, including retries and
                    tweaks.
                  </p>
                  {selected && (
                    <p>
                      Try Again keeps the character and style references saved
                      with this selected version. Use Edit &amp; Regenerate to
                      apply newer approvals.
                    </p>
                  )}
                  {selected?.recipe && (
                    <details>
                      <summary>
                        {selected.referenceManifest
                          ? "References used by selected version"
                          : "Saved recipe references (legacy version)"}
                      </summary>
                      {(
                        selected.referenceManifest ||
                        referenceAssets(selected.recipe)
                      ).map((r, i) => (
                        <p key={r.id}>
                          {i + 1}. {r.label}
                        </p>
                      ))}
                    </details>
                  )}
                </div>
                <p className="help">
                  Upload up to four scene photos to draft clothing, poses,
                  location, background and composition. Review and refine the
                  text before illustrating. Only the scene text, approved
                  character sheets and style references go to image generation;
                  scene photos do not. Photo drafting uses AI even in sample
                  artwork mode.
                </p>
                <DropZone
                  disabled={isLocked || operationBusy || pageQueued}
                  images={page.referencePhotos}
                  onChange={(ids) => patchPage({ referencePhotos: ids })}
                  onUploaded={(ids) =>
                    draftScene([...chapter.referencePhotos, ...ids])
                  }
                />
                <button
                  type="button"
                  disabled={
                    isLocked ||
                    operationBusy ||
                    !(
                      chapter.referencePhotos.length +
                      page.referencePhotos.length
                    )
                  }
                  onClick={() =>
                    draftScene([
                      ...chapter.referencePhotos,
                      ...page.referencePhotos,
                    ])
                  }
                >
                  {busy === "photo-draft"
                    ? "Reading scene photos…"
                    : "Draft scene from photos"}
                </button>
                {busy === "photo-draft" && (
                  <p role="status">
                    Reading scene photos to draft the details. Your existing
                    text will be kept for review.
                  </p>
                )}
                <details>
                  <summary>A few extra details (optional)</summary>
                  <Field label="Composition notes">
                    <textarea
                      value={page.compositionNotes}
                      onChange={(e) =>
                        patchPage({ compositionNotes: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Things to include">
                    <input
                      value={page.requiredElements}
                      onChange={(e) =>
                        patchPage({ requiredElements: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Things to avoid">
                    <input
                      value={page.excludedElements}
                      onChange={(e) =>
                        patchPage({ excludedElements: e.target.value })
                      }
                    />
                  </Field>
                  <details>
                    <summary>View illustration recipe</summary>
                    <pre>
                      {selected?.prompt ||
                        "Generate an illustration to see its recipe."}
                    </pre>
                  </details>
                </details>
              </fieldset>
              <div className="actions">
                <button
                  className="primary"
                  disabled={isLocked || !!busy || pageQueued}
                  onClick={() => generate("scene")}
                >
                  {pageQueued
                    ? "Queued / Illustrating…"
                    : selected
                      ? "Edit & Regenerate"
                      : "Generate"}
                </button>
                {selected && (
                  <button
                    disabled={isLocked || !!busy || pageQueued}
                    onClick={() => generate("scene", true)}
                  >
                    Try Again
                  </button>
                )}
                <button
                  disabled={!!busy || pageQueued || (!selected && !isLocked)}
                  onClick={() =>
                    patchPage(
                      isLocked
                        ? { status: "draft", lockedTypography: undefined }
                        : {
                            status: "locked",
                            lockedTypography: { ...p.typography },
                          },
                    )
                  }
                >
                  {isLocked ? "Unlock Page" : "Lock Page"}
                </button>
              </div>
              {selected && (
                <details className="tweak-panel">
                  <summary>Give feedback &amp; tweak part of the image</summary>
                  {isLocked && (
                    <p className="help">
                      Unlock this page before changing an area. The locked
                      version stays saved in your history.
                    </p>
                  )}
                  <ImageTweaker
                    key={selected.id}
                    image={selected.image}
                    disabled={isLocked || operationBusy || pageQueued}
                    sampleMode={sampleMode}
                    onApply={tweakImage}
                  />
                </details>
              )}
              {page.illustrationVersions.length > 0 && (
                <div className="versions">
                  <span>Versions</span>
                  {page.illustrationVersions.map((v, i) => (
                    <button
                      disabled={isLocked || !!busy || pageQueued}
                      key={v.id}
                      className={
                        page.selectedIllustrationId === v.id ? "selected" : ""
                      }
                      onClick={() =>
                        patchPage({
                          selectedIllustrationId: v.id,
                          generatedPrompt: v.prompt,
                        })
                      }
                    >
                      {i + 1}
                      {v.recipe?.tweak ? " · edit" : ""}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {step === 5 && (
            <>
              <p className="section-description">
                Some things are best said in your own words.
              </p>
              {(["heading", "message", "signature", "date"] as const).map(
                (key) => (
                  <Field
                    key={key}
                    label={
                      {
                        heading: "A heading (optional)",
                        message: "Your message to Ava",
                        signature: "With love from",
                        date: "A date to remember (optional)",
                      }[key]
                    }
                  >
                    {key === "message" ? (
                      <textarea
                        rows={7}
                        value={p.closingMessage[key]}
                        onChange={(e) =>
                          change((p) => ({
                            ...p,
                            closingMessage: {
                              ...p.closingMessage,
                              [key]: e.target.value,
                            },
                          }))
                        }
                      />
                    ) : (
                      <input
                        type={key === "date" ? "date" : "text"}
                        value={p.closingMessage[key]}
                        onChange={(e) =>
                          change((p) => ({
                            ...p,
                            closingMessage: {
                              ...p.closingMessage,
                              [key]: e.target.value,
                            },
                          }))
                        }
                      />
                    )}
                  </Field>
                ),
              )}
              <p className="help">Add a family photograph, if you like.</p>
              <DropZone
                images={p.closingMessage.photo ? [p.closingMessage.photo] : []}
                onChange={(ids) =>
                  change((p) => ({
                    ...p,
                    closingMessage: { ...p.closingMessage, photo: ids.at(-1) },
                  }))
                }
              />
            </>
          )}
          {step === 6 && (
            <>
              <p className="section-description">
                Create a new front cover using photos, freeform instructions, or
                both. The cover remains the first printed page. Book Setup
                controls the title and subtitle shown over the artwork. Approved
                Character Studio sheets guide likeness, Visual Style guides the
                artwork, and Typography & Layout controls the cover text.
              </p>
              <p className="help">
                Character references:{" "}
                {p.characters
                  .filter((c) => c.status === "locked" && c.characterSheetImage)
                  .map((c) => c.name)
                  .join(", ") ||
                  "None approved — generate and lock character sheets in Character Studio to reuse their likeness."}{" "}
                Visual style:{" "}
                {p.visualStyle.status === "locked" && p.visualStyle.previewImage
                  ? "approved sample and style description"
                  : "current style description; lock a style sample to attach it"}
                . Typography: {p.typography.headingFont} headings,{" "}
                {p.typography.bodyFont} body text, {p.typography.alignment}{" "}
                aligned.
              </p>
              <fieldset disabled={operationBusy}>
                <Field
                  label="Cover instructions"
                  hint="Describe the subjects, setting, mood, colors and key details. Title and subtitle are added by the app, not the image model."
                >
                  <textarea
                    rows={6}
                    maxLength={5000}
                    value={cover.instructions}
                    onChange={(e) =>
                      patchCover({ instructions: e.target.value })
                    }
                    placeholder="For example: Ava and her parents exploring the Shanghai waterfront at sunset, with a warm watercolor feeling."
                  />
                </Field>
                <p className="help">
                  Optional cover photos guide clothing, poses, setting and
                  composition. Approved character sheets take priority for
                  likeness. These photos are sent directly for cover generation;
                  chapter scene photos remain excluded from chapter illustration
                  requests.
                </p>
                <DropZone
                  label="Cover reference photos"
                  images={cover.referencePhotos}
                  disabled={operationBusy}
                  onChange={(ids) => patchCover({ referencePhotos: ids })}
                />
              </fieldset>
              <div className="actions">
                <button
                  className="primary"
                  disabled={
                    operationBusy ||
                    (!cover.instructions.trim() &&
                      !cover.referencePhotos.length)
                  }
                  onClick={generateCover}
                >
                  {busy === "cover" ? "Creating cover…" : "Re-create cover"}
                </button>
                <button
                  disabled={operationBusy || !cover.selectedIllustrationId}
                  onClick={() =>
                    patchCover({ selectedIllustrationId: undefined })
                  }
                >
                  Use original cover
                </button>
              </div>
              <p className="help">
                Previous covers stay saved. Cover generation uses the current
                illustration mode and runs after any chapter queue has finished.
              </p>
              {selectedCover && (
                <p className="help">
                  {selectedCover.model.startsWith("mock")
                    ? "Sample cover · uploaded photo likeness is not reproduced"
                    : `Generated with ${selectedCover.model}`}
                </p>
              )}
              {!!cover.illustrationVersions.length && (
                <div className="versions" aria-label="Cover versions">
                  <span>Cover versions</span>
                  {cover.illustrationVersions.map((version, i) => (
                    <button
                      key={version.id}
                      disabled={operationBusy}
                      className={
                        cover.selectedIllustrationId === version.id
                          ? "selected"
                          : ""
                      }
                      onClick={() =>
                        patchCover({ selectedIllustrationId: version.id })
                      }
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              )}
              <details>
                <summary>View cover recipe</summary>
                <pre>
                  {selectedCover?.prompt ||
                    "Generate a cover to see its recipe."}
                </pre>
              </details>
            </>
          )}
          {step === 7 && (
            <>
              <p className="section-description">
                A little album at the end of your adventure.
              </p>
              <Field label="Photos on each page">
                <select
                  value={p.exportSettings.memoryLayout}
                  onChange={(e) =>
                    change((p) => ({
                      ...p,
                      exportSettings: {
                        ...p.exportSettings,
                        memoryLayout: +e.target.value as 1 | 2 | 4,
                      },
                    }))
                  }
                >
                  <option value={1}>One beautiful photograph</option>
                  <option value={2}>Two moments together</option>
                  <option value={4}>Four little memories</option>
                </select>
              </Field>
              <DropZone
                images={p.photoMemories.map((x) => x.image)}
                onChange={(ids) =>
                  change((p) => ({
                    ...p,
                    photoMemories: ids.map(
                      (id) =>
                        p.photoMemories.find((x) => x.image === id) || {
                          id: uid(),
                          image: id,
                          caption: "",
                          position: 50,
                        },
                    ),
                  }))
                }
              />
              {p.photoMemories.map((photo, i) => (
                <div className="memory-controls" key={photo.id}>
                  <Field label={`Memory ${i + 1} · caption`}>
                    <input
                      value={photo.caption}
                      onChange={(e) =>
                        change((p) => ({
                          ...p,
                          photoMemories: p.photoMemories.map((x) =>
                            x.id === photo.id
                              ? { ...x, caption: e.target.value }
                              : x,
                          ),
                        }))
                      }
                    />
                  </Field>
                  <Field label="Reposition photo">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={photo.position}
                      onChange={(e) =>
                        change((p) => ({
                          ...p,
                          photoMemories: p.photoMemories.map((x) =>
                            x.id === photo.id
                              ? { ...x, position: +e.target.value }
                              : x,
                          ),
                        }))
                      }
                    />
                  </Field>
                </div>
              ))}
            </>
          )}
          {step >= 8 && (
            <>
              <p className="section-description">
                {allPages.length} pages of memories, in the order they’ll appear
                in your book.
              </p>
              <div className="page-list">
                {allPages.map((x, i) => (
                  <button
                    key={x.id}
                    className={previewIndex === i ? "selected" : ""}
                    onClick={() => setPreviewIndex(i)}
                  >
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>
                        {x.kind === "cover"
                          ? "Front cover"
                          : x.kind === "letter"
                            ? "Closing letter"
                            : x.kind === "memories"
                              ? "Photo memories"
                              : x.title}
                      </strong>
                      <small>
                        {x.kind === "story"
                          ? `${p.chapters.flatMap((c) => c.pages).find((s) => s.id === x.id)?.status === "locked" ? "Locked" : "Draft"} · Story page`
                          : x.kind === "cover"
                            ? p.title
                            : x.kind === "letter"
                              ? "With love, always"
                              : "Real moments"}
                      </small>
                    </div>
                    <span>→</span>
                  </button>
                ))}
              </div>
              {step === 8 ? (
                <button
                  className="primary wide"
                  onClick={() => {
                    go(preview.editStep);
                    if (preview.pageId) {
                      const ci = p.chapters.findIndex((c) =>
                        c.pages.some((s) => s.id === preview.pageId),
                      );
                      setChapterIndex(ci);
                      setPageIndex(
                        p.chapters[ci].pages.findIndex(
                          (s) => s.id === preview.pageId,
                        ),
                      );
                    }
                  }}
                >
                  Edit this page →
                </button>
              ) : (
                <>
                  <div className="format-card">
                    <span>▤</span>
                    <div>
                      <strong>8 × 8 inches · {allPages.length} pages</strong>
                      <p>300 DPI rendering · ¼ inch text-safe margins</p>
                    </div>
                  </div>
                  {p.chapters.some((c) =>
                    c.pages.some(
                      (s) => s.status !== "locked" || !s.selectedIllustrationId,
                    ),
                  ) && (
                    <p className="help">
                      Some story pages are drafts or have no illustration.
                      They’ll export as shown in the preview.
                    </p>
                  )}
                  <button
                    className="primary wide"
                    disabled={operationBusy}
                    onClick={() => download("pdf")}
                  >
                    {busy === "pdf"
                      ? `Preparing page ${exportProgress} of ${allPages.length}…`
                      : "Export Book as PDF"}{" "}
                    <span>↓</span>
                  </button>
                  <button
                    className="primary wide"
                    disabled={operationBusy}
                    onClick={() => download("jpeg")}
                  >
                    {busy === "jpeg"
                      ? `Preparing JPEG page ${exportProgress} of ${allPages.length}…`
                      : "Export Book as JPEG (ZIP)"}{" "}
                    ↓
                  </button>
                  <p className="help">
                    JPEG export downloads one ZIP containing a 2400 × 2400 image
                    for every page, including the cover, in reading order.
                    Filenames use “BOOK NAME - Page X.jpg”. Page numbers are
                    zero-padded for books with 10 or more pages so filename
                    sorting keeps them in sequence.
                  </p>
                  <p className="help">
                    AI illustrations are generated at 1024 × 1024 pixels. PDF
                    pages render at 300 DPI, but enlarging an image does not add
                    detail. Sample illustrations already in the book remain as
                    selected.
                  </p>
                </>
              )}
            </>
          )}
          <div className="page-footnote">
            {String(step * 2 + 1).padStart(2, "0")}{" "}
            <span>MADE WITH LOVE, ONE PAGE AT A TIME</span>
          </div>
        </section>
        <section className="preview-page">
          <div className="page-heading">
            <span className="eyebrow">
              {step >= 8 ? "YOUR BOOK" : "A LITTLE PREVIEW"}
            </span>
            <span className="small-status">8 × 8 INCHES</span>
          </div>
          <div className="preview-wrap">{right}</div>
          <div className="preview-caption">
            <span>✦</span>
            <p>
              {isLocked
                ? "This version is locked. Unlock it to make changes."
                : step === 0
                  ? "A book only your family could make."
                  : step === 2 || step === 1
                    ? step === 2 && character.characterSheetImage
                      ? character.generationModel?.startsWith("mock")
                        ? "Sample illustration"
                        : character.generationModel
                          ? "AI illustration"
                          : "Saved illustration"
                      : step === 1 && p.visualStyle.previewImage
                        ? p.visualStyle.generationModel?.startsWith("mock")
                          ? "Sample illustration"
                          : p.visualStyle.generationModel
                            ? "AI illustration"
                            : "Saved illustration"
                        : generationLabel
                    : "Your words. Your memories. Your story."}
            </p>
          </div>
          {step >= 8 && (
            <div className="preview-nav">
              <button
                disabled={previewIndex === 0}
                onClick={() => setPreviewIndex((i) => i - 1)}
              >
                ← Previous page
              </button>
              <span>
                {previewIndex + 1} / {allPages.length}
              </span>
              <button
                disabled={previewIndex === allPages.length - 1}
                onClick={() => setPreviewIndex((i) => i + 1)}
              >
                Next page →
              </button>
            </div>
          )}
          <div className="page-footnote">
            <span>AVA’S SHANGHAI ADVENTURE</span>
            {String(step * 2 + 2).padStart(2, "0")}
          </div>
        </section>
      </main>
      <footer>
        <button disabled={step === 0 || !!busy} onClick={() => go(step - 1)}>
          ← Previous
        </button>
        <span>
          YOUR STORY, SAFELY SAVED IN THIS BROWSER
          <span> · No account needed</span>
        </span>
        <button
          className="next-button"
          disabled={step === 9 || !!busy}
          onClick={() => go(step + 1)}
        >
          Next chapter →
        </button>
      </footer>
      {drawer && (
        <div className="overlay" onClick={() => setDrawer(false)}>
          <aside
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Book Drawer"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              onClick={() => setDrawer(false)}
              autoFocus
              aria-label="Close Book Drawer"
            >
              ×
            </button>
            <span className="eyebrow">YOUR LITTLE BOOK</span>
            <h2>{p.title}</h2>
            {steps.map((s, i) => (
              <div key={s}>
                <button
                  className={step === i ? "selected" : ""}
                  onClick={() => go(i)}
                >
                  {String(i + 1).padStart(2, "0")} <span>{s}</span>
                </button>
                {i === 4 &&
                  p.chapters.map((c, ci) => (
                    <button
                      className="drawer-chapter"
                      key={c.id}
                      onClick={() => {
                        setChapterIndex(ci);
                        setPageIndex(0);
                        go(4);
                      }}
                    >
                      {c.title}
                    </button>
                  ))}
              </div>
            ))}
            <button
              onClick={() => {
                setDrawer(false);
                setSettings(true);
              }}
            >
              Project settings
            </button>
          </aside>
        </div>
      )}
      {settings && (
        <div className="overlay" onClick={() => setSettings(false)}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Project settings"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              autoFocus
              onClick={() => setSettings(false)}
              aria-label="Close settings"
            >
              ×
            </button>
            <h2>Your book, on this device</h2>
            <p>
              Stories save automatically in this browser. Photos and
              illustrations stay on this device. Clearing browser data removes
              the book.
            </p>
            <p>
              Your book stays on this device. With AI illustrations enabled,
              only the descriptions and selected reference images for each
              generation are sent to OpenAI when you click Generate.
            </p>
            <Field label="Illustration mode">
              <select
                disabled={!!busy}
                value={p.generationMode || "auto"}
                onChange={(e) =>
                  change((p) => ({
                    ...p,
                    generationMode: e.target.value as "auto" | "mock",
                  }))
                }
              >
                <option value="auto">AI illustrations when configured</option>
                <option value="mock">
                  Sample artwork · local illustrations
                </option>
              </select>
            </Field>
            <p className="help">
              {generationInfo?.available
                ? "The server has an image API credential configured. Each AI generation uses API credits."
                : "AI needs an image API credential in server settings. Until then, sample artwork keeps the book editable."}{" "}
              Failures never replace your selected image with a sample.
            </p>
            <button
              disabled={!!busy}
              onClick={() => {
                setGenerationSettingsError(false);
                generationStatus()
                  .then(setGenerationInfo)
                  .catch(() => setGenerationSettingsError(true));
              }}
            >
              Check illustration settings
            </button>
            <button className="danger" disabled={operationBusy} onClick={reset}>
              Reset Project
            </button>
          </section>
        </div>
      )}
      {(busy === "pdf" || busy === "jpeg") && (
        <div ref={exportRoot} className="export-pages" aria-hidden="true">
          {allPages.map((x) => (
            <BookPage key={x.id} project={p} page={x} />
          ))}
        </div>
      )}
    </div>
  );
}
