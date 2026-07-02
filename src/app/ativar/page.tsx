import { AtivarClient } from "./ativar-client";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; payment_intent?: string }>;
}) {
  const sp = await searchParams;
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <AtivarClient sessionId={sp.session_id ?? ""} paymentIntentId={sp.payment_intent ?? ""} />
    </div>
  );
}
