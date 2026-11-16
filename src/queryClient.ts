import { QueryClient } from "@tanstack/react-query";

/** Cache de consultas compartilhado; é limpo no login e no logout (AccessGate). */
export const queryClient = new QueryClient();
