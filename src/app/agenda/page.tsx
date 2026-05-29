import type { Metadata } from "next";
import { AgendaView } from "@/components/agenda/agenda-view";

export const metadata: Metadata = {
  title: "Agenda · Atlas Seller",
};

export default function AgendaPage() {
  return <AgendaView />;
}
