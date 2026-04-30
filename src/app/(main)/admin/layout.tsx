export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // Children manage their own scroll: pages that stack content can wrap their
  // root in `overflow-y-auto`; pages that need independent split-pane scroll
  // (e.g. samples master-detail) use `h-full flex` to fill the viewport.
  return <div className="h-full overflow-hidden p-6">{children}</div>;
}
