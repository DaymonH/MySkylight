import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/invite/accept(.*)",
  "/api/webhooks/(.*)",
  "/api/health",
  // The PWA manifests. Browsers fetch `<link rel="manifest">` WITHOUT credentials, so
  // behind the login check they 404 and the app can never be installed ("Install app"
  // never appears). They hold only the app name, icons and start URL — nothing private.
  "/manifest.json",
  "/device-manifest.json",
])

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
