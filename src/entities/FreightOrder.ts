import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique, Index } from "typeorm";
import { Company } from "./Company.js";
import { Plataform } from "./Plataform.js";

/**
 * Pedidos de frete que são realizados pela empresa logistica (Allpost). Um pedido de frete com itens (FreightOrderItem), valores e datas.
 * Plataformas: logistic
 */
@Entity({ name: "freight_orders" })
@Index("idx_freight_orders_company_date", ["company", "date"])
@Unique("UQ_freight_orders_company_id_platform_id_external_id", ["company", "platform", "externalId"])
export class FreightOrder {
  @PrimaryGeneratedColumn()
  id!: number;

  // AllPost: _id
  @Column({ type: "varchar" })
  externalId!: string;

  // AllPost: data (ex: "2022-10-01 00:00:00")
  @Column({ type: "timestamptz", nullable: true })
  orderDate?: Date | null;

  /** Data no fuso Brasil, formato YYYY-MM-DD (ex.: 2026-01-01). Derivada de orderDate. */
  @Column({ type: "varchar", length: 10, nullable: true })
  date?: string | null;

  /** Horário no fuso Brasil, formato HH:mm:ss (ex.: 12:59:59). Derivado de orderDate. */
  @Column({ type: "varchar", length: 8, nullable: true })
  time?: string | null;

  // numero do pedido do operador logistico
  @Column({ type: "varchar", nullable: true })
  orderCode?: string | null;

  // NOMAP
  @Column({ type: "varchar", nullable: true })
  storeName?: string | null;

  // id da cotacao que originou o pedido 
  @Column({ type: "varchar", nullable: true })
  quoteId?: string | null;

  // canal, marketplace que gerou o pedido Mercado Livre, Amazon, etc.
  @Column({ type: "varchar", nullable: true })
  channel?: string | null;

  // valor do frete do pedido repassado para o cliente
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  freightAmount?: string | null;

  // valor do custo do frete real que a empresa paga
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  freightCost?: string | null;

  // diferenca entre o valor do frete repassado para o cliente e o valor do custo do frete real que a empresa paga
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  deltaQuote?: string | null;

  /** Valor total dos produtos na NF */
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  invoiceValue?: string | null;

  // endereco de entrega do pedido
  @Column({ type: "varchar", nullable: true })
  address?: string | null;

  @Column({ type: "varchar", nullable: true })
  addressZip?: string | null;

  @Column({ type: "varchar", nullable: true })
  addressState?: string | null;

  @Column({ type: "varchar", nullable: true })
  addressCity?: string | null;

  @Column({ type: "varchar", nullable: true })
  addressNeighborhood?: string | null;

  @Column({ type: "varchar", nullable: true })
  addressNumber?: string | null;

  @Column({ type: "varchar", nullable: true })
  addressComplement?: string | null;

  // data estimada de entrega do pedido
  @Column({ type: "timestamptz", nullable: true })
  estimatedDeliveryDate?: Date | null; // max(envio.prazoEntregaPedido)

  /** Número de dias (calendário) entre data do pedido e data estimada de entrega do pedido. */
  @Column({ type: "integer", nullable: true })
  numDeliveryDays?: number | null;

  // data de entrega do pedido de fato, null quando ainda nao foi entregue
  @Column({ type: "timestamptz", nullable: true })
  deliveryDate?: Date | null; // max(envio.dataEntrega)

  // diferenca entre a data estimada de entrega do pedido e a data de entrega do pedido de fato
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  deltaQuoteDeliveryDate?: string | null; // max(envio.diferencaPedidoCotacao)

  // NOMAP - payload "cru" do parceiro (somente para logs/auditoria)
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

