import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Product Hub — CSV Import & Product Management",
  description:
    "High-performance platform for bulk CSV product import, product CRUD management, and webhook configuration. Handle up to 500,000 products with real-time progress tracking.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
