export const ORDER_STATUSES = [
  "novo",
  "aguardando pagamento",
  "pendente",
  "em analise",
  "aprovado",
  "faturando",
  "coletando",
  "aguardando disponibilidade",
  "aguardando transporte",
  "em transporte",
  "entregue marketplace",
  "entregue",
  "devolvido",
  "cancelado",
  "frete não atendido",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

function normalizeKey(input: string): string {
  return input.trim().toLowerCase();
}

export function mapPrecodeStatus(raw: string): OrderStatus {
  const key = normalizeKey(raw);
  const mapping: Record<string, OrderStatus> = {
    novo: "novo",
    analisando: "em analise",
    aprovado: "aprovado",
    faturando: "faturando",
    coletando: "coletando",
    "em viagem": "em transporte",
    entregue: "entregue",
    devolvido: "devolvido",
    cancelado: "cancelado",
  };

  const mapped = mapping[key];
  if (!mapped) {
    throw new Error(`Status Precode sem mapeamento: "${raw}"`);
  }
  return mapped;
}

export function defaultTrayStatusMap(): Record<string, OrderStatus> {
  // chaves normalizadas em uppercase/trim (mantemos case-insensitive via normalizeKey)
  return {
    [normalizeKey("AGUARDANDO PAGAMENTO")]: "aguardando pagamento",
    [normalizeKey("AGUARDANDO ENVIO")]: "aguardando transporte",
    [normalizeKey("A ENVIAR")]: "aguardando transporte",
    [normalizeKey("ENVIADO")]: "entregue",
    [normalizeKey("FINALIZADO")]: "entregue",
    [normalizeKey("CANCELADO")]: "cancelado",
    [normalizeKey("CANCELADO AUT")]: "cancelado",
    [normalizeKey("COMPRA EM ANALISE")]: "em analise",
    [normalizeKey("PENDENTE")]: "pendente",
    [normalizeKey("EM MONITORAMENTO")]: "em transporte",
    [normalizeKey("AGUARDANDO DISPONIBILIDADE")]: "aguardando disponibilidade",
    [normalizeKey("ENTREGUE LEROY")]: "entregue marketplace",
    [normalizeKey("FRETE NÃO ATENDIDO")]: "frete não atendido",
    [normalizeKey("A ENVIAR YAPAY")]: "em analise",
    [normalizeKey("AGUARDANDO YAPAY")]: "aguardando pagamento",
    [normalizeKey("A ENVIAR VINDI")]: "em analise",
    [normalizeKey("AGUARDANDO VINDI")]: "aguardando pagamento",
  };
}

export function parseTrayCustomStatusMap(value: unknown): Record<string, OrderStatus> {
  const map: Record<string, OrderStatus> = {};
  if (!Array.isArray(value)) return map;

  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const obj = entry as Record<string, unknown>;
    const from =
      (typeof obj.key === "string" && obj.key) ||
      (typeof obj.tray === "string" && obj.tray) ||
      (typeof obj.from === "string" && obj.from) ||
      (typeof obj.status === "string" && obj.status) ||
      null;
    const to =
      (typeof obj.value === "string" && obj.value) ||
      (typeof obj.our === "string" && obj.our) ||
      (typeof obj.to === "string" && obj.to) ||
      (typeof obj.mapped === "string" && obj.mapped) ||
      null;

    if (!from || !to) continue;
    if (!isOrderStatus(to)) continue;
    map[normalizeKey(from)] = to;
  }

  return map;
}

export function mapTrayStatus(raw: string, customMap?: Record<string, OrderStatus>): OrderStatus {
  const key = normalizeKey(raw);
  const base = defaultTrayStatusMap();
  const merged = { ...base, ...(customMap ?? {}) };

  const mapped = merged[key];
  if (!mapped) {
    throw new Error(`Status Tray sem mapeamento: "${raw}"`);
  }
  return mapped;
}


