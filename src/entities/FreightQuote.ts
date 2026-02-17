import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique, Index } from "typeorm";
import { Company } from "./Company.js";
import { Plataform } from "./Plataform.js";

@Entity({ name: "freight_quotes" })
@Index("idx_freight_quotes_company_date", ["company", "date"])
@Unique("UQ_freight_quotes_company_id_platform_id_quote_id", ["company", "platform", "quoteId"])
export class FreightQuote {
  @PrimaryGeneratedColumn()
  id!: number;

  // AllPost: retorno.idCotacao
  @Column({ type: "varchar" })
  quoteId!: string;

  // AllPost: retorno.plataforma
  @Column({ type: "varchar", nullable: true })
  partnerPlatform?: string | null;

  // AllPost: retorno.idCotacaoExterno
  @Column({ type: "varchar", nullable: true })
  externalQuoteId?: string | null;

  // AllPost: retorno.dataCotacao
  @Column({ type: "timestamptz", nullable: true })
  quotedAt?: Date | null;

  /** Data no fuso Brasil, formato YYYY-MM-DD (ex.: 2026-01-01). Derivada de quotedAt. */
  @Column({ type: "varchar", length: 10, nullable: true })
  date?: string | null;

  /** Horário no fuso Brasil, formato HH:mm:ss (ex.: 12:59:59). Derivado de quotedAt. */
  @Column({ type: "varchar", length: 8, nullable: true })
  time?: string | null;

  // destination (retorno.destino)
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

  // input (dadosEntrada / carrinho)
  @Column({ type: "varchar", nullable: true })
  channel?: string | null;

  @Column({ type: "varchar", nullable: true })
  storeName?: string | null;

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  invoiceValue?: string | null;

  @Column({ type: "numeric", precision: 14, scale: 3, nullable: true })
  totalWeight?: string | null;

  @Column({ type: "numeric", precision: 14, scale: 6, nullable: true })
  totalVolume?: string | null;

  @Column({ type: "integer", nullable: true })
  totalPackages?: number | null;

  /** Melhor prazo (carrierDeadline) entre as opções, sempre da mesma opção que bestFreightCost. */
  @Column({ type: "integer", nullable: true })
  bestDeadline?: number | null;

  /** Melhor preço de frete (shippingValue) entre as opções, sempre da mesma opção que bestDeadline. */
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  bestFreightCost?: string | null;

  // response metadata
  @Column({ type: "integer", nullable: true })
  storeLimit?: number | null;

  @Column({ type: "integer", nullable: true })
  channelLimit?: number | null;

  // raw payloads (audit/debug)
  @Column({ type: "jsonb", nullable: true })
  timings?: unknown;

  @Column({ type: "jsonb", nullable: true })
  channelConfig?: unknown;

  @Column({ type: "jsonb", nullable: true })
  input?: unknown;

  @Column({ type: "jsonb", nullable: true })
  categoryRestrictions?: unknown;

  @Column({ type: "jsonb", nullable: true })
  deliveryOptions?: unknown;

  @Column({ type: "jsonb", nullable: true })
  raw?: unknown;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => Plataform, { nullable: true })
  @JoinColumn({ name: "platform_id" })
  platform?: Plataform;
}


