"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor, Palette } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const TEMAS = [
  { value: "system", label: "Sistema", icon: Monitor },
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
] as const;

export function PreferenciasCard() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Palette className="h-4 w-4" />
        </div>
        <CardTitle className="text-base">Preferências</CardTitle>
        <CardDescription>Tema e aparência da interface.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">Tema</p>
        <div className="flex gap-2">
          {TEMAS.map(({ value, label, icon: Icon }) => {
            const active = mounted && theme === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                className={cn(
                  "flex flex-1 flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-all",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
