import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/format";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  icon: Icon,
  variant = "secondary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn("button", `button--${variant}`, `button--${size}`, className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <LoaderCircle aria-hidden="true" className="button__spinner" size={16} />
      ) : Icon ? (
        <Icon aria-hidden="true" size={16} strokeWidth={2} />
      ) : null}
      {children}
    </button>
  );
}

