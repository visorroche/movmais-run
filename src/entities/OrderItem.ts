import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Company } from "./Company.js";
import { Order } from "./Order.js";
import { Product } from "./Product.js";

@Entity({ name: "order_items" })
export class OrderItem {
  @PrimaryGeneratedColumn()
  id!: number;

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

  @Column({ type: "integer", nullable: true })
  quantity?: number | null; // quantidade

  @Column({ type: "varchar", nullable: true })
  itemType?: string | null; // tipo

  @Column({ type: "varchar", nullable: true })
  serviceRefSku?: string | null; // servicoRefSku
}


