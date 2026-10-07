"use client";
import { useEffect, useState } from "react";
import { getAsset } from "@/lib/storage";
import { BookProject, Typography, StoryPage } from "@/lib/model";
export function AssetImage({
  id,
  alt = "",
  style,
  className,
}: {
  id?: string;
  alt?: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let local = "";
    setUrl("");
    setFailed(false);
    if (id)
      getAsset(id)
        .then((b) => {
          local = URL.createObjectURL(b);
          if (alive) setUrl(local);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    return () => {
      alive = false;
      if (local) URL.revokeObjectURL(local);
    };
  }, [id]);
  return url ? (
    <img src={url} alt={alt} style={style} className={className} />
  ) : failed ? (
    <span className="asset-error" role="alert">
      Image unavailable — upload it again.
    </span>
  ) : id ? (
    <span className="asset-pending" aria-label="Loading image" />
  ) : null;
}
export interface RenderPage {
  id: string;
  kind: "cover" | "story" | "letter" | "memories";
  title?: string;
  text?: string;
  image?: string;
  photos?: BookProject["photoMemories"];
  typography?: Typography;
  editStep: number;
  pageId?: string;
}
export function orderedPages(p: BookProject): RenderPage[] {
  return [
    {
      id: "cover",
      kind: "cover",
      title: p.title,
      text: p.settings.subtitle,
      editStep: 0,
    },
    ...p.chapters.flatMap((c) =>
      c.pages.map((s: StoryPage) => ({
        id: s.id,
        kind: "story" as const,
        title: c.title,
        text: s.storyText,
        image: s.illustrationVersions.find(
          (v) => v.id === s.selectedIllustrationId,
        )?.image,
        typography: s.lockedTypography,
        editStep: 4,
        pageId: s.id,
      })),
    ),
    {
      id: "letter",
      kind: "letter",
      title: p.closingMessage.heading,
      text: [
        p.closingMessage.message,
        p.closingMessage.signature,
        p.closingMessage.date,
      ]
        .filter(Boolean)
        .join("\n\n"),
      image: p.closingMessage.photo,
      editStep: 5,
    },
    ...Array.from(
      {
        length: Math.ceil(
          p.photoMemories.length / p.exportSettings.memoryLayout,
        ),
      },
      (_, i) => ({
        id: `memories-${i}`,
        kind: "memories" as const,
        title: "Our Shanghai Memories",
        photos: p.photoMemories.slice(
          i * p.exportSettings.memoryLayout,
          (i + 1) * p.exportSettings.memoryLayout,
        ),
        editStep: 6,
      }),
    ),
  ];
}
export function BookPage({
  project,
  page,
  editing = false,
}: {
  project: BookProject;
  page: RenderPage;
  editing?: boolean;
}) {
  const t = page.typography || project.typography;
  return (
    <div
      className={`book-page ${page.kind} ${editing ? "editing" : ""}`}
      style={{
        color: t.textColor,
        fontFamily: t.bodyFont,
        textAlign: t.alignment,
      }}
    >
      {page.kind === "cover" ? (
        <>
          <div className="cover-border">
            <span className="cover-small">A STORY TO KEEP FOREVER</span>
            <div className="cover-art">
              <span className="sun" />
              <i className="tower t1" />
              <i className="tower t2" />
              <i className="tower t3" />
              <span className="river" />
              <span className="boat">⌁</span>
            </div>
            <h2
              style={{
                fontFamily: t.headingFont,
                fontSize: `${(t.headingSize * 1.3) / 6}cqw`,
              }}
            >
              {page.title}
            </h2>
            <p>{page.text}</p>
            <span className="cover-small">SHANGHAI · OUR FAMILY STORY</span>
          </div>
        </>
      ) : page.kind === "memories" ? (
        <>
          <h3
            style={{
              fontFamily: t.headingFont,
              fontSize: `${t.headingSize / 6}cqw`,
            }}
          >
            {page.title}
          </h3>
          <div className={`memory-grid count-${page.photos?.length}`}>
            {page.photos?.map((photo) => (
              <figure key={photo.id}>
                <AssetImage
                  id={photo.image}
                  alt={photo.caption || "Family memory"}
                  style={{ objectPosition: `50% ${photo.position}%` }}
                />
                <figcaption>{photo.caption}</figcaption>
              </figure>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className={`page-art ${t.defaultTextPosition}`}>
            {page.image ? (
              <AssetImage
                id={page.image}
                alt={
                  page.kind === "letter"
                    ? "Family photograph"
                    : "Story illustration"
                }
              />
            ) : (
              <div className="art-empty">
                <span>✦</span>
                <p>
                  {page.kind === "letter"
                    ? "A letter to remember"
                    : "Your illustration will appear here"}
                </p>
              </div>
            )}
          </div>
          <div
            className={`story-copy ${page.kind === "letter" ? "letter-copy" : t.defaultTextPosition}`}
            style={{
              fontSize: `${t.bodySize / 6}cqw`,
              lineHeight: t.lineHeight,
              padding: `${(project.exportSettings.safeMargin / 8) * 100}%`,
            }}
          >
            {page.kind === "letter" && (
              <h3
                style={{
                  fontFamily: t.headingFont,
                  fontSize: `${t.headingSize / 6}cqw`,
                }}
              >
                {page.title}
              </h3>
            )}
            <p>{page.text || "Every little adventure begins with a story…"}</p>
          </div>
        </>
      )}
    </div>
  );
}
