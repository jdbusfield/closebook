import type { Metadata, Viewport } from "next";
import { Archivo } from "next/font/google";

const archivo = Archivo({ subsets: ["latin"], weight: ["400", "600"], display: "swap" });

export const metadata: Metadata = {
  title: "Versatile Rewards",
  description: "Versatile Studios rewards: points, tier and perks.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RewardsPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${archivo.className} min-h-dvh bg-black text-white antialiased`}>
      <style>{"html,body{background:#000}"}</style>
      <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">{children}</div>
    </div>
  );
}
