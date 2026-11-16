import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, Upload, FileSpreadsheet, CheckCircle2, AlertCircle } from "lucide-react";
import { db } from "@/db/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { calcSuggestions } from "@/components/ItemFormFields";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ParsedRow = {
  nome: string;
  tipo: "MP" | "SUB" | "PF";
  unidade: string;
  consumo_diario: number;
  estoque_minimo: number;
  estoque_ideal: number;
  estoque_maximo: number;
  lead_time_dias: number;
  custo_unitario: number;
};

type RowResult = {
  linha: number;
  nome: string;
  status: "ok" | "erro";
  mensagem?: string;
};

const SUPPORTED_FORMATS = ".xlsx, .xls, .csv, .ods";

const HELP_TEXT = `Formatos suportados: Excel (.xlsx, .xls), CSV (.csv) e OpenDocument (.ods).

A primeira linha da planilha deve conter os nomes das colunas (cabeçalho).

Colunas reconhecidas (use exatamente estes nomes):
• nome (obrigatório) — Nome do item
• tipo — MP, SUB ou PF (padrão: MP)
• unidade — Unidade de medida, ex: un, kg, m (padrão: un)
• consumo_diario — Consumo médio por dia (padrão: 0)
• estoque_minimo — Estoque mínimo (padrão: 0)
• estoque_ideal — Estoque ideal (padrão: 0)
• estoque_maximo — Estoque máximo (padrão: 0)
• lead_time_dias — Lead time em dias (padrão: 0)
• custo_unitario — Custo unitário de referência (padrão: 0)

Valores numéricos podem usar vírgula ou ponto como separador decimal.`;

function normalizeNumber(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTipo(v: any): "MP" | "SUB" | "PF" {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "SUB" || s === "PF" || s === "MP") return s;
  return "MP";
}

function parseRows(rows: any[]): { parsed: ParsedRow[]; errors: RowResult[] } {
  const parsed: ParsedRow[] = [];
  const errors: RowResult[] = [];
  rows.forEach((raw, idx) => {
    const linha = idx + 2; // +1 header, +1 1-based
    const nome = String(raw.nome ?? raw.Nome ?? raw.NOME ?? "").trim();
    if (!nome) {
      errors.push({ linha, nome: "(vazio)", status: "erro", mensagem: "Coluna 'nome' obrigatória" });
      return;
    }

    // Detecta se o campo está ausente/vazio na planilha (para aplicar sugestão sem sobrescrever valor real do usuário, inclusive 0 explícito)
    const isBlank = (v: any) => v === undefined || v === null || String(v).trim() === "";
    const rawMin = raw.estoque_minimo ?? raw["Estoque Mínimo"];
    const rawIdeal = raw.estoque_ideal ?? raw["Estoque Ideal"];
    const rawMax = raw.estoque_maximo ?? raw["Estoque Máximo"];

    const consumo_diario = normalizeNumber(raw.consumo_diario ?? raw["Consumo Diário"]);
    const lead_time_dias = Math.round(normalizeNumber(raw.lead_time_dias ?? raw["Lead Time"]));

    let estoque_minimo = normalizeNumber(rawMin);
    let estoque_ideal = normalizeNumber(rawIdeal);
    let estoque_maximo = normalizeNumber(rawMax);

    // Replica o comportamento do formulário manual: preenche sugestões quando há base e o campo veio vazio
    if (consumo_diario > 0 && lead_time_dias > 0) {
      const s = calcSuggestions(consumo_diario, lead_time_dias);
      if (isBlank(rawMin)) estoque_minimo = s.min;
      if (isBlank(rawIdeal)) estoque_ideal = s.ideal;
      if (isBlank(rawMax)) estoque_maximo = s.max;
    }

    parsed.push({
      nome,
      tipo: normalizeTipo(raw.tipo ?? raw.Tipo ?? raw.TIPO),
      unidade: String(raw.unidade ?? raw.Unidade ?? "un").trim() || "un",
      consumo_diario,
      estoque_minimo,
      estoque_ideal,
      estoque_maximo,
      lead_time_dias,
      custo_unitario: normalizeNumber(raw.custo_unitario ?? raw["Custo Unitário"]),
    });
  });
  return { parsed, errors };
}

