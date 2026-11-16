import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Play, User } from "lucide-react";

export type StartProductionDialogResult = {
  montador_nome: string;
  modo_execucao: "SIMPLIFICADO" | "DETALHADO";
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  produtoNome?: string;
  onConfirm: (result: StartProductionDialogResult) => Promise<void> | void;
  isSubmitting?: boolean;
  fixedMontador: string;
};

export function StartProductionDialog({ open, onOpenChange, produtoNome, onConfirm, isSubmitting, fixedMontador }: Props) {
  const handleConfirm = async () => {
    // Fluxo simplificado: não há mais escolha de modo (simplificado/detalhado).
    await onConfirm({ montador_nome: fixedMontador, modo_execucao: "SIMPLIFICADO" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-primary" />
            Iniciar montagem
          </DialogTitle>
          {produtoNome && (
            <DialogDescription>
              Produto: <span className="text-foreground font-medium">{produtoNome}</span>
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="montador" className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />
              Nome do montador
            </Label>
            <Input
              id="montador"
              value={fixedMontador}
              readOnly
              className="mt-1.5 text-base h-11"
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Responsável vinculado à sua conta.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={!fixedMontador || isSubmitting}>
              Iniciar montagem
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
