import { NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const sessionCookie =
    request.cookies.get("better-auth.session_token") ||
    request.cookies.get("__Secure-better-auth.session_token");

  // Protected routes — require auth: dashboard, results, batch, compare, video
  const protectedPaths = ["/dashboard", "/results", "/batch", "/compare", "/video"];
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));

  if (isProtected && !sessionCookie) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  // Redirect authenticated users away from auth pages
  if ((pathname === "/sign-in" || pathname === "/sign-up") && sessionCookie) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/results/:path*",
    "/batch/:path*",
    "/compare/:path*",
    "/video/:path*",
    "/sign-in",
    "/sign-up",
  ],
};
