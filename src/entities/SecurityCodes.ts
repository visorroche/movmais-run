import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "./User.js";

export type SecurityCodeType = "email" | "phone";

@Entity({ name: "security_codes" })
export class SecurityCodes {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int", name: "user_id" })
  user_id!: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user?: User;

  @CreateDateColumn({ type: "timestamptz", name: "created_at" })
  created_at!: Date;

  @Column({ type: "varchar", length: 128, name: "code" })
  code!: string;

  @Column({ type: "varchar", length: 16 })
  type!: SecurityCodeType;

  @Column({ type: "varchar", length: 255 })
  reference!: string;

  @Column({ type: "timestamptz", name: "used_at", nullable: true })
  used_at!: Date | null;

  @Column({ type: "timestamptz", name: "expired_at" })
  expired_at!: Date;

  @Column({ type: "varchar", length: 64, name: "use_case" })
  use_case!: string;
}
