import { toCanvas } from "html-to-image";
import { jsPDF } from "jspdf";
export async function exportPdf(
  nodes: HTMLElement[],
  title: string,
  onProgress: (n: number) => void,
) {
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
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "in",
    format: [8, 8],
    compress: true,
  });
  for (let i = 0; i < nodes.length; i++) {
    const copy = nodes[i].querySelector<HTMLElement>(".story-copy");
    if (copy && copy.scrollHeight > copy.clientHeight + 2)
      throw new Error(
        `Page ${i + 1} has more text than fits. Shorten the text or reduce the story font size before exporting.`,
      );
    const images = Array.from(nodes[i].querySelectorAll("img"));
    await Promise.all(images.map((img) => img.decode()));
    const canvas = await toCanvas(nodes[i], {
      width: 600,
      height: 600,
      pixelRatio: 4,
      backgroundColor: "#fffaf0",
      cacheBust: false,
    });
    if (i) pdf.addPage([8, 8], "portrait");
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 8, 8);
    onProgress(i + 1);
  }
  pdf.save(
    `${
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "avas-shanghai-adventure"
    }.pdf`,
  );
}
