// Owner: B. Customer-facing frame. No internal navigation, no internal session.
// `.portal-theme` re-tokens primary and accents to a calm teal (globals.css).
export const metadata = { title: { default: "Customer Portal", template: "%s · DealFlow360 Portal" } };

export default function PortalRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="portal-theme min-h-dvh bg-background text-foreground">{children}</div>;
}
