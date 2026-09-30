import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Third Space — a little closer",
  description:
    "Your own cozy multiplayer place to hang out, leave ideas, and play together.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
