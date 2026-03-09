import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Company } from "../Company.js";
import { AvancoLogisticsOperator } from "./AvancoLogisticsOperator.js";

@Entity({ name: "avanco_logistic_orders" })
export class AvancoLogisticOrder {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "order_code", type: "text", nullable: true })
  orderCode?: string | null;

  @Column({ name: "company_id", type: "int", nullable: true })
  companyId?: number | null;

  @ManyToOne(() => Company, { nullable: true })
  @JoinColumn({ name: "company_id" })
  company?: Company | null;

  @Column({ name: "logistic_operator_id", type: "int", nullable: true })
  logisticOperatorId?: number | null;

  @ManyToOne(() => AvancoLogisticsOperator, { nullable: true })
  @JoinColumn({ name: "logistic_operator_id" })
  logisticOperator?: AvancoLogisticsOperator | null;

  @Column({ type: "text", nullable: true })
  status?: string | null;

  @Column({ name: "reject_reason", type: "text", nullable: true })
  rejectReason?: string | null;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;
}

