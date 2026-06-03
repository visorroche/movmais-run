import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Company } from "../Company.js";
import { AvancoLogisticsOperator } from "./AvancoLogisticsOperator.js";
import { AvancoLogisticsTablePrice } from "./AvancoLogisticsTablePrice.js";

/**
 * Endereços/faixas de CEP do operador logístico (Avanço): faixa CEP, UF, cidade, dias, preço. Vinculado a tabela de preço.
 */
@Entity({ name: "avanco_logistics_addresses" })
export class AvancoLogisticsAddress {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "company_id", type: "int" })
  companyId!: number;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @Column({ name: "logistic_operator_id", type: "int", nullable: true })
  logisticOperatorId?: number | null;

  @ManyToOne(() => AvancoLogisticsOperator, { nullable: true })
  @JoinColumn({ name: "logistic_operator_id" })
  logisticOperator?: AvancoLogisticsOperator | null;

  @Column({ name: "zip_start", type: "text", nullable: true })
  zipStart?: string | null;

  @Column({ name: "zip_end", type: "text", nullable: true })
  zipEnd?: string | null;

  @Column({ type: "text", nullable: true })
  uf?: string | null;

  @Column({ type: "text", nullable: true })
  city?: string | null;

  @Column({ name: "transfer_type", type: "text", nullable: true })
  transferType?: string | null;

  @Column({ name: "delivery_days", type: "integer", nullable: true })
  deliveryDays?: number | null;

  @Column({ type: "numeric", nullable: true })
  insurance?: string | null;

  @Column({ name: "imposto", type: "numeric", nullable: true })
  imposto?: string | null;

  @Column({ name: "insurance_min", type: "numeric", nullable: true })
  insuranceMin?: string | null;

  @Column({ type: "numeric", nullable: true })
  gris?: string | null;

  @Column({ name: "gris_min", type: "numeric", nullable: true })
  grisMin?: string | null;

  @Column({ name: "pedagio", type: "numeric", nullable: true })
  pedagio?: string | null;

  @Column({ name: "street_taxe", type: "numeric", nullable: true })
  streetTaxe?: string | null;

  @Column({ name: "tas", type: "numeric", nullable: true })
  tas?: string | null;

  @Column({ name: "tas_min", type: "numeric", nullable: true })
  tasMin?: string | null;

  @Column({ name: "emex", type: "numeric", nullable: true })
  emex?: string | null;

  @Column({ name: "emex_min", type: "numeric", nullable: true })
  emexMin?: string | null;

  @Column({ name: "taxe_min", type: "numeric", nullable: true })
  taxeMin?: string | null;

  @Column({ name: "taxe", type: "numeric", nullable: true })
  taxe?: string | null;

  @Column({ name: "taxe_kg", type: "numeric", nullable: true })
  taxeKg?: string | null;

  @Column({ name: "taxe_on", type: "text", nullable: true })
  taxeOn?: string | null;

  @Column({ name: "table_price_id", type: "bigint", nullable: true })
  tablePriceId?: string | null;

  @ManyToOne(() => AvancoLogisticsTablePrice, { nullable: true })
  @JoinColumn({ name: "table_price_id" })
  tablePrice?: AvancoLogisticsTablePrice | null;
}

