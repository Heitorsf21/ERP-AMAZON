import { DefinirSenhaForm } from "./form";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; empresa?: string; email?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center" }}>
      <DefinirSenhaForm
        token={sp.token ?? ""}
        empresa={sp.empresa ?? ""}
        email={sp.email ?? ""}
      />
    </div>
  );
}
