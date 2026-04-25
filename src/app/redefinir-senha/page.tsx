import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { RedefinirSenhaForm } from "./form";

export const dynamic = "force-dynamic";

export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/home");

  const { token } = await searchParams;
  if (!token) redirect("/esqueci-senha");

  return <RedefinirSenhaForm token={token} />;
}
