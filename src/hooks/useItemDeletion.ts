import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/db/client";

/**
 * Resumo do impacto de excluir/desativar um item.
 * Usado pelo modal de confirmação para decidir entre exclusão definitiva
 * vs. desativação (soft-delete).
 */
export type ItemImpact = {
  itemId: string;
  itemNome: string;
  estoqueFisico: number;
  movimentacoes: number;
  bomComoComponente: number;
  bomComoPai: number;
  pedidosCompraAbertos: number;
  pedidosCompraTotal: number;
  ordensProducaoAbertas: number;
  ordensProducaoTotal: number;
  fornecedoresVinculados: number;
  reservas: number;
  /**
   * true quando o item nunca foi usado em lugar nenhum E não tem fornecedor
   * vinculado relevante. Apenas nesse caso a exclusão definitiva é segura.
   */
  podeExcluirDefinitivo: boolean;
  /**
   * true quando há vínculos ATIVOS que impedem até a exclusão definitiva
   * (BOM, pedido aberto, OP em aberto, fila, reserva).
   */
  bloqueiosAtivos: string[];
};

export function useItemImpact(itemId: string | null) {
  return useQuery({
    enabled: !!itemId,
    queryKey: ["item-impact", itemId],
    queryFn: async (): Promise<ItemImpact> => {
      const id = itemId!;

      const [itemRes, movsRes, bomCompRes, bomPaiRes, poRes, opRes, fornRes, reservRes] =
        await Promise.all([
          db.from("items").select("id, nome").eq("id", id).single(),
          db
            .from("movements")
            .select("quantidade", { count: "exact" })
            .eq("item_id", id),
          db
            .from("bom_items")
            .select("id, item_pai_id", { count: "exact" })
            .eq("item_componente_id", id),
          db
            .from("bom_items")
            .select("id", { count: "exact" })
            .eq("item_pai_id", id),
          db
            .from("purchase_orders")
            .select("status", { count: "exact" })
            .eq("item_id", id),
          db
            .from("production_orders")
            .select("status", { count: "exact" })
            .eq("item_id", id),
          db
            .from("item_fornecedores")
            .select("id", { count: "exact" })
            .eq("item_id", id),
          db
            .from("reservations")
            .select("quantidade", { count: "exact" })
            .eq("item_id", id),
        ]);

      if (itemRes.error) throw itemRes.error;

      const estoqueFisico = (movsRes.data || []).reduce(
        (s, m) => s + Number(m.quantidade || 0),
        0,
      );

      const pedidosAbertos = (poRes.data || []).filter(
        (p: any) =>
          !["RECEBIDO", "RECEBIDO_COMPLETO", "CANCELADO"].includes(String(p.status)),
      ).length;

      const opsAbertas = (opRes.data || []).filter((o: any) =>
        ["PLANEJADA", "EM_PRODUCAO", "A_IMPLANTAR"].includes(String(o.status)),
      ).length;

      const reservasQtd = (reservRes.data || []).reduce(
        (s, r) => s + Number(r.quantidade || 0),
        0,
      );

      const bloqueios: string[] = [];
      if ((bomCompRes.count || 0) > 0)
        bloqueios.push(`Componente em ${bomCompRes.count} estrutura(s) (BOM)`);
      if ((bomPaiRes.count || 0) > 0)
        bloqueios.push(`Produto pai em ${bomPaiRes.count} item(ns) de estrutura (BOM)`);
      if (pedidosAbertos > 0)
        bloqueios.push(`${pedidosAbertos} pedido(s) de compra em aberto`);
      if (opsAbertas > 0)
        bloqueios.push(`${opsAbertas} ordem(ns) de produção em aberto`);
      if (reservasQtd > 0)
        bloqueios.push(`${reservasQtd} unidade(s) reservada(s) em ordens de produção`);

      const totalUso =
        (movsRes.count || 0) +
        (bomCompRes.count || 0) +
        (bomPaiRes.count || 0) +
        (poRes.count || 0) +
        (opRes.count || 0) +
        (fornRes.count || 0) +
        (reservRes.count || 0);

      return {
        itemId: id,
        itemNome: itemRes.data!.nome as string,
        estoqueFisico,
        movimentacoes: movsRes.count || 0,
        bomComoComponente: bomCompRes.count || 0,
        bomComoPai: bomPaiRes.count || 0,
        pedidosCompraAbertos: pedidosAbertos,
        pedidosCompraTotal: poRes.count || 0,
        ordensProducaoAbertas: opsAbertas,
        ordensProducaoTotal: opRes.count || 0,
        fornecedoresVinculados: fornRes.count || 0,
        reservas: reservasQtd,
        bloqueiosAtivos: bloqueios,
        podeExcluirDefinitivo: totalUso === 0 && bloqueios.length === 0,
      };
    },
  });
}

