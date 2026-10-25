import { preparePageExport, renderExportPage } from "./page-export";
import { jsPDF } from "jspdf";
export async function exportPdf(
  nodes: HTMLElement[],
  title: string,
  onProgress: (n: number) => void,
) {
  await preparePageExport(nodes);
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "in",
    format: [8, 8],
    compress: true,
  });
  for (let i = 0; i < nodes.length; i++) {
    const canvas = await renderExportPage(nodes[i], i + 1);
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
