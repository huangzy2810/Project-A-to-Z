# Ava’s Shanghai Adventure Book Creator

MVP v2 of a local-first family storybook creator, built with Next.js, React and TypeScript. Real OpenAI image generation is available with a server-side credential; sample artwork remains available without one. There are no accounts or cloud database. Existing v1 books restore without migration.

## Run locally

Use Node.js 22.19 or later (Node.js 24 recommended) and npm.

```sh
npm ci
npm run dev
```

Open the development server in your browser on port 3000. For a production run, use `npm run build` followed by `npm start`.

## Enable AI illustrations

1. For local development, copy `.env.example` to `.env.local` and set `IMAGE_API_KEY` to your OpenAI API key. Keep it server-only; never use a `NEXT_PUBLIC_` variable or commit the file. Existing `OPENAI_API_KEY` is also accepted for ordinary local deployments.
2. In the Codex cloud environment, enter the **IMAGE_API_KEY** secret securely in environment settings, with `api.openai.com` as its destination. The reserved `OPENAI_` prefix cannot be used for a new cloud secret binding, so the application supports this alternate name. Review/save configuration and publish the environment as appropriate.
3. Restart the Next.js server after setting a local environment file. Open project settings and click **Check illustration settings**. A configured credential is reported without exposing its value; successful API generation is the actual access check.
4. Select **AI illustrations when configured**. Character, style and page generation now use OpenAI. Select **Sample artwork · no API calls** to work offline with local samples.

The provider uses `gpt-image-1.5`, one high-quality 1024 × 1024 PNG per generation, and high input fidelity for reference-image requests. No references uses `/v1/images/generations`; attached photos use `/v1/images/edits`. Approved character identity references come first, followed by approved style and scene references, with matching labels in the assembled prompt. Character sheets use the primary photo and other identity photos. Up to 16 deduplicated references are supported, with an 8 MB per-file and 28 MB total request limit. The server bounds and validates the upload before sending it upstream.

**Generate sends the chosen references and descriptions to OpenAI and uses your API credits.** The app does not automatically generate on load, retry paid requests, or replace failed AI requests with mock artwork. Timeout, quota, access and invalid-input errors keep all existing images and history. No key means explicitly labelled sample mode. An unavailable settings endpoint blocks automatic mode rather than silently claiming an AI result. API billing/model access and organization verification may be required by your OpenAI account. See [OpenAI image generation documentation](https://platform.openai.com/docs/guides/image-generation).

The endpoint uses the server’s credential and has no application authentication. Keep this MVP server in a trusted/private environment. Same-origin validation, bounded uploads and one in-flight generation per server process are included; they are not a replacement for deployment access controls or a distributed rate limiter. Hosting must support Node.js, multipart uploads and requests lasting up to three minutes. Proxy-backed cloud credentials use the configured HTTP(S) proxy through Undici with TLS verification intact.

## Create a book

1. Give the book a title and a feeling.
2. Add photos and descriptions for Ava, Mama and Papa. Generate and lock their character sheets.
3. Generate and lock a visual style.
4. Choose fonts, sizes, alignment and text placement.
5. Add chapters and individual pages, choose characters, upload references and generate illustrations (AI or samples, according to your settings). Try Again retains the selected version’s generation recipe; Edit & Regenerate uses current inputs. Select an earlier version at any time before locking.
6. Add a closing letter and family photo, then upload photographs for the memories section.
7. Review all pages and export an 8 × 8 inch PDF.

The Book Drawer and numbered progress navigation provide direct access to every section. Inputs are on the left; output is on the right. On mobile, these stack vertically.

## Local data architecture

- `lib/model.ts`: versioned project schema, defaults and locked-page updates.
- `lib/storage.ts`: localStorage project metadata and IndexedDB asset blobs. Photos are resized to at most 2400 pixels on their longest edge. Metadata stores opaque asset IDs, not image data.
- `lib/generation.ts`: browser-side `IllustrationService`, multipart reference upload, PNG validation/persistence and a local 2400 × 2400 canvas mock. Every page variant retains its prompt, references, generation recipe, model and source dimensions.
- `lib/recipe.ts`: shared reference selection, ordering, deduplication and prompt assembly. Content, approved identity, visual style and composition remain separate.
- `app/api/illustrations/route.ts`: uncached configuration status and a server-only generation endpoint. No secret is returned to the browser.
- `lib/server/`: upload schema/size validation, same-origin request handling and a provider abstraction backed by the official OpenAI SDK. Image bytes are returned to the browser; the server does not store project data or photos.
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

The tests cover the complete workflow, image uploads, version selection, lock protection, reload persistence, PDF download/page dimensions and mobile error handling. API tests exercise the real OpenAI SDK request serialization with a simulated transport: text-only generation, multipart reference editing, upload/schema validation, duplicate-request protection and safe errors. Browser tests also exercise the AI client and real upload handler with a simulated provider, including reference ordering, retry recipe snapshots, generation history, persisted provider selection and failure without mock fallback. They make no paid API calls. Live OpenAI generation requires a usable credential and is not established by these simulated tests. Cloud tests use `/usr/bin/chromium`; elsewhere, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to your installed Chromium path or install Playwright Chromium with `npx playwright install chromium`.

## MVP limits

Sample mode demonstrates the workflow; it does not reproduce uploaded likenesses, obey scene content, or interpret uploaded styles. AI mode sends only the references for the requested illustration to OpenAI; original photos remain locally stored. Image generation follows reference guidance but cannot guarantee perfect likeness or character consistency. Built-in system fonts are supported; custom font upload is deferred. PDFs use 2400 × 2400 rasterized pages, so text is not selectable; there is no printer bleed or color-profile support. AI source images are 1024 × 1024 (128 source pixels per inch at 8 inches). Rendering the PDF at 300 DPI does not create new image detail; inspect the export before printing. Preview and export share the renderer. Oversized story text must be shortened or reduced in size before export.

One book lives in one browser profile on one device. Clearing browser data removes it. There is no project synchronization or backup feature. Removing a photo from a section removes its reference; unused blobs remain until project reset, avoiding accidental deletion of shared references.
