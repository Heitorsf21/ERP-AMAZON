import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-redirect";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const destino = safeNextPath(next);
  const session = await getSession();
  if (session) {
    redirect(destino);
  }

  return <LoginForm nextPath={destino === "/home" ? undefined : destino} />;
}
