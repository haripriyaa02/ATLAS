import type { Metadata } from "next";
import "./globals.css";
import AuthNavbar from "./components/Navbar";
import { ThemeProvider } from "./components/ThemeProvider";
export const metadata: Metadata = {
  title: "ATLAS — Road Segmentation",
  description:
    "Adaptive Thresholding with Language-Augmented Sensing. AI-powered road segmentation using deep learning.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          themes={["light", "dark"]}
          disableTransitionOnChange
        >
          <AuthNavbar />
          <main>{children}</main>
          <Footer />
        </ThemeProvider>
      </body>
    </html>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <p className="footer-brand">🗺️ ATLAS — Mapping Roads with Intelligence</p>
      <p>
        Built by Divya R, Haripriya K &amp; Jaswanth Prasanna V &bull; Rajalakshmi Institute of Technology &bull; 2026
      </p>
    </footer>
  );
}
