"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const router = useRouter();

  useEffect(() => {
    // Open cmdk in settings mode, then redirect away
    window.dispatchEvent(new CustomEvent("open-cmdk-mode", { detail: "settings" }));
    router.replace("/dashboard");
  }, [router]);

  return null;
}
