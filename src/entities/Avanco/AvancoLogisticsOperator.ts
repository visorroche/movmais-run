import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Company } from "../Company.js";

@Entity({ name: "avanco_logistics_operators" })
export class AvancoLogisticsOperator {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: "company_id", type: "int" })
  companyId!: number;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @Column({ name: "mov_comission_order", type: "numeric", nullable: true })
  movComissionOrder?: string | null;

  @Column({ type: "varchar", nullable: true })
  slug?: string | null;
}

