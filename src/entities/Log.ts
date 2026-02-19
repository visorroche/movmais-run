import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Company } from "./Company.js";
import { Plataform } from "./Plataform.js";

@Entity({ name: "logs" })
export class Log {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "date", nullable: true })
  date?: string | null;

  @Column({ type: "varchar" })
  command!: string;

  @Column({ type: "jsonb" })
  log!: Record<string, unknown>;

  @Column({ type: "jsonb", nullable: true })
  errors?: Record<string, unknown> | null;

  @ManyToOne(() => Company, { onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => Plataform, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "platform_id" })
  platform?: Plataform | null;

  @Column({ type: "timestamptz", name: "processed_at", default: () => "now()" })
  processedAt!: Date;

  @Column({ type: "varchar", nullable: true })
  status?: string | null;
}
