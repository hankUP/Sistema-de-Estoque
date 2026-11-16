import { cn } from "@/lib/utils";

type BrandMarkProps = {
  subtitle?: string;
  size?: "sm" | "lg";
  className?: string;
};

/** Assinatura visual Gravae: símbolo vermelho + nome em caixa alta. */
export function BrandMark({ subtitle = "Gestão de Operações", size = "sm", className }: BrandMarkProps) {
  const large = size === "lg";
  return (
    <div className={cn("flex items-center gap-3 min-w-0", className)}>
      <div
        className={cn(
          "flex items-center justify-center shrink-0 rounded-lg bg-primary text-primary-foreground font-black shadow-lg shadow-primary/25",
          large ? "h-12 w-12 text-2xl" : "h-9 w-9 text-lg",
        )}
        aria-hidden
      >
        G
      </div>
      <div className="flex flex-col min-w-0">
        <span
          className={cn(
            "font-extrabold uppercase tracking-[0.18em] text-foreground leading-none",
            large ? "text-xl" : "text-[15px]",
          )}
        >
          Gravae
        </span>
        {subtitle && (
          <span className={cn("text-muted-foreground mt-1 leading-tight truncate", large ? "text-sm" : "text-[11px]")}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
}
