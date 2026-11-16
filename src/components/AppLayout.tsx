import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Package, ArrowRightLeft, Settings2, Factory,
  ShoppingCart, Menu, X, Truck, ClipboardList, ListOrdered,
  LogOut, Building2, Users
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandMark } from "@/components/BrandMark";
import { canAccess, roleNames, useAuth } from '@/auth';

const navGroups = [
  {
    label: "Estoque",
    items: [
      { to: "/estoque", label: "Posição de Estoque", icon: Package },
      { to: "/movimentacoes", label: "Movimentações", icon: ArrowRightLeft },
      { to: "/centros-de-custo", label: "Centros de Custo", icon: Building2 },
    ],
  },
  {
    label: "Operações",
    items: [
      { to: "/pedidos", label: "Fila de Montagem", icon: ListOrdered },
      { to: "/producao", label: "Produção", icon: Factory },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { to: "/estrutura", label: "Estruturas (BOM)", icon: Settings2 },
    ],
  },
  {
    label: "Compras",
    items: [
      { to: "/compras", label: "Pedidos de Compra", icon: ShoppingCart },
      { to: "/sugestao-compras", label: "Sugestão de Compras", icon: ClipboardList },
      { to: "/fornecedores", label: "Fornecedores", icon: Truck },
    ],
  },
  {
    label: "Administração",
    items: [{ to: "/usuarios", label: "Usuários e acessos", icon: Users }],
  },
];

const allNavItems = navGroups.flatMap(g => g.items);

export function AppLayout({ children }: { children: React.ReactNode }) {
  const user = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const currentPage = allNavItems.find(n => n.to === location.pathname);

  const handleLogout = async () => {
    await fetch("/api/session", { method: "DELETE", credentials: "same-origin" });
    window.dispatchEvent(new Event("session-expired"));
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar-background border-r border-sidebar-border flex flex-col transition-transform duration-200 ease-out lg:relative lg:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        {/* Identidade do sistema */}
        <div className="flex items-center gap-3 px-5 h-16 border-b border-sidebar-border">
          <BrandMark subtitle="Estoque, Compras e Produção" className="flex-1" />
          <button
            className="lg:hidden p-1 rounded-md hover:bg-sidebar-accent shrink-0"
            onClick={() => setMobileOpen(false)}
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5 text-sidebar-foreground" />
          </button>
        </div>

        {/* Navegação */}
        <nav className="flex-1 py-5 px-3 space-y-6 overflow-y-auto">
          {navGroups.map((group) => ({ ...group, items: group.items.filter((item) => canAccess(user.role, item.to)) }))
            .filter((group) => group.items.length > 0).map((group) => (
            <div key={group.label}>
              <p className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ to, label, icon: Icon }) => {
                  const isActive = location.pathname === to;
                  return (
                    <Link
                      key={to}
                      to={to}
                      onClick={() => setMobileOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition-colors duration-150 relative",
                        isActive
                          ? "bg-primary/10 text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                      )}
                    >
                      {isActive && (
                        <span
                          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-primary"
                          aria-hidden
                        />
                      )}
                      <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-sidebar-foreground/60")} />
                      <span className="truncate">{label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Conta individual */}
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-xs font-semibold uppercase text-primary" aria-hidden>
              {user.displayName.trim().charAt(0) || "?"}
            </div>
            <div className="min-w-0 flex-1 text-xs">
              <div className="font-medium text-sidebar-foreground truncate">{user.displayName}</div>
              <div className="text-muted-foreground">{roleNames[user.role]}</div>
            </div>
            <button onClick={handleLogout} className="rounded-md p-2 text-sidebar-foreground/60 hover:bg-primary/15 hover:text-primary transition-colors" aria-label="Sair" title="Sair">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="brand-stripe h-[2px] shrink-0" aria-hidden />
        <header className="h-[62px] border-b border-border flex items-center px-4 lg:px-6 gap-3 bg-sidebar-background">

          <button
            className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-accent transition-colors"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5 text-foreground" />
          </button>
          <div className="flex items-center gap-2">
            {currentPage && <currentPage.icon className="h-4 w-4 text-primary" />}
            <h1 className="text-sm font-semibold text-foreground">
              {currentPage?.label || "Sistema"}
            </h1>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4 lg:p-6">
          <div className="animate-in">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
