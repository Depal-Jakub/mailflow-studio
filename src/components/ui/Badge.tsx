import type { ReactNode } from "react";
import { cn } from "../../lib/format";

export function Badge({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "teal";
  dot?: boolean;
}) {
  return (
    <span className={cn("badge", `badge--${tone}`)}>
      {dot ? <span className="badge__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

