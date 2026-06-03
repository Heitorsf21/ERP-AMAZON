"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { LogOut, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PlataformaTopbar() {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    setSaindo(true);
    await fetch("/api/plataforma/logout", { method: "POST" }).catch(() => {});
    router.push("/plataforma/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-2.5">
          <Image
            src="/atlas-symbol.png"
            alt="Atlas Seller"
            width={28}
            height={28}
            priority
            className="shrink-0 object-contain"
            style={{ height: 28, width: 28 }}
          />
          <div className="leading-none">
            <p className="text-sm font-semibold tracking-tight">Atlas Seller</p>
            <p className="text-[11px] text-muted-foreground">Console da plataforma</p>
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={sair} disabled={saindo}>
          {saindo ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="mr-2 h-4 w-4" />
          )}
          Sair
        </Button>
      </div>
    </header>
  );
}
