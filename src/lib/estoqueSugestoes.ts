/**
 * Sugestões automáticas de estoque:
 * - Estoque Mínimo = Consumo Diário × Lead Time
 * - Estoque Ideal = Estoque Mínimo + (Consumo Diário × Lead Time) = 2 × Consumo × Lead Time
 * - Estoque Máximo = Estoque Ideal × 1.5
 */
export function calcSuggestions(consumoDiario: number, leadTime: number) {
  const min = Math.round(consumoDiario * leadTime * 100) / 100;
  const ideal = Math.round((min + consumoDiario * leadTime) * 100) / 100;
  const max = Math.round(ideal * 1.5 * 100) / 100;
  return { min, ideal, max };
}
