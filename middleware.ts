import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)

  const { pathname } = request.nextUrl

  // Public routes that don't require authentication
  const publicRoutes = ['/login', '/signup']
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route))

  // API routes that use their own auth (secret header) — bypass cookie auth.
  // Vercel cron sends `Authorization: Bearer $CRON_SECRET` and no session
  // cookie, so without these entries every scheduled run was 307'd to /login
  // before the route's own secret check could run. Each listed route MUST
  // authenticate itself and fail closed; add routes here explicitly, never by
  // a broad /api/ prefix.
  const SECRET_AUTH_API_PREFIXES = [
    '/api/brief/',               // JOURNAL_AUTO_SECRET
    '/api/cron/',                // CRON_SECRET (500 in prod if unset)
    '/api/tradovate/cron',       // CRON_SECRET (500 in prod if unset)
    '/api/claude/weekly-review', // CRON_SECRET + userId, else cookie session → 401
  ]
  const isPublicApiRoute = SECRET_AUTH_API_PREFIXES.some((p) => pathname.startsWith(p))

  // If user is not authenticated and trying to access a protected route
  if (!user && !isPublicRoute && !isPublicApiRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // If user is authenticated and trying to access auth pages, redirect to dashboard
  if (user && isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api routes that don't need auth check at middleware level
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
