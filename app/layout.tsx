import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sälj-hjälparen",
  description: "Ta en bild, få ett pris och en färdig annons på sekunder.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="sv" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
