# Ava’s Shanghai Adventure Book Creator

MVP v3 of a local-first family storybook creator, built with Next.js, React and TypeScript. This branch is `mvp-v3`; `main` remains MVP v2. Real OpenAI image generation and photo-to-scene drafting are available with a server-side credential; sample artwork remains available without one. There are no accounts or cloud database. V3 uses separate browser storage (`ava-book-project-v3` and IndexedDB `ava-book-assets-v3`), so it does not read, overwrite or reset v2 books. V3 starts a separate book; automatic v2 import is not included. Continue using v2 in its original Codespace/browser URL to access its saved book.

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
4. Select **AI illustrations when configured**. Character, style and page generation now use OpenAI. Select **Sample artwork · local illustrations** for local sample generation. Photo drafting is a separate AI operation; avoid scene-photo uploads or the drafting button when working offline.

MVP v3 requests `gpt-image-2.5-flare` for character sheets, style samples, chapter illustrations and partial edits. Scene-photo analysis remains on `gpt-4.1-mini`. Live access and compatibility with the existing size, quality and mask parameters must be verified with your API project; local automated tests simulate API responses. The provider requests one high-quality 1024 × 1024 PNG per generation. It omits the legacy `input_fidelity` parameter for Flare; the SDK documents that control for older image models. No references uses `/v1/images/generations`; attached photos use `/v1/images/edits`. Approved character identity references come first, followed by approved style references (scene photos are excluded), with matching labels in the assembled prompt. Style previews are uninhabited backgrounds and never receive character identity attachments; any people in uploaded style references are explicitly excluded from the output. Character sheets use the primary photo, other identity photos, and the locked style sample. Generating a character requires a locked visual style. Up to 16 deduplicated references are supported, with an 8 MB per-file and 28 MB total request limit. The server bounds and validates the upload before sending it upstream.

