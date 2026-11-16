import { forwardRef, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { digitsToBRL, parseBRL } from "@/lib/money";

type Props = {
  /** Valor em string com ponto decimal (ex: "12.50") ou vazio. */
  value: string;
  /** Recebe sempre uma string com ponto decimal compatível com Number(). Ex: "12.50" ou "". */
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  /** Mostra "R$" como prefixo visual dentro do input. Padrão: true. */
  showPrefix?: boolean;
  ariaLabel?: string;
};

/**
 * Campo de entrada monetária BRL com auto-preenchimento da vírgula.
 *
 * O usuário digita apenas dígitos; o componente preenche centavos automaticamente
 * e exibe no formato "R$ 1.234,56". O `onChange` emite uma string com ponto
 * decimal ("1234.56") para manter compatibilidade com o estado/SQL existentes.
 *
 * Aceita também colagem de valores como "1.234,56" ou "12,50".
 */
export const MoneyInput = forwardRef<HTMLInputElement, Props>(function MoneyInput(
  { value, onChange, placeholder = "0,00", disabled, className, id, showPrefix = true, ariaLabel },
  ref,
) {
  // Converte o valor externo (ponto decimal) em string de dígitos para reformatar.
  const display = useMemo(() => {
    if (value === "" || value == null) return "";
    const n = parseBRL(value);
    // Reusa o pipeline de centavos para exibir consistente: 12.5 → "1250" → "12,50".
    const cents = Math.round(n * 100).toString();
    return digitsToBRL(cents).display;
  }, [value]);

  const handleChange = (raw: string) => {
    // Mantém apenas os dígitos do que o usuário digitou.
    const digits = raw.replace(/\D/g, "");
    if (!digits) {
      onChange("");
      return;
    }
    const { value: num } = digitsToBRL(digits);
    // Emite com ponto decimal e 2 casas — compatível com `Number(state)` no submit.
    onChange(num.toFixed(2));
  };

  return (
    <div className="relative">
      {showPrefix && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground select-none">
          R$
        </span>
      )}
      <Input
        ref={ref}
        id={id}
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        value={display}
        onChange={(e) => handleChange(e.target.value)}
        className={cn(showPrefix && "pl-9 text-right", className)}
      />
    </div>
  );
});
