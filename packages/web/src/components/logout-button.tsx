"use client";

import { useRouter } from "next/navigation";
import { Button } from "./ui";

export function LogoutButton() {
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/");
        router.refresh();
      }}
    >
      Salir
    </Button>
  );
}
