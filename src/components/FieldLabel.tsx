import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface FieldLabelProps {
  label: string;
  required?: boolean;
  help?: string;
}

export function FieldLabel({ label, required, help }: FieldLabelProps) {
  return (
    <div className="flex items-center gap-1 mb-1">
      <span className="text-label">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </span>
      {help && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="inline-flex items-center justify-center rounded-full hover:bg-accent p-0.5">
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60 hover:text-foreground transition-colors" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs whitespace-pre-line">
            {help}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
