"use client";

import { Toaster } from "@/components/ui/sonner";
import { useMediaQuery } from "@/lib/use-media-query";

/** No celular o toast desce do topo-centro (o canto direito some atrás do dedo). */
export function ToasterResponsivo() {
  const celular = useMediaQuery("(max-width: 767px)");
  return <Toaster richColors position={celular ? "top-center" : "top-right"} />;
}
