"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

function friendly(message: string): string {
  if (
    /fetch failed|failed to fetch|AuthRetryable|network|timeout|ECONN|ENOTFOUND/i.test(
      message,
    )
  ) {
    return "Não foi possível conectar ao servidor de autenticação. Atualize a página ou tente entrar de novo em alguns segundos.";
  }
  return "Algo deu errado. Tente novamente.";
}

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error]", error.message);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm text-muted-foreground" role="alert">
        {friendly(error.message || "")}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={() => reset()}>
          Tentar de novo
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            window.location.href = "/login";
          }}
        >
          Ir para entrar
        </Button>
      </div>
    </div>
  );
}
