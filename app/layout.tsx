import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Ava’s Shanghai Adventure · Book Creator",
  description: "A little adventure. A book to keep forever.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
