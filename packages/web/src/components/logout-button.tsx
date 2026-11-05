"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useMessages } from "../lib/i18n/client";
import { Button } from "./ui";

/**
 * Salir. Like Entrar, it stays disabled from the tap until the page changes, so a second tap sends nothing; a logout
 * that fails gives the button back, saying so.
 */
export function LogoutButton() {
  const m = useMessages();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logOut() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(`The logout answered HTTP ${response.status}`);
      router.replace("/");
      router.refresh();
    } catch {
      setError(m.errors.generic);
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-2">
      <Button variant="secondary" disabled={busy} onClick={logOut}>
        {busy ? m.login.loggingOut : m.login.logOut}
      </Button>
      <p role="alert" className="text-sm text-owe">
        {error}
      </p>
    </div>
  );
}
