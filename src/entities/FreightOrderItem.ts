import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique, Index } from "typeorm";
import { Company } from "./Company.js";
import { Product } from "./Product.js";
import { FreightOrder } from "./FreightOrder.js";

@Entity({ name: "freight_order_items" })
@Index("idx_freight_order_items_product_id", ["product"])
@Unique("UQ_freight_order_items_order_id_line_index", ["order", "lineIndex"])
export class FreightOrderItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => FreightOrder, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "order_id" })
  order!: FreightOrder;

  @ManyToOne(() => Product, { nullable: true })
  @JoinColumn({ name: "product_id" })
  product?: Product | null;

  /** Índice estável do item no pedido (ordem global entre todos os envios). */
  @Column({ type: "integer" })
  lineIndex!: number;

  /** Índice do envio (obj.envio[envioIndex]) de onde veio o item. */
  @Column({ type: "integer", nullable: true })
  envioIndex?: number | null;

  // AllPost envio[].produtos[] fields
  @Column({ type: "varchar", nullable: true })
  partnerSku?: string | null;

  @Column({ type: "varchar", nullable: true })
  partnerSkuId?: string | null; // idSku

  @Column({ type: "varchar", nullable: true })
  title?: string | null; // titulo

  @Column({ type: "integer", nullable: true })
  quantity?: number | null;

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  price?: string | null;

  @Column({ type: "integer", nullable: true })
  volumes?: number | null; // quantidadeVolumes

  @Column({ type: "numeric", precision: 14, scale: 3, nullable: true })
  weight?: string | null; // peso

  @Column({ type: "varchar", nullable: true })
  category?: string | null;

  @Column({ type: "varchar", nullable: true })
  variation?: string | null; // variacao

  @Column({ type: "jsonb", nullable: true })
  raw?: unknown;
}
