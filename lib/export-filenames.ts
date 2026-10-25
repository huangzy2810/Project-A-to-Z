export function safeBookFilename(title: string): string {
  const clean = title
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");
  let result = "",
    bytes = 0;
  const encoder = new TextEncoder();
  for (const character of clean) {
    const size = encoder.encode(character).length;
    if (bytes + size > 180) break;
    result += character;
    bytes += size;
  }
  return result.replace(/[. ]+$/g, "") || "Book";
}
export function jpegPageFilename(
  title: string,
  page: number,
  total: number,
): string {
  if (
    !Number.isInteger(page) ||
    !Number.isInteger(total) ||
    page < 1 ||
    page > total
  )
    throw new Error("Invalid export page number.");
  return `${safeBookFilename(title)} - Page ${String(page).padStart(String(total).length, "0")}.jpg`;
}
