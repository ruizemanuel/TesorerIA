"use client";

import { useRouter } from "next/navigation";
import { useMessages } from "../lib/i18n/client";
import { Button } from "./ui";

export function LogoutButton() {
  const m = useMessages();
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
      {m.login.logOut}
    </Button>
  );
}
