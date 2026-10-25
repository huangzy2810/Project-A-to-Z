import { toCanvas } from "html-to-image";
export async function preparePageExport(nodes: HTMLElement[]) {
  if (!nodes.length) throw new Error("There are no book pages to export.");
  await document.fonts.ready;
  const deadline = Date.now() + 10000;
  while (nodes.some((node) => node.querySelector(".asset-pending"))) {
    if (Date.now() > deadline)
      throw new Error(
        "Images are taking too long to load. Please try exporting again.",
      );
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (nodes.some((node) => node.querySelector(".asset-error")))
    throw new Error(
      "A book image is missing. Please upload it again before exporting.",
    );
}
export async function renderExportPage(
  node: HTMLElement,
  pageNumber: number,
): Promise<HTMLCanvasElement> {
  const copy = node.querySelector<HTMLElement>(".story-copy");
  if (copy && copy.scrollHeight > copy.clientHeight + 2)
    throw new Error(
      `Page ${pageNumber} has more text than fits. Shorten the text or reduce the story font size before exporting.`,
    );
  await Promise.all(
    Array.from(node.querySelectorAll("img")).map((image) => image.decode()),
  );
  return toCanvas(node, {
    width: 600,
    height: 600,
    pixelRatio: 4,
    backgroundColor: "#fffaf0",
    cacheBust: false,
  });
}