export function ImportItemsDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ParsedRow[]>([]);
  const [parseErrors, setParseErrors] = useState<RowResult[]>([]);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<RowResult[] | null>(null);

  const reset = () => {
    setFileName(null);
    setPreview([]);
    setParseErrors([]);
    setResults(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    try {
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Arquivo muito grande. Limite: 5 MB.");
        return;
      }
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });
      const { parsed, errors } = parseRows(rows);
      setFileName(file.name);
      setPreview(parsed);
      setParseErrors(errors);
      setResults(null);
      if (parsed.length === 0 && errors.length === 0) {
        toast.error("Planilha vazia ou sem dados reconhecidos.");
      }
    } catch (e: any) {
      toast.error("Não foi possível ler o arquivo: " + e.message);
    }
  };

  const handleImport = async () => {
    if (preview.length === 0) return;
    setImporting(true);
    const rowResults: RowResult[] = [...parseErrors];
    for (let i = 0; i < preview.length; i++) {
      const row = preview[i];
      const { error } = await db.from("items").insert(row);
      rowResults.push({
        linha: i + 2,
        nome: row.nome,
        status: error ? "erro" : "ok",
        mensagem: error?.message,
      });
    }
    const okCount = rowResults.filter((r) => r.status === "ok").length;
    const errCount = rowResults.filter((r) => r.status === "erro").length;
    setResults(rowResults);
    setImporting(false);
    qc.invalidateQueries({ queryKey: ["items"] });
    if (errCount === 0) toast.success(`${okCount} itens importados com sucesso!`);
    else toast.warning(`${okCount} importados, ${errCount} com erro.`);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Importar Itens de Planilha</DialogTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="inline-flex items-center justify-center rounded-full hover:bg-accent p-0.5">
                  <HelpCircle className="h-4 w-4 text-muted-foreground/70 hover:text-foreground transition-colors" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-md text-xs whitespace-pre-line">
                {HELP_TEXT}
              </TooltipContent>
            </Tooltip>
          </div>
          <DialogDescription>
            Envie um arquivo Excel, CSV ou ODS para cadastrar vários itens de uma vez. Passe o mouse no ícone de ajuda para ver os campos suportados.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          <div className="border-2 border-dashed border-border rounded-lg p-6 text-center">
            <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground mb-3">
              {fileName ? `Arquivo selecionado: ${fileName}` : "Selecione um arquivo de planilha"}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept={SUPPORTED_FORMATS}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} className="gap-1.5">
              <Upload className="h-3.5 w-3.5" /> Escolher arquivo
            </Button>
            <p className="text-xs text-muted-foreground mt-2">Formatos suportados: {SUPPORTED_FORMATS}</p>
          </div>

          {parseErrors.length > 0 && !results && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-1">
              <p className="font-medium text-destructive">{parseErrors.length} linha(s) com problema:</p>
              {parseErrors.slice(0, 5).map((e, i) => (
                <p key={i}>Linha {e.linha}: {e.mensagem}</p>
              ))}
            </div>
          )}

          {preview.length > 0 && !results && (
            <div className="border rounded-md">
              <div className="p-3 border-b bg-muted/30 text-xs font-medium">
                Pré-visualização: {preview.length} item(ns) prontos para importar
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/20 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Nome</th>
                      <th className="text-left p-2">Tipo</th>
                      <th className="text-left p-2">Unidade</th>
                      <th className="text-right p-2">Custo</th>
                      <th className="text-right p-2">Est. Mín.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(0, 50).map((r, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{r.nome}</td>
                        <td className="p-2">{r.tipo}</td>
                        <td className="p-2">{r.unidade}</td>
                        <td className="p-2 text-right">{r.custo_unitario}</td>
                        <td className="p-2 text-right">{r.estoque_minimo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.length > 50 && (
                  <p className="p-2 text-xs text-muted-foreground text-center">
                    + {preview.length - 50} linha(s) não exibidas na pré-visualização
                  </p>
                )}
              </div>
            </div>
          )}

          {results && (
            <div className="border rounded-md max-h-64 overflow-y-auto">
              <div className="p-3 border-b bg-muted/30 text-xs font-medium">Resultado da importação</div>
              <ul className="divide-y text-xs">
                {results.map((r, i) => (
                  <li key={i} className="p-2 flex items-start gap-2">
                    {r.status === "ok" ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                    )}
                    <span>
                      Linha {r.linha} — <strong>{r.nome}</strong>
                      {r.mensagem && <span className="text-muted-foreground"> — {r.mensagem}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            {results ? "Fechar" : "Cancelar"}
          </Button>
          {!results && (
            <Button onClick={handleImport} disabled={preview.length === 0 || importing}>
              {importing ? "Importando..." : `Importar ${preview.length} item(ns)`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
