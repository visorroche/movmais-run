import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from "typeorm";
import { Company } from "./Company.js";
import { Order } from "./Order.js";
import { Product } from "./Product.js";

@Entity({ name: "order_items" })
@Index("idx_order_items_product_id", ["product"])
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

  @Column({ type: "integer", nullable: true })
  sku?: number | null;

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  unitPrice?: string | null; // valorUnitario

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  netUnitPrice?: string | null; // valorUnitarioLiquido

  @Column({ type: "numeric", precision: 14, scale: 2, default: 0 })
  comission!: string;

  @Column({ type: "integer", nullable: true })
  quantity?: number | null; // quantidade

  @Column({ type: "varchar", nullable: true })
  itemType?: string | null; // tipo

  @Column({ type: "varchar", nullable: true })
  serviceRefSku?: string | null; // servicoRefSku

  /** Comissão do assistente (ex: 0.25). */
  @Column({ type: "numeric", precision: 14, scale: 6, nullable: true, name: "assistant_comission" })
  assistantComission?: string | null;

  /** Comissão do supervisor (ex: 0.25). */
  @Column({ type: "numeric", precision: 14, scale: 6, nullable: true, name: "supervisor_comission" })
  supervisorComission?: string | null;

  @Column({ type: "jsonb", nullable: true })
  metadata?: unknown;
}