/**
 * Desativa o item (soft-delete).
 * - Define ativo=false e deleted_at=now()
 * - Se zerarEstoque=true e houver estoque diferente de zero, cria
 *   movimentação AJUSTE_EXCLUSAO para zerar antes da desativação.
 * - Histórico, BOM, pedidos e produção permanecem intactos.
 */
export function useDeactivateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      itemId: string;
      zerarEstoque: boolean;
      estoqueAtual: number;
      centroCustoId?: string;
    }) => {
      const { itemId, zerarEstoque, estoqueAtual } = params;

      // Bloqueios ativos devem ser checados pela UI. Aqui só validamos pedido/OP em aberto.
      const [poOpen, opOpen, reservas] = await Promise.all([
        db
          .from("purchase_orders")
          .select("id, status")
          .eq("item_id", itemId)
          .not("status", "in", "(RECEBIDO,RECEBIDO_COMPLETO,CANCELADO)"),
        db
          .from("production_orders")
          .select("id, status")
          .eq("item_id", itemId)
          .in("status", ["PLANEJADA", "EM_PRODUCAO", "A_IMPLANTAR"]),
        db.from("reservations").select("id, quantidade").eq("item_id", itemId),
      ]);

      if (poOpen.error) throw poOpen.error;
      if (opOpen.error) throw opOpen.error;
      if (reservas.error) throw reservas.error;

      if ((poOpen.data?.length || 0) > 0) {
        throw new Error(
          "Não é possível desativar: existem pedidos de compra em aberto para este item. Cancele ou conclua os pedidos primeiro.",
        );
      }
      if ((opOpen.data?.length || 0) > 0) {
        throw new Error(
          "Não é possível desativar: existem ordens de produção em aberto que utilizam este item. Conclua, cancele ou remova as OPs primeiro.",
        );
      }

      // Zera estoque se solicitado
      if (zerarEstoque && estoqueAtual !== 0) {
        if (!params.centroCustoId) {
          throw new Error("Informe o centro de custo do ajuste de estoque.");
        }
        const ajuste = -estoqueAtual; // se positivo, sai; se negativo, entra
        const referencia =
          estoqueAtual > 0
            ? "Zeragem automática por desativação do item"
            : "Correção automática por desativação do item";
        const { error: movErr } = await db.from("movements").insert({
          item_id: itemId,
          tipo_movimentacao: "AJUSTE_EXCLUSAO" as any,
          quantidade: ajuste,
          referencia,
          centro_custo_id: params.centroCustoId,
        });
        if (movErr) throw movErr;
      }

      // Soft-delete
      const { error: upErr } = await db
        .from("items")
        .update({ ativo: false, deleted_at: new Date().toISOString() } as any)
        .eq("id", itemId);
      if (upErr) throw upErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
      qc.invalidateQueries({ queryKey: ["movements"] });
      qc.invalidateQueries({ queryKey: ["item-impact"] });
    },
  });
}

/**
 * Reativa um item desativado: ativo=true, deleted_at=null.
 * Estoque permanece como está (qualquer ajuste anterior continua válido).
 */
export function useReactivateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await db
        .from("items")
        .update({ ativo: true, deleted_at: null } as any)
        .eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
  });
}

/**
 * Exclusão DEFINITIVA — só deve ser chamada quando o item nunca foi usado.
 * Antes de deletar, remove vínculos seguros (item_fornecedores sem histórico,
 * item_fornecedor_precos só com origem CADASTRO sem pedido vinculado).
 */
export function useHardDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      // Validação final no servidor: se houver QUALQUER referência relevante, aborta.
      const [movs, bomA, bomB, po, op, reservas] = await Promise.all([
        db.from("movements").select("id", { count: "exact", head: true }).eq("item_id", itemId),
        db.from("bom_items").select("id", { count: "exact", head: true }).eq("item_componente_id", itemId),
        db.from("bom_items").select("id", { count: "exact", head: true }).eq("item_pai_id", itemId),
        db.from("purchase_orders").select("id", { count: "exact", head: true }).eq("item_id", itemId),
        db.from("production_orders").select("id", { count: "exact", head: true }).eq("item_id", itemId),
        db.from("reservations").select("id", { count: "exact", head: true }).eq("item_id", itemId),
      ]);

      const total =
        (movs.count || 0) +
        (bomA.count || 0) +
        (bomB.count || 0) +
        (po.count || 0) +
        (op.count || 0) +
        (reservas.count || 0);

      if (total > 0) {
        throw new Error(
          "Item possui histórico ou vínculos. Use a opção Desativar para preservar os dados.",
        );
      }

      // Remove vínculos cadastrais sem histórico
      await db.from("item_fornecedor_precos").delete().eq("item_id", itemId);
      await db.from("item_fornecedores").delete().eq("item_id", itemId);

      const { error } = await db.from("items").delete().eq("id", itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["stock"] });
    },
  });
}
