import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "YT Auto — Pipeline Dashboard",
  description:
    "Monitor every Would You Rather Short from source row to YouTube upload.",
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
