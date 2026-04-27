import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from "typeorm";
import { Company } from "./Company.js";
import { Order } from "./Order.js";
import { Product } from "./Product.js";

/**
 * Itens de um pedido: produto, quantidade, preços, comissões. Relacionado a orders e products.
 * Plataformas: ecommerce, b2b
 */
@Entity({ name: "order_items" })
@Index("idx_order_items_product_id", ["product"])
@Index("idx_order_items_order_id_product_id", ["order", "product"])
export class OrderItem {
  @PrimaryGeneratedColumn()
  id!: number;

  /** ID externo do item no banco do cliente (quando existir). */
  @Column({ type: "varchar", nullable: true, name: "external_id" })
  externalId?: string | null;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => Order, (order: Order) => order.items, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "order_id" })
  order!: Order;

  @ManyToOne(() => Product, { nullable: true })
  @JoinColumn({ name: "product_id" })
  product?: Product | null;

  // NOMAP
  @Column({ type: "integer", nullable: true })
  sku?: number | null;

  // valor unitário do produto na venda sem desconto
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  unitPrice?: string | null; 

  // valor unitário do produto na venda com desconto se null usar o campo unitPrice
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  netUnitPrice?: string | null; // valorUnitarioLiquido

  // comissão do produto na venda
  @Column({ type: "numeric", precision: 14, scale: 2, default: 0 })
  comission!: string;

  // quantidade do produto na venda
  @Column({ type: "integer", nullable: true })
  quantity?: number | null; // quantidade

  // NOMAP
  @Column({ type: "varchar", nullable: true })
  itemType?: string | null; // tipo

  // NOMAP
  @Column({ type: "varchar", nullable: true })
  serviceRefSku?: string | null; // servicoRefSku

  /** Comissão % do assistente (ex: 0.25). */
  @Column({ type: "numeric", precision: 14, scale: 6, default: 0, name: "assistant_comission" })
  assistantComission!: string;

  /** Comissão % do supervisor (ex: 0.25). */
  @Column({ type: "numeric", precision: 14, scale: 6, default: 0, name: "supervisor_comission" })
  supervisorComission!: string;

  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  metadata?: unknown;

  /** Último `synced_at` da linha no cliente já aplicado neste item (incremental Database B2B por linha). */
  @Column({ type: "timestamptz", nullable: true, name: "source_synced_at" })
  sourceSyncedAt?: Date | null;
}


