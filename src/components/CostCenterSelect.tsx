import { Link } from "react-router-dom";
import { useCostCenters } from "@/hooks/useCostCenters";

export function CostCenterSelect({ value, onChange, required = true, sectorOnly = false }: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  sectorOnly?: boolean;
}) {
  const { data: centers, isLoading } = useCostCenters();
  const available = centers?.filter((center) => center.ativo && (!sectorOnly || center.tipo === "SETOR")) ?? [];

  return (
    <div className="space-y-1">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={isLoading}
        className="bg-input border border-border rounded-lg px-3 h-10 text-sm text-foreground w-full"
      >
        <option value="">{sectorOnly ? "Selecione um setor..." : "Selecione um setor ou pessoa..."}</option>
        {available.map((center) => (
          <option key={center.id} value={center.id}>
            {center.nome} ({center.tipo === "SETOR" ? "setor" : "pessoa"}){center.ativo ? "" : " — inativo"}
          </option>
        ))}
      </select>
      {available.length === 0 && !isLoading && (
        <p className="text-xs text-muted-foreground">
          Cadastre um <Link to="/centros-de-custo" className="underline text-primary">centro de custo</Link> para identificar a movimentação.
        </p>
      )}
    </div>
  );
}
