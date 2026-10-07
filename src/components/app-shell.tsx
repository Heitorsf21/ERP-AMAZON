"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { CommandPaletteProvider } from "@/components/command-palette";
import { BottomNav } from "@/components/mobile/bottom-nav";

const BARE_PATHS = new Set<string>(["/login"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = BARE_PATHS.has(pathname);

  if (bare) {
    return <>{children}</>;
  }

  return (
    <CommandPaletteProvider>
      <div className="flex h-dvh overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto max-w-6xl px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-6 lg:p-8">
              {children}
            </div>
          </main>
        </div>
      </div>
      <BottomNav />
    </CommandPaletteProvider>
  );
}