**Generate sends the chosen references and descriptions to OpenAI and uses your API credits.** The app does not automatically generate on load, retry paid requests, or replace failed AI requests with mock artwork. Timeout, quota, access and invalid-input errors keep all existing images and history. HTTP 400 errors report recognized rejected parameter names or fixed reason codes when supplied by OpenAI, without exposing raw upstream messages or credentials. No key means explicitly labelled sample illustrations; photo drafting reports that configuration is required. An unavailable settings endpoint blocks automatic mode rather than silently claiming an AI result. API billing/model access and organization verification may be required by your OpenAI account. See [OpenAI image generation documentation](https://platform.openai.com/docs/guides/image-generation).

The endpoint uses the server’s credential and has no application authentication. Keep this MVP server in a trusted/private environment. Same-origin validation, bounded uploads and one in-flight generation per server process are included; they are not a replacement for deployment access controls or a distributed rate limiter. Hosting must support Node.js, multipart uploads and requests lasting up to three minutes. Proxy-backed cloud credentials use the configured HTTP(S) proxy through Undici with TLS verification intact.

## Create a book

1. Give the book a title and a feeling.
2. Generate and lock a visual style using a background-only sample. No character identities are sent to this step.
3. Add photos and descriptions for Ava, Mama and Papa. Generate and lock their character sheets using the approved visual style.
4. Choose fonts, sizes, alignment and text placement.
5. Add chapters and individual pages, choose characters, and upload up to four scene photos (chapter and page photos combined) to draft the current page’s scene text. An empty “What happens on this page?” is filled automatically; existing text is preserved and a reviewable draft appears with **Use photo draft** and **Discard photo draft**. Refine the text and replace positional labels with character names as needed, then generate illustrations (AI or samples, according to your settings). Try Again retains the selected version’s generation recipe; Edit & Regenerate uses current inputs. Select an earlier version at any time before locking.
6. Add a closing letter and family photo, then upload photographs for the memories section.
7. Review all pages and export an 8 × 8 inch PDF.

The Book Drawer and numbered progress navigation provide direct access to every section. Inputs are on the left; output is on the right. On mobile, these stack vertically.

## Local data architecture

- `lib/model.ts`: versioned project schema, defaults and locked-page updates.
- `lib/storage.ts`: localStorage project metadata and IndexedDB asset blobs. Photos are resized to at most 2400 pixels on their longest edge. Metadata stores opaque asset IDs, not image data.
- `lib/generation.ts`: browser-side `IllustrationService`, multipart reference upload, PNG validation/persistence and a local 2400 × 2400 canvas mock. Every page variant retains its prompt, references, generation recipe, model and source dimensions.
- `lib/recipe.ts`: shared reference selection, ordering, deduplication and prompt assembly. Content, approved identity, visual style and composition remain separate.
- `app/api/scene-description/route.ts`: separate vision-to-text endpoint using `gpt-4.1-mini`, up to four scene photos, bounded inputs and no automatic retries.
- `app/api/illustrations/route.ts`: uncached configuration status and a server-only generation endpoint. No secret is returned to the browser.
- `lib/server/`: upload schema/size validation, same-origin request handling and a provider abstraction backed by the official OpenAI SDK. Image bytes are returned to the browser; the server does not store project data or photos.
- `components/BookPage.tsx`: shared square-page rendering and reading order for both preview and export.
- `lib/pdf.ts`: browser-side PDF export using the same page renderer, 2400 × 2400 rasterization, exact 576 × 576 point pages and ¼ inch text-safe areas.

Meaningful edits autosave with a short debounce; pagehide flushes current metadata. Reload restores the project. Corrupted metadata is retained rather than silently replaced. The UI reports upload, storage, generation and export errors. Reset Project requires confirmation and clears local metadata and image assets.

Chapter generation requires a locked visual-style sample and locked character sheets for every selected character. Older locked assets are retained. To apply the new workflow to an existing book, explicitly unlock and regenerate the visual style as a background, lock it, then unlock/regenerate character sheets in that style. The editor flags older style samples and character sheets made with a different or missing style reference. Existing story pages remain unchanged until explicitly regenerated.

The Chapter Builder shows current approvals and the selected version’s actual reference list. Select the characters explicitly; if the scene names a known character whose checkbox is off, generation stops and asks you to include their approved identity. Every selected character’s approved sheet is attached first, without sending raw identity photos to chapter generation, so identity-photo clothing cannot be copied. Character generation now makes a four-view face-only sheet (front, three-quarter, profile and smiling) with no clothing, body, accessories or scenery. Older character images require explicit unlock/regeneration to become face-only. Chapter and page scene photos are used only by a separate photo-analysis endpoint to draft clothing, poses, interaction, location, background, framing and lighting details. They are never attached to chapter illustration requests, including retries and partial repairs. The illustrator receives the reviewed scene text, approved character sheets and existing style references. Scene-photo restrictions disappear from the numbered attachment list because those images are absent; all other illustration prompt rules remain unchanged. The prompt includes each selected character’s “What makes them, them?” description, binds names to exact image numbers, and separates identity from style and setting. Approved face sheets remain the facial identity reference; written scene outfits and actions take priority over general character descriptions. Try Again keeps the selected version’s saved approvals, while Edit & Regenerate applies current approvals. If Character Studio changes or a character is unlocked, Try Again is blocked until you apply the current approved identity through Edit & Regenerate. Previous versions are retained. Drafted scene text does not override the approved visual treatment.

Locked assets cannot be edited or regenerated until manually unlocked, except chapter illustrations explicitly included through the whole-book shortcut. Locked pages also snapshot typography. Global changes leave existing locked pages unchanged. Generation history is retained for story pages.


## Background queue and whole-book chapter regeneration

In Chapter Builder, **Generate**, **Edit & Regenerate** and **Try Again** add the current page to a background queue. Navigate to other pages and submit additional illustrations while a request runs. Jobs run sequentially; duplicate submissions for an already queued/running page are ignored. Each job snapshots its scene text, approved references, composition and illustration mode. Its result appends to its original page’s version history and becomes selected without replacing edits on other pages. Character/style changes and partial repairs wait until the queue is idle. Pages awaiting generation cannot be edited or locked until their job finishes; other pages remain editable.

Open **Regenerate all chapter illustrations** to queue eligible pages across every chapter using their current inputs and approvals. Locked pages are skipped by default. Check **Include locked pages and replace their selected illustrations** to explicitly include them; their existing images, locked status and typography remain preserved. Blank scenes, missing approvals, unselected named characters and already queued pages are listed as skipped. This shortcut regenerates story illustrations only, not style samples, character sheets, closing letters or photo memories. Review the ready count before starting; each AI job uses API credits.

The queue panel remains visible across sections and shows waiting, generating, ready and failed jobs, plus elapsed seconds for each completed attempt (including failures). **Stop after current image** cancels waiting jobs and lets the active request finish. Failed/canceled jobs require an explicit **Retry**; a failure does not stop other valid pages. Retries use the saved job snapshot. If approvals changed, queue the page again with **Edit & Regenerate** instead.

Keep the app open in one browser tab while processing. This is a browser-managed queue, not a server worker that continues after closing the app. Queue metadata is stored separately for each v3 book at `ava-book-generation-queue-v3:<book-id>`. Reload pauses waiting jobs until **Resume waiting jobs** is clicked. A request interrupted by closing/reloading is marked separately and is never automatically replayed because it may already have used API credits; inspect saved results before choosing **Retry**. Completed images remain saved with the book. Browser storage failures halt dispatch before more requests start. Reset clears the current book’s queue as well as its v3 data.

## Feedback and partial image repairs

In Chapter Builder, choose an illustration version and unlock the page if necessary. Open **Give feedback & tweak part of the image**. Drag a rectangle over the area to change, or use **Select center area** and the Left/Top/Width/Height percentage fields. Enter feedback such as “Match Ava’s eyes and hair to her approved face sheet; keep the expression,” then click **Apply feedback to selected area**.

The original illustration is the first API input. The server creates a same-size PNG mask with a transparent editable rectangle; current approved character sheets and the selected illustration’s saved style guide the repair. The browser composites only the returned rectangle over the original image. Decoded pixels outside the selection are preserved; HTML story text is untouched. A hard selection edge can be visible, so choose an area that includes the feature and a little surrounding context. Partial edits count the original against the 16-image provider limit, leaving at most 15 additional references.

Each successful edit appends a version with its parent image/version, feedback, rectangle and reference manifest. Earlier illustrations remain selectable, and errors retain the original and entered feedback. Reload restores edit history. A locked page must be manually unlocked. Old illustrations without a saved recipe require full Edit & Regenerate once before partial repairs. **Try Again** on a repair repeats the same feedback on the same source image; a new partial edit uses the currently selected image as its source. No automatic paid retry occurs.

AI mask instructions are guidance rather than a guarantee of a perfect repair. Outside-region preservation is enforced by compositing, but the repaired face still needs visual review. Sample mode applies a local color tint to demonstrate selection/history; it does not understand feedback or fix facial identity. Provider mask tests and browser pixel tests use simulated responses and make no paid API requests.

## Validation

```sh
npm run typecheck
npm test
npm run build
npm run test:browser
```

Queue tests cover sequential dispatch, duplicate prevention, stop/retry, failed-page continuation, immutable snapshots, correct-page history, locked-page opt-in, reload recovery and storage failure. Browser queue tests hold a simulated request open while navigating, enqueueing and editing other pages. The tests also cover the complete workflow, image uploads, version selection, lock protection, reload persistence, PDF download/page dimensions and mobile error handling. API tests exercise the real OpenAI SDK request serialization with a simulated transport: text-only generation, multipart reference editing, upload/schema validation, duplicate-request protection and safe errors. Browser tests also exercise the AI client and real upload handler with a simulated provider, including reference ordering, retry recipe snapshots, generation history, persisted provider selection and failure without mock fallback. They make no paid API calls. Live OpenAI generation requires a usable credential and is not established by these simulated tests. Cloud tests use `/usr/bin/chromium`; elsewhere, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to your installed Chromium path or install Playwright Chromium with `npx playwright install chromium`.

## MVP limits

Sample mode demonstrates the workflow; it does not reproduce uploaded likenesses, obey scene content, or interpret uploaded styles. Photo drafting sends scene photos to OpenAI’s Responses API (`gpt-4.1-mini`, `store: false`) in a separate request, even when illustrations are set to sample artwork. It uses the same server-side key, requires access to that text/vision model, and incurs separate API usage. Analysis errors preserve photos and scene text; use **Draft scene from photos** to retry or write the scene manually. Removing a photo does not automatically rewrite text. Chapter-photo uploads draft only the current unlocked page; other pages can explicitly draft from shared chapter photos. AI illustrations send approved character and style references, never chapter/page scene photos. Source photos remain in browser storage; the application server does not persist uploads. Image generation follows reference guidance but cannot guarantee perfect likeness or character consistency. Built-in system fonts are supported; custom font upload is deferred. PDFs use 2400 × 2400 rasterized pages, so text is not selectable; there is no printer bleed or color-profile support. AI source images are 1024 × 1024 (128 source pixels per inch at 8 inches). Rendering the PDF at 300 DPI does not create new image detail; inspect the export before printing. Preview and export share the renderer. Oversized story text must be shortened or reduced in size before export.

One book lives in one browser profile on one device. Clearing browser data removes it. There is no project synchronization or backup feature. Removing a photo from a section removes its reference; unused blobs remain until project reset, avoiding accidental deletion of shared references.
