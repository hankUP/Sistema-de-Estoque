import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/db/client";

export type Fornecedor = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  whatsapp: string | null;
  observacoes: string | null;
  avaliacao: number | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
};

export function useFornecedores() {
  return useQuery({
    queryKey: ["fornecedores"],
    queryFn: async () => {
      const { data, error } = await db
        .from("fornecedores")
        .select("*")
        .order("nome");
      if (error) throw error;
      return data as Fornecedor[];
    },
  });
}

export function useCreateFornecedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (f: { nome: string; telefone?: string; email?: string; whatsapp?: string; observacoes?: string }) => {
      const { data, error } = await db.from("fornecedores").insert(f).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fornecedores"] }),
  });
}

export function useUpdateFornecedor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Fornecedor> & { id: string }) => {
      const { error } = await db.from("fornecedores").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fornecedores"] }),
  });
}
