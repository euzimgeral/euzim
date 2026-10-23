"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

function friendly(message: string): string {
  if (
    /fetch failed|failed to fetch|AuthRetryable|network|timeout|ECONN|ENOTFOUND/i.test(
      message,
    )
  ) {
    return "Falha temporária de conexão. Seus dados locais estão ok — atualize ou volte a entrar.";
  }
  return "Não foi possível carregar esta tela. Tente de novo.";
}

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-shell-error]", error.message);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[40vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm text-muted-foreground" role="alert">
        {friendly(error.message || "")}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={() => reset()}>
          Recarregar
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            window.location.href = "/app";
          }}
        >
          Ir ao início
        </Button>
      </div>
    </div>
  );
}
