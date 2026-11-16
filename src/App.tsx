import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { AuthProvider, canAccess, type AuthUser } from './auth';
const StockPage = lazy(() => import("@/pages/StockPage"));
const MovementsPage = lazy(() => import("@/pages/MovementsPage"));
const CostCentersPage = lazy(() => import("@/pages/CostCentersPage"));
const QuickMovementsPage = lazy(() => import("@/pages/QuickMovementsPage"));
const BomPage = lazy(() => import("@/pages/BomPage"));
const ProductionPage = lazy(() => import("@/pages/ProductionPage"));
const ProductionOrderPage = lazy(() => import("@/pages/ProductionOrderPage"));
const PurchasesPage = lazy(() => import("@/pages/PurchasesPage"));
const FornecedoresPage = lazy(() => import("@/pages/FornecedoresPage"));
const SugestaoComprasPage = lazy(() => import("@/pages/SugestaoComprasPage"));
const PedidosPage = lazy(() => import("@/pages/PedidosPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const UsersPage = lazy(() => import("@/pages/UsersPage"));

export const queryClient = new QueryClient();

function Guard({ user, path, children }: { user: AuthUser; path: string; children: React.ReactNode }) {
  return canAccess(user.role, path) ? <>{children}</> : <Navigate to="/estoque" replace />;
}

const App = ({ user }: { user: AuthUser }) => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider user={user}>
    <TooltipProvider>
      <Sonner />
      <BrowserRouter>
        <AppLayout>
          <Suspense fallback={<div className="p-6 text-muted-foreground">Carregando página...</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/estoque" replace />} />
            <Route path="/estoque" element={<StockPage />} />
            <Route path="/movimentacoes" element={<Guard user={user} path="/movimentacoes"><MovementsPage /></Guard>} />
            <Route path="/centros-de-custo" element={<Guard user={user} path="/centros-de-custo"><CostCentersPage /></Guard>} />
            <Route path="/movimentacoes/rapido" element={<Guard user={user} path="/movimentacoes"><QuickMovementsPage /></Guard>} />
            <Route path="/estrutura" element={<Guard user={user} path="/estrutura"><BomPage /></Guard>} />
            <Route path="/producao" element={<Guard user={user} path="/producao"><ProductionPage /></Guard>} />
            <Route path="/producao/:id" element={<Guard user={user} path="/producao"><ProductionOrderPage /></Guard>} />
            <Route path="/compras" element={<Guard user={user} path="/compras"><PurchasesPage /></Guard>} />
            <Route path="/fornecedores" element={<Guard user={user} path="/fornecedores"><FornecedoresPage /></Guard>} />
            <Route path="/sugestao-compras" element={<Guard user={user} path="/sugestao-compras"><SugestaoComprasPage /></Guard>} />
            <Route path="/pedidos" element={<Guard user={user} path="/pedidos"><PedidosPage /></Guard>} />
            <Route path="/usuarios" element={<Guard user={user} path="/usuarios"><UsersPage /></Guard>} />
            <Route path="/montagens" element={<Navigate to="/estrutura" replace />} />
            <Route path="/kits" element={<Navigate to="/estrutura" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </AppLayout>
      </BrowserRouter>
    </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
