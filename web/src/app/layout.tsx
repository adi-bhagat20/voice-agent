import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Call Me — Acuron AI Voice Demo",
  description:
    "Submit your name and phone number to receive a live AI voice call from Aria, Acuron AI's voice agent demo.",
  openGraph: {
    title: "Call Me — Acuron AI Voice Demo",
    description: "Experience a live AI voice call. Powered by LiveKit, Deepgram, Groq & Sarvam.",
    type: "website",
  },
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
