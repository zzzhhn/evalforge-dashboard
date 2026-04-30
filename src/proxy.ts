import { NextResponse, type NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth";

const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get("auth-token")?.value;
  const isApiRoute = pathname.startsWith("/api/");

  if (!token) {
    if (isApiRoute) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const session = await verifyToken(token);
  if (!session) {
    const response = isApiRoute
      ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("auth-token");
    return response;
  }

  // Admin-only routes. We let ANNOTATOR through at the proxy layer because
  // a Group Admin is an annotator with GroupMembership.isAdmin=true; the
  // per-page `getAdminScope` redirects them back to /tasks if they turn
  // out not to admin any group. The proxy runs in Edge runtime and cannot
  // safely hit Prisma, so the finer check lives in the pages.
  if (pathname.startsWith("/admin")) {
    const allowedRoles = ["ADMIN", "RESEARCHER", "ANNOTATOR", "VENDOR_ANNOTATOR"];
    if (!allowedRoles.includes(session.role)) {
      if (isApiRoute) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/tasks", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|public).*)",
  ],
};
