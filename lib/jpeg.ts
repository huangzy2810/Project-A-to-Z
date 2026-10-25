import { Zip, ZipPassThrough } from "fflate";
import { preparePageExport, renderExportPage } from "./page-export";
import { jpegPageFilename, safeBookFilename } from "./export-filenames";
export async function exportJpegs(
  nodes: HTMLElement[],
  title: string,
  onProgress: (n: number) => void,
) {
  await preparePageExport(nodes);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const archive = new Zip((error, data) => {
    if (error) throw error;
    parts.push(Uint8Array.from(data));
  });
  try {
    for (let i = 0; i < nodes.length; i++) {
      const canvas = await renderExportPage(nodes[i], i + 1);
      try {
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (result) =>
              result
                ? resolve(result)
                : reject(new Error(`Could not encode page ${i + 1} as JPEG.`)),
            "image/jpeg",
            0.95,
          ),
        );
        const file = new ZipPassThrough(
          jpegPageFilename(title, i + 1, nodes.length),
        );
        archive.add(file);
        file.push(new Uint8Array(await blob.arrayBuffer()), true);
        onProgress(i + 1);
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }
    archive.end();
    const url = URL.createObjectURL(
      new Blob(parts, { type: "application/zip" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeBookFilename(title)} - JPEG Pages.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } finally {
    archive.terminate();
  }
}
