import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Product } from "../Product.js";
import { AvancoLogisticOrder } from "./AvancoLogisticOrder.js";

@Entity({ name: "avanco_logistic_order_items" })
export class AvancoLogisticOrderItem {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  // OBS: na tabela está como integer (mesmo o order sendo bigint).
  @Column({ name: "logistic_order_id", type: "int", nullable: true })
  logisticOrderId?: number | null;

  @ManyToOne(() => AvancoLogisticOrder, { nullable: true })
  @JoinColumn({ name: "logistic_order_id" })
  logisticOrder?: AvancoLogisticOrder | null;

  @Column({ name: "product_id", type: "int", nullable: true })
  productId?: number | null;

  @ManyToOne(() => Product, { nullable: true })
  @JoinColumn({ name: "product_id" })
  product?: Product | null;

  @Column({ type: "numeric", nullable: true })
  quantity?: string | null;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;
}

