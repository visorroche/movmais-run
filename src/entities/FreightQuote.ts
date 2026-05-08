import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique, Index } from "typeorm";
import { Company } from "./Company.js";
import { Plataform } from "./Plataform.js";

/**
 * Cotações de frete (Allpost). Uma cotação com itens (FreightQuoteItem) e opções de entrega (FreightQuoteOption); best_deadline e best_freight_cost derivados.
 * Plataformas: logistic
 */
@Entity({ name: "freight_quotes" })
@Index("idx_freight_quotes_company_date", ["company", "date"])
/** Filtros por janela de tempo em `quoted_at` (timestamptz) — `date` sozinho não substitui. */
@Index("idx_freight_quotes_company_quoted_at", ["company", "quotedAt"])
@Unique("UQ_freight_quotes_company_id_platform_id_quote_id", ["company", "platform", "quoteId"])
export class FreightQuote {
  @PrimaryGeneratedColumn()
  id!: number;

  // id da cotacao que originou o pedido 
  @Column({ type: "varchar" })
  quoteId!: string;

  // plataforma que originou a cotacao, ex: Allpost.
  @Column({ type: "varchar", nullable: true })
  partnerPlatform?: string | null;

  // id da cotacao externa 
  @Column({ type: "varchar", nullable: true })
  externalQuoteId?: string | null;

  // data hora da cotacao
  @Column({ type: "timestamptz", nullable: true })
  quotedAt?: Date | null;

  /** Data da cotacao no fuso Brasil, formato YYYY-MM-DD (ex.: 2026-01-01). Derivada de quotedAt. */
  @Column({ type: "varchar", length: 10, nullable: true })
  date?: string | null;

  /** Horário da cotacao no fuso Brasil, formato HH:mm:ss (ex.: 12:59:59). Derivado de quotedAt. */
  @Column({ type: "varchar", length: 8, nullable: true })
  time?: string | null;

  // endereco de destino da cotacao
  @Column({ type: "varchar", nullable: true })
  destinationZip?: string | null;

  @Column({ type: "varchar", nullable: true })
  destinationState?: string | null;

  @Column({ type: "varchar", nullable: true })
  destinationStateName?: string | null;

  @Column({ type: "varchar", nullable: true })
  destinationStateRegion?: string | null;

  @Column({ type: "varchar", nullable: true })
  destinationCountryRegion?: string | null;

  // canal, marketplace que gerou a cotacao Mercado Livre, Amazon, etc.
  @Column({ type: "varchar", nullable: true })
  channel?: string | null;

  // NOMAP
  @Column({ type: "varchar", nullable: true })
  storeName?: string | null;

  // valor total dos produtos na NF
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  invoiceValue?: string | null;

  // peso total dos produtos na cotacao
  @Column({ type: "numeric", precision: 14, scale: 3, nullable: true })
  totalWeight?: string | null;

  // volume total dos produtos na cotacao
  @Column({ type: "numeric", precision: 14, scale: 6, nullable: true })
  totalVolume?: string | null;

  // total de volumes dos produtos na cotacao
  @Column({ type: "integer", nullable: true })
  totalPackages?: number | null;

  /** Melhor prazo (carrierDeadline) entre as opções, sempre da mesma opção que bestFreightCost. */
  @Column({ type: "integer", nullable: true })
  bestDeadline?: number | null;

  /** Melhor preço de frete (shippingValue) entre as opções, sempre da mesma opção que bestDeadline. */
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  bestFreightCost?: string | null;

  // NOMAP
  @Column({ type: "integer", nullable: true })
  storeLimit?: number | null;

  // NOMAP
  @Column({ type: "integer", nullable: true })
  channelLimit?: number | null;

  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  timings?: unknown;

  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  channelConfig?: unknown;

  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  input?: unknown;
  
  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  categoryRestrictions?: unknown;
  
  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  deliveryOptions?: unknown;

  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  raw?: unknown;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  // NOMAP
  @ManyToOne(() => Plataform, { nullable: true })
  @JoinColumn({ name: "platform_id" })
  platform?: Plataform;
}


