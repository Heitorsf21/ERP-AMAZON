"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

type Props = {
  children: React.ReactNode;
  label?: string;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Mantém o erro visível no console do browser para diagnóstico.
    // Em produção sem source maps detalhados, a stack vem minificada — o
    // nome do componente em info.componentStack ainda ajuda.
    console.error("[ErrorBoundary]", this.props.label ?? "", error);
    console.error("[ErrorBoundary] componentStack:", info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm dark:border-red-900/50 dark:bg-red-950/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-red-900 dark:text-red-200">
                Erro ao renderizar {this.props.label ?? "este bloco"}.
              </p>
              <p className="mt-1 text-red-700 dark:text-red-300">
                {this.state.error.message || "Erro desconhecido"}
              </p>
              <pre className="mt-3 max-h-48 overflow-auto rounded border border-red-200 bg-white p-2 text-[11px] text-red-900 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
                {this.state.error.stack ?? this.state.error.toString()}
              </pre>
              <button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="mt-3 inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
              >
                Tentar renderizar de novo
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
