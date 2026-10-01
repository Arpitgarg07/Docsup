import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Docsup — Your family's documents, securely organized", description: "A private home for every family document." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
