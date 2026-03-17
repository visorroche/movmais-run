import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Company } from "./Company.js";

@Entity({ name: "custom_dashboards" })
export class CustomDashboards {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  /** Usuário que criou o dashboard; para draft só ele vê; para published depende de type_access. */
  @Column({ type: "int", nullable: true })
  user_id!: number | null;

  @ManyToOne(() => Company, (company: Company) => (company as any).custom_dashboards, { onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company?: Company;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 64, nullable: true, default: "Layout" })
  icon!: string | null;

  /** draft = em construção pelo chat; published = salvo e visível no menu */
  @Column({ type: "varchar", length: 20, default: "published" })
  status!: string;

  /** only = só o user_id vê; all = todos os usuários da empresa (só para published). */
  @Column({ type: "varchar", length: 10, default: "only" })
  type_access!: string;

  @Column({ type: "int", default: 1 })
  version!: number;

  @Column({ type: "jsonb" })
  layout!: unknown;

  @CreateDateColumn({ type: "timestamptz", default: () => "now()", name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz", default: () => "now()", name: "updated_at" })
  updatedAt!: Date;
}
