import type { Page } from "@playwright/test";
import type { BookProject } from "../../lib/model";
export async function readSavedProject(page: Page): Promise<BookProject> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("ava-book-data-v3", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const r = db
          .transaction("records")
          .objectStore("records")
          .get("ava-book-project-v3");
        r.onsuccess = () => resolve(r.result ? JSON.parse(r.result) : null);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}
