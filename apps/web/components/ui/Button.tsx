import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "brand" | "secondary" | "outline" | "danger";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "border-2 border-charcoal bg-charcoal text-brand-foreground shadow-none hover:border-primary-dark hover:bg-primary-dark",
  brand: "pill-gradient bg-brand text-brand-foreground shadow-blue-pill hover:bg-brand-dark",
  secondary: "pill-gradient bg-brand-soft text-brand shadow-blue-pill hover:bg-brand/10",
  outline: "border-2 border-border bg-background text-foreground shadow-soft hover:bg-muted",
  danger: "border-2 border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-5 py-2.5 text-sm",
  lg: "px-6 py-3 text-base",
};

const baseClassName =
  "inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 font-semibold outline-none transition-[color,background-color,border-color,box-shadow,opacity] focus-visible:ring-2 focus-visible:ring-charcoal focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100";

function getButtonClassName(
  variant: ButtonVariant,
  size: ButtonSize,
  className?: string,
  options?: { motion?: boolean },
) {
  return cn(
    baseClassName,
    !options?.motion && "active:scale-[0.97]",
    variantStyles[variant],
    sizeStyles[size],
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, children, ...props },
  ref,
) {
  return (
    <button ref={ref} className={getButtonClassName(variant, size, className)} {...props}>
      {children}
    </button>
  );
});

type MotionButtonProps = Omit<ButtonProps, "onDrag" | "onDragStart" | "onDragEnd"> &
  Pick<HTMLMotionProps<"button">, "whileHover" | "whileTap">;

export const MotionButton = motion.create(
  forwardRef<HTMLButtonElement, ButtonProps>(function MotionButton(
    { variant = "primary", size = "md", className, children, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={getButtonClassName(variant, size, className, { motion: true })}
        {...props}
      >
        {children}
      </button>
    );
  }),
);

export type { MotionButtonProps };
