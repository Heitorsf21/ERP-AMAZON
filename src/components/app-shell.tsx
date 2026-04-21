"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { CommandPaletteProvider } from "@/components/command-palette";

const BARE_PATHS = new Set<string>(["/login"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const bare = BARE_PATHS.has(pathname);

  if (bare) {
    return <>{children}</>;
  }

  return (
    <CommandPaletteProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <Topbar />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-6xl p-6 lg:p-8">{children}</div>
          </main>
        </div>
      </div>
    </CommandPaletteProvider>
  );
}
