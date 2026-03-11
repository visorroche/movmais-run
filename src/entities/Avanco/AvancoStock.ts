import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Company } from "../Company.js";
import { Product } from "../Product.js";

/**
 * Estoque no operador logístico: produtos enviados pela origem e recebidos pelo operador.
 * Uma linha por (company_origin_id, company_logistic_id, product_id); quantity é somada ao recebimento.
 */
@Entity({ name: "avanco_stock" })
@Index("UQ_avanco_stock_origin_logistic_product", ["companyOriginId", "companyLogisticId", "productId"], {
  unique: true,
})
export class AvancoStock {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "company_origin_id", type: "int" })
  companyOriginId!: number;

  @ManyToOne(() => Company, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "company_origin_id" })
  companyOrigin?: Company;

  @Column({ name: "company_logistic_id", type: "int" })
  companyLogisticId!: number;

  @ManyToOne(() => Company, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "company_logistic_id" })
  companyLogistic?: Company;

  @Column({ name: "product_id", type: "int" })
  productId!: number;

  @ManyToOne(() => Product, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "product_id" })
  product?: Product;

  @Column({ type: "integer", default: 0 })
  quantity!: number;
}
