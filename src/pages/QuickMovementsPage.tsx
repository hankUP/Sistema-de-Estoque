import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { QuickMovementMode } from "@/components/QuickMovementMode";
import { Button } from "@/components/ui/button";

export default function QuickMovementsPage() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link to="/movimentacoes">
            <ArrowLeft className="h-4 w-4" /> Voltar para Movimentações
          </Link>
        </Button>
      </div>
      <QuickMovementMode />
    </div>
  );
}
