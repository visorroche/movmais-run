import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import { Company } from "./Company.js";
import { User } from "./User.js";

/**
 * Memórias por empresa (e opcionalmente por usuário / agente de IA).
 * Espelha `api/src/entities/CompanyMemory.ts` — mesma tabela `company_memory`.
 */
@Entity({ name: "company_memory" })
@Index("idx_company_memory_company_id", ["company_id"])
@Index("idx_company_memory_company_user", ["company_id", "user_id"])
export class CompanyMemory {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "int", name: "company_id" })
  company_id!: number;

  @ManyToOne(() => Company, { onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company?: Company;

  @Column({ type: "int", name: "user_id", nullable: true })
  user_id!: number | null;

  @ManyToOne(() => User, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "user_id" })
  user?: User | null;

  @Column({ type: "text", name: "text" })
  text!: string;

  @Column({ type: "varchar", length: 128, nullable: true })
  agent!: string | null;

  @CreateDateColumn({ type: "timestamptz", name: "created_at" })
  created_at!: Date;
}
