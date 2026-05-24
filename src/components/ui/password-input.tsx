"use client";

import * as React from "react";
import { Check, Eye, EyeOff, Lock, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  PASSWORD_POLICY_MIN_LENGTH,
  evaluatePassword,
  type PasswordChecks,
} from "@/lib/password-policy";

type Props = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
  showRequirements?: boolean;
  placeholder?: string;
};

/**
 * Input de senha com toggle de visibilidade e indicador de requisitos.
 * As regras espelham `strongPasswordSchema` em lib/password-policy.ts
 * (backend continua sendo a fonte de verdade — esse componente so antecipa
 * o erro no client).
 */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete = "new-password",
  required = true,
  disabled = false,
  showRequirements = true,
  placeholder = "••••••••••••",
}: Props) {
  const [mostrar, setMostrar] = React.useState(false);
  const checks = evaluatePassword(value);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          type={mostrar ? "text" : "password"}
          autoComplete={autoComplete}
          className="pl-9 pr-10"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          minLength={PASSWORD_POLICY_MIN_LENGTH}
          required={required}
          disabled={disabled}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={() => setMostrar((v) => !v)}
          tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition hover:text-foreground"
          aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}
        >
          {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>

      {showRequirements ? <Requirements checks={checks} /> : null}
    </div>
  );
}

function Requirements({ checks }: { checks: PasswordChecks }) {
  return (
    <ul className="grid gap-1 text-xs sm:grid-cols-2">
      <Rule ok={checks.minLength}>
        Mínimo de {PASSWORD_POLICY_MIN_LENGTH} caracteres
      </Rule>
      <Rule ok={checks.hasUppercase}>Letra maiúscula</Rule>
      <Rule ok={checks.hasLowercase}>Letra minúscula</Rule>
      <Rule ok={checks.hasDigit}>Número</Rule>
      <Rule ok={checks.hasSpecial}>Caractere especial</Rule>
    </ul>
  );
}

function Rule({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li
      className={cn(
        "flex items-center gap-1.5",
        ok ? "text-emerald-600" : "text-muted-foreground",
      )}
    >
      {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      <span>{children}</span>
    </li>
  );
}
