import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Threads } from "./Threads.js";
import { User } from "./User.js";

/**
 * Mensagens de cada thread (uma linha por mensagem do usuário ou do assistente).
 */
@Entity({ name: "thread_messages" })
export class ThreadMessages {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "int", name: "thread_id" })
  thread_id!: number;

  @ManyToOne(() => Threads, { onDelete: "CASCADE" })
  @JoinColumn({ name: "thread_id" })
  thread?: Threads;

  /** Conteúdo da mensagem do usuário (null na linha da resposta do assistente). */
  @Column({ type: "text", nullable: true, name: "message_input" })
  message_input!: string | null;

  /** Conteúdo da resposta do assistente (null na linha da mensagem do usuário). */
  @Column({ type: "text", nullable: true, name: "message_output" })
  message_output!: string | null;

  @Column({ type: "int", nullable: true, name: "user_id" })
  user_id!: number | null;

  @ManyToOne(() => User, { onDelete: "SET NULL" })
  @JoinColumn({ name: "user_id" })
  user?: User | null;

  @CreateDateColumn({ type: "timestamptz", default: () => "now()", name: "created_at" })
  created_at!: Date;

  /** Objeto gerado naquela resposta (ex.: layout do dashboard). Preenchido só na mensagem do assistente. */
  @Column({ type: "jsonb", nullable: true, name: "json_object" })
  json_object!: unknown;

  /** Prompt tokens gastos nesta troca de mensagem (preenchido na linha da resposta do assistente). */
  @Column({ type: "int", nullable: true, name: "prompt_tokens" })
  prompt_tokens!: number | null;

  /** Completion tokens gastos nesta troca de mensagem (preenchido na linha da resposta do assistente). */
  @Column({ type: "int", nullable: true, name: "completion_tokens" })
  completion_tokens!: number | null;

  /** Id da mensagem no provedor externo (ex.: Z-API `messageId`); único quando preenchido, para deduplicar webhooks. */
  @Column({ type: "varchar", length: 191, nullable: true, name: "external_message_id", unique: true })
  external_message_id!: string | null;
}
