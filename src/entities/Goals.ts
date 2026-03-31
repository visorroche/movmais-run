import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Company } from "./Company.js";
import { User } from "./User.js";

@Entity({ name: "goals" })
export class Goals {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "int", name: "company_id" })
  company_id!: number;

  @ManyToOne(() => Company, { onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company?: Company;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "numeric", precision: 18, scale: 4, name: "amount" })
  amount!: string;

  @Column({ type: "varchar", length: 32, name: "type_amount" })
  type_amount!: string;

  @Column({ type: "varchar", length: 128, name: "target_table" })
  target_table!: string;

  @Column({ type: "varchar", length: 128, name: "target_column" })
  target_column!: string;

  @Column({ type: "varchar", length: 32 })
  aggregation!: string;

  @Column({ type: "date", name: "start_date" })
  start_date!: string;

  @Column({ type: "date", name: "end_date" })
  end_date!: string;

  @Column({ type: "jsonb", nullable: true })
  filters!: unknown | null;

  @Column({ type: "int", name: "created_by_id" })
  created_by_id!: number;

  @ManyToOne(() => User, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "created_by_id" })
  created_by?: User;

  @CreateDateColumn({ type: "timestamptz", name: "created_at" })
  created_at!: Date;
}
