import type { Metadata } from "next";
import "@/.marketing-redesign/design.css";

export const metadata: Metadata = {
  title: {
    default: "Novastar · A new beginning",
    template: "%s · Novastar preview",
  },
  description: "A private design preview for Novastar Montessori School.",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    googleBot: { index: false, follow: false, noimageindex: true },
  },
  alternates: { canonical: null },
};

export const dynamic = "force-dynamic";

export default function PreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="ns-preview">{children}</div>;
}
