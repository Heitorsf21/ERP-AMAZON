"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  iniciais: string;
  temAvatar: boolean;
};

export function UploadAvatar({ iniciais, temAvatar }: Props) {
  const qc = useQueryClient();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [cacheBust, setCacheBust] = React.useState(() => Date.now());
  const [show, setShow] = React.useState(temAvatar);

  React.useEffect(() => {
    setShow(temAvatar);
  }, [temAvatar]);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/perfil/avatar", { method: "POST", body: fd });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.erro ?? "Erro no upload");
      }
      return r.json();
    },
    onSuccess: () => {
      setShow(true);
      setCacheBust(Date.now());
      qc.invalidateQueries({ queryKey: ["auth-me"] });
      toast.success("Avatar atualizado");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const remover = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/perfil/avatar", { method: "DELETE" });
      if (!r.ok) throw new Error("Erro ao remover");
    },
    onSuccess: () => {
      setShow(false);
      qc.invalidateQueries({ queryKey: ["auth-me"] });
      toast.success("Avatar removido");
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const src = show ? `/api/perfil/avatar?v=${cacheBust}` : null;

  return (
    <div className="flex items-center gap-4">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt="Avatar"
          className="h-20 w-20 rounded-2xl border bg-white object-cover"
        />
      ) : (
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-2xl font-semibold text-primary-foreground shadow-sm ring-2 ring-background">
          {iniciais}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={upload.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          {upload.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
          )}
          {upload.isPending
            ? "Enviando…"
            : show
              ? "Trocar foto"
              : "Carregar foto"}
        </Button>
        {show && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={remover.isPending}
            onClick={() => remover.mutate()}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Remover
          </Button>
        )}
        <p className="text-[11px] text-muted-foreground">
          JPG / PNG / WEBP, até 5MB.
        </p>
      </div>
    </div>
  );
}
