import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "ERP AMAZON",
  description: "Sistema interno de gestão (caixa, contas, estoque, compras).",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
          <Toaster richColors position="top-right" />
        </Providers>
      </body>
    </html>
  );
}
