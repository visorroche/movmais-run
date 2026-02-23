import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from "typeorm";
import { Company } from "./Company.js";
import { User } from "./User.js";
import type { BrazilianState } from "../utils/brazilian-states.js";

@Entity({ name: "representatives" })
@Unique("UQ_representatives_company_id_external_id", ["company", "externalId"])
export class Representative {
  @PrimaryGeneratedColumn()
  id!: number;

  /** Código interno do representante no ERP/CRM do cliente (quando existir). */
  @Column({ type: "varchar", nullable: true, name: "internal_code" })
  internalCode?: string | null;

  @ManyToOne(() => Company, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "user_id" })
  user?: User | null;

  @Column({ type: "varchar", nullable: true })
  externalId?: string | null;

  @Column({ type: "varchar", default: "" })
  name!: string;

  @Column({ type: "boolean", default: false })
  supervisor!: boolean;

  @ManyToOne(() => Representative, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "supervisor_id" })
  supervisorRef?: Representative | null;

  @Column({ type: "varchar", nullable: true })
  state?: BrazilianState | null;

  @Column({ type: "varchar", nullable: true })
  city?: string | null;

  @Column({ type: "varchar", nullable: true })
  document?: string | null;

  @Column({ type: "varchar", nullable: true })
  email?: string | null;

  @Column({ type: "varchar", nullable: true })
  phone?: string | null;

  @Column({ type: "varchar", nullable: true })
  zip?: string | null;

  @Column({ type: "varchar", nullable: true })
  address?: string | null;

  @Column({ type: "varchar", nullable: true })
  number?: string | null;

  @Column({ type: "varchar", nullable: true })
  complement?: string | null;

  @Column({ type: "varchar", nullable: true })
  neighborhood?: string | null;

  @Column({ type: "date", nullable: true, name: "created_at" })
  createdAt?: string | null;

  @Column({ type: "varchar", nullable: true })
  category?: string | null;

  @Column({ type: "text", nullable: true })
  obs?: string | null;
}

