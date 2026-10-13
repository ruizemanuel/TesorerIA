const OUTCOME: Record<string, string> = {
  reimbursed: "Listo: el agente te devolvió la plata.",
  proposed: "No entraba sin votación: el agente lo propuso y ahora lo vota el grupo.",
  waiting: "El fondo todavía no tiene esos pesos: el agente te lo devuelve cuando entren.",
  rejected: "El agente no puede devolver este gasto.",
  blocked: "No se pudo procesar ahora. El agente lo vuelve a intentar en un rato.",
  sending: "El agente ya lo mandó. En un rato aparece en los movimientos.",
  new: "El agente está ocupado: lo procesa en unos minutos.",
};

/** What happened to an expense a member loaded, by its status: the Cargar gasto panel and the chat's card say the same. */
export function expenseOutcome(status: string): string {
  return OUTCOME[status] ?? OUTCOME.new!;
}
