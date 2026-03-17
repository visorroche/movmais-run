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
import { CustomDashboards } from "./CustomDashboards.js";

@Entity({ name: "custom_dashboard_threads" })
export class CustomDashboardThreads {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @ManyToOne(() => Company, { onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => CustomDashboards, { onDelete: "SET NULL", nullable: true })
  @JoinColumn({ name: "custom_dashboard_id" })
  customDashboard?: CustomDashboards | null;

  @Column({ type: "varchar", length: 120, nullable: true })
  name!: string | null;

  @Column({ type: "jsonb", default: () => "'[]'" })
  messages!: Array<{ role: "user" | "assistant"; content: string }>;

  @Column({ type: "jsonb", nullable: true, name: "current_layout" })
  currentLayout!: unknown;

  @CreateDateColumn({ type: "timestamptz", default: () => "now()", name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz", default: () => "now()", name: "updated_at" })
  updatedAt!: Date;
}
