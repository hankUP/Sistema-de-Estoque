import { Star } from "lucide-react";

type Props = {
  value: number | null;
  onChange?: (value: number) => void;
  readonly?: boolean;
  size?: "sm" | "md";
};

export function StarRating({ value, onChange, readonly = false, size = "sm" }: Props) {
  const starSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(value === star ? 0 : star)}
          className={`p-0 ${readonly ? "cursor-default" : "cursor-pointer hover:scale-110"} transition-transform`}
          title={readonly ? `${value || 0}/5` : `Avaliar ${star}`}
        >
          <Star
            className={`${starSize} ${
              value && star <= value
                ? "fill-warning text-warning"
                : "text-muted-foreground/40"
            }`}
          />
        </button>
      ))}
    </div>
  );
}
