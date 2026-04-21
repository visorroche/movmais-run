import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Company } from "./Company.js";
import { User } from "./User.js";

/**
 * Mensagens programadas (cron) disparadas pela API (Insights / Z-API).
 * Espelho da entidade na API para `sync-schema`: destino é `userId` OU `cargo`; `createdBy` quem registrou.
 */
@Entity({ name: "recurrent_messages" })
export class RecurrentMessage {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: "company_id", type: "int" })
  companyId!: number;

  @ManyToOne(() => Company, { onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @Column({ type: "varchar", length: 191 })
  name!: string;

  /** Destinatário quando envio é para um usuário específico. */
  @Column({ name: "user_id", type: "int", nullable: true })
  userId?: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "user_id" })
  user?: User | null;

  /** Quem criou a regra (Insights). */
  @Column({ name: "created_by", type: "int", nullable: true })
  createdBy?: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "created_by" })
  createdByUser?: User | null;

  @Column({ type: "varchar", length: 191, nullable: true })
  cargo?: string | null;

  @Column({ type: "text" })
  prompt!: string;

  @Column({ type: "varchar", length: 128 })
  recurrent!: string;

  @Column({ type: "boolean", default: true })
  active!: boolean;

  @Column({ name: "created_at", type: "timestamptz", default: () => "CURRENT_TIMESTAMP" })
  createdAt!: Date;

  @Column({ name: "last_sent_at", type: "timestamptz", nullable: true })
  lastSentAt?: Date | null;
}
