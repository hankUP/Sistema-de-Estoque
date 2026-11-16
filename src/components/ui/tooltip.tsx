import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";

import { cn } from "@/lib/utils";

/**
 * Tooltip global do sistema.
 *
 * Decisões de robustez (corrigem cortes em cards/modais/tabelas):
 * - Renderização via Portal (escapa de overflow:hidden de containers pais).
 * - z-index altíssimo (z-[100]) para ficar acima de cards, modais e sticky headers.
 * - collisionPadding garante que o tooltip não encoste nas bordas da viewport;
 *   o Radix automaticamente reposiciona (flip) se não couber no lado preferido.
 * - max-width + whitespace-normal + break-words evitam tooltips em "linha única
 *   gigante" que estouram a tela.
 * - avoidCollisions e sticky="partial" mantêm o tooltip sempre visível.
 */

const TooltipProvider = ({
  delayDuration = 200,
  skipDelayDuration = 300,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider
    delayDuration={delayDuration}
    skipDelayDuration={skipDelayDuration}
    {...props}
  />
);

const Tooltip = TooltipPrimitive.Root;

const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipPortal = TooltipPrimitive.Portal;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(
  (
    {
      className,
      sideOffset = 6,
      collisionPadding = 8,
      avoidCollisions = true,
      sticky = "partial",
      ...props
    },
    ref,
  ) => (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        avoidCollisions={avoidCollisions}
        sticky={sticky}
        className={cn(
          // Layout/typography
          "z-[100] max-w-[min(20rem,calc(100vw-1rem))] whitespace-normal break-words",
          "rounded-md border border-border/60 bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-lg",
          // Animation
          "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  ),
);
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider, TooltipPortal };
