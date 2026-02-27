import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Unique } from "typeorm";
import { Company } from "./Company.js";

@Entity({ name: "customers_group" })
@Unique("UQ_customers_group_company_id_external_id", ["company", "externalId"])
export class CustomersGroup {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Company, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @Column({ type: "varchar", name: "external_id", nullable: true })
  externalId?: string | null;

  @Column({ type: "varchar" })
  name!: string;

  @CreateDateColumn({ type: "timestamp", name: "created_at" })
  createdAt!: Date;
}
