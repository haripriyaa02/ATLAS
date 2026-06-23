"use client";

import { useSession, signOut } from "@/lib/auth-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

export default function AuthNavbar() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleSignOut = async () => {
    await signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push("/");
        },
      },
    });
  };

  const toggleTheme = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  return (
    <nav className="navbar">
      <Link href="/" className="navbar-brand">
        <span className="logo-icon">🗺️</span>
        ATLAS
      </Link>
      <div className="navbar-links">
        {isPending ? null : session ? (
          <>
            {/* Logged in: Dashboard, Past Results, Segment (saves), Batch, Compare */}
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/results">Past Results</Link>
            <Link href="/segment">Segment</Link>
            <Link href="/video">Video</Link>
            <Link href="/batch">Batch</Link>
            <Link href="/compare">Compare</Link>
            <button onClick={handleSignOut} className="nav-signout-btn">
              Sign Out
            </button>
          </>
        ) : (
          <>
            {/* Guest: Home, Segment (no save), About, Sign In */}
            <Link href="/">Home</Link>
            <Link href="/segment">Segment</Link>
            <Link href="/about">About</Link>
            <Link href="/sign-in" className="nav-cta">
              Sign In
            </Link>
          </>
        )}
        
        {mounted && (
          <button
            onClick={toggleTheme}
            className="theme-toggle-btn"
            aria-label="Toggle Theme"
            style={{
              padding: "6px 12px",
              borderRadius: "12px",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid var(--border-color)",
              cursor: "pointer",
              fontSize: "1.2rem",
              marginLeft: "8px",
              transition: "all 0.3s ease"
            }}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        )}
      </div>
    </nav>
  );
}
