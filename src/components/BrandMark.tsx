import { cn } from "@/lib/utils";

type BrandMarkProps = {
  subtitle?: string;
  size?: "sm" | "lg";
  className?: string;
};

/** Logo oficial Gravae (letras brancas: usar sobre fundo escuro) com subtítulo opcional. */
export function BrandMark({ subtitle = "Gestão de Operações", size = "sm", className }: BrandMarkProps) {
  const large = size === "lg";
  return (
    <div className={cn("flex flex-col min-w-0", className)}>
      <img
        src="/logo-gravae.png"
        alt="Gravae"
        width={282}
        height={107}
        className={cn("w-auto self-start select-none", large ? "h-14" : "h-8")}
        draggable={false}
      />
      {subtitle && (
        <span className={cn("text-muted-foreground leading-tight truncate", large ? "mt-2 text-sm" : "mt-1 text-[11px]")}>
          {subtitle}
        </span>
      )}
    </div>
  );
}
