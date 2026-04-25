"use client";

import { HardDrive, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function DriveSection() {
  return (
    <Card className="opacity-95">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-base">Google Drive — NF-e Automatico</CardTitle>
              <CardDescription>
                Importacao automatica de notas fiscais e XMLs salvos numa pasta do Drive.
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline">Em breve</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5 text-foreground/80">
            <FileText className="h-3.5 w-3.5" />
            Funcionalidade em desenvolvimento.
          </p>
          <p className="mt-1 leading-relaxed">
            Quando habilitada, o ERP varrera periodicamente uma pasta do Drive,
            importara XMLs de NF-e e PDFs de notas, criando dossies financeiros
            automaticamente. Reutilizara o mesmo padrao OAuth do Gmail.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="drive-folder">ID da pasta no Drive</Label>
          <Input
            id="drive-folder"
            placeholder="1AbC...XyZ"
            disabled
          />
        </div>

        <Button disabled variant="outline">
          Conectar Drive (em breve)
        </Button>
      </CardContent>
    </Card>
  );
}
