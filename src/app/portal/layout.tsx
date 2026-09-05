// Owner: B. Customer-facing frame. No internal navigation, no internal session.
export const metadata = { title: { default: "Customer Portal", template: "%s · DealFlow360 Portal" } };

export default function PortalRootLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-background">{children}</div>;
}
