// Without this, every `/app/family/<id>/*` page is rendered by a serverless
// function on every visit (a billed invocation, and a cold start in front of the
// page). An empty `generateStaticParams` opts the segment into static
// generation: each family's pages are rendered once, on first request, and then
// served from cache. The pages are client components that fetch their own data,
// so nothing family-specific is baked into the HTML.
export function generateStaticParams() {
  return []
}

export default function FamilyLayout({ children }: { children: React.ReactNode }) {
  return children
}
