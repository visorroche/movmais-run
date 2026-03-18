import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { AvancoStock } from "./AvancoStock.js";

/** Tipo da movimentação: order = saída (pedido Precode); logistic_order = entrada (pedido recebido pelo operador). */
export type AvancoStockMovType = "order" | "logistic_order";

/**
 * Registro de cada movimentação que altera o AvancoStock (entrada ou saída).
 * type_id = id do pedido (Order.id) ou id do AvancoLogisticOrder.
 */
/**
 * Movimentações de estoque Avanço (entrada/saída). Vinculado a AvancoStock.
 * Avanço: requer company.avanco=true
 */
@Entity({ name: "avanco_stock_mov" })
export class AvancoStockMov {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "avanco_stock_id", type: "bigint" })
  avancoStockId!: string;

  @ManyToOne(() => AvancoStock, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "avanco_stock_id" })
  avancoStock?: AvancoStock;

  /** Quantidade (positiva = entrada, negativa = saída). */
  @Column({ type: "integer" })
  quantity!: number;

  @Column({ type: "varchar", length: 32 })
  type!: AvancoStockMovType;

  @Column({ name: "type_id", type: "varchar", length: 64 })
  typeId!: string;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;
}
