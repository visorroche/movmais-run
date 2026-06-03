import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Company } from "../Company.js";

/**
 * Tabelas de preço do operador logístico (Avanço): origem, destino, faixa de peso, valor. Usada em AvancoLogisticsAddress.
 */
@Entity({ name: "avanco_logistics_table_price" })
export class AvancoLogisticsTablePrice {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "company_id", type: "int" })
  companyId!: number;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @Column({ type: "text", nullable: true })
  name?: string | null;

  @Column({ name: "cd_name", type: "text", nullable: true })
  cdName?: string | null;

  @Column({ name: "uf_origin", type: "text", nullable: true })
  ufOrigin?: string | null;

  @Column({ name: "city_origin", type: "text", nullable: true })
  cityOrigin?: string | null;

  @Column({ name: "uf_delivery", type: "text", nullable: true })
  ufDelivery?: string | null;

  @Column({ name: "city_delivery", type: "text", nullable: true })
  cityDelivery?: string | null;

  @Column({ name: "weight_min", type: "numeric", nullable: true })
  weightMin?: string | null;

  @Column({ name: "weight_max", type: "numeric", nullable: true })
  weightMax?: string | null;

  @Column({ name: "value_min", type: "numeric", nullable: true })
  valueMin?: string | null;

  @Column({ name: "value_max", type: "numeric", nullable: true })
  valueMax?: string | null;

  @Column({ name: "cubage", type: "numeric", nullable: true })
  cubage?: string | null;

  @Column({ name: "restricted_weight", type: "numeric", nullable: true })
  restrictedWeight?: string | null;

  @Column({ name: "type_calcule", type: "text", nullable: true })
  typeCalcule?: string | null;

  @Column({ name: "price", type: "numeric", precision: 14, scale: 4, nullable: true })
  price?: string | null;

  @Column({ name: "extra_price", type: "numeric", nullable: true })
  extraPrice?: string | null;

  @Column({ name: "ad_value", type: "numeric", nullable: true })
  adValue?: string | null;

  @Column({ name: "extra_weight", type: "numeric", nullable: true })
  extraWeight?: string | null;

  @Column({ name: "extra_weight_value", type: "numeric", nullable: true })
  extraWeightValue?: string | null;

  @Column({ name: "dispatch", type: "numeric", nullable: true })
  dispatch?: string | null;

  @Column({ name: "total_min", type: "numeric", nullable: true })
  totalMin?: string | null;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;
}
