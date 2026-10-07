# Ava’s Shanghai Adventure Book Creator

A complete, local-first MVP for making one family storybook. Next.js, React and TypeScript; no accounts, cloud database or AI credentials are required. Illustrations are deliberately mocked for v1.

## Run locally

Use Node.js 22 or 24 and npm.

```sh
npm ci
npm run dev
```

Open the development server in your browser on port 3000. For a production run, use `npm run build` followed by `npm start`.

## Create a book

1. Give the book a title and a feeling.
2. Add photos and descriptions for Ava, Mama and Papa. Generate and lock their character sheets.
3. Generate and lock a visual style.
4. Choose fonts, sizes, alignment and text placement.
5. Add chapters and individual pages, choose characters, upload references and generate illustrations. Try Again retains the selected version’s generation recipe; Edit & Regenerate uses current inputs. Select an earlier version at any time before locking.
6. Add a closing letter and family photo, then upload photographs for the memories section.
7. Review all pages and export an 8 × 8 inch PDF.

The Book Drawer and numbered progress navigation provide direct access to every section. Inputs are on the left; output is on the right. On mobile, these stack vertically.

## Local data architecture

- `lib/model.ts`: versioned project schema, defaults and locked-page updates.
- `lib/storage.ts`: localStorage project metadata and IndexedDB asset blobs. Photos are resized to at most 2400 pixels on their longest edge. Metadata stores opaque asset IDs, not image data.
- `lib/generation.ts`: provider-neutral `IllustrationService`, prompt assembly and a local 2400 × 2400 canvas mock. Every page variant retains its prompt, references and generation recipe. A future provider can implement the same service interface.
- `components/BookPage.tsx`: shared square-page rendering and reading order for both preview and export.
- `lib/pdf.ts`: browser-side PDF export using the same page renderer, 2400 × 2400 rasterization, exact 576 × 576 point pages and ¼ inch text-safe areas.

Meaningful edits autosave with a short debounce; pagehide flushes current metadata. Reload restores the project. Corrupted metadata is retained rather than silently replaced. The UI reports upload, storage, generation and export errors. Reset Project requires confirmation and clears local metadata and image assets.

Locked assets cannot be edited or regenerated until manually unlocked. Locked pages also snapshot typography. Global changes leave existing locked pages unchanged. Generation history is retained for story pages.

## Validation

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

The browser tests cover the complete workflow, image uploads, version selection, lock protection, reload persistence, PDF download/page dimensions and mobile error handling. Cloud tests use `/usr/bin/chromium`; elsewhere, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to your installed Chromium path or install Playwright Chromium with `npx playwright install chromium`.

## MVP limits

Mock artwork demonstrates the workflow; it does not reproduce uploaded likenesses, obey scene content, or interpret uploaded styles. No files are sent to an AI service. Built-in system fonts are supported; custom font upload is deferred. PDFs use high-resolution rasterized pages, so text is not selectable; there is no printer bleed or color-profile support. Preview and export share the renderer. Oversized story text must be shortened or reduced in size before export.

One book lives in one browser profile on one device. Clearing browser data removes it. There is no project synchronization or backup feature. Removing a photo from a section removes its reference; unused blobs remain until project reset, avoiding accidental deletion of shared references.
