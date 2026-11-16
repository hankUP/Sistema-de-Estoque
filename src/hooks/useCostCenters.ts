import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/db/client";

export type CostCenter = {
  id: string;
  nome: string;
  tipo: "SETOR" | "PESSOA";
  descricao: string | null;
  ativo: boolean;
};

export function useCostCenters() {
  return useQuery({
    queryKey: ["centros_custo"],
    queryFn: async () => {
      const { data, error } = await db.from("centros_custo").select("*").order("nome");
      if (error) throw error;
      return data as CostCenter[];
    },
  });
}

export function useCreateCostCenter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (center: Pick<CostCenter, "nome" | "tipo" | "descricao">) => {
      const { error } = await db.from("centros_custo").insert(center);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["centros_custo"] }),
  });
}

export function useUpdateCostCenter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...changes }: Pick<CostCenter, "id"> & Partial<Pick<CostCenter, "nome" | "tipo" | "descricao" | "ativo">>) => {
      const { error } = await db.from("centros_custo").update(changes).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["centros_custo"] });
      queryClient.invalidateQueries({ queryKey: ["movements"] });
    },
  });
}
