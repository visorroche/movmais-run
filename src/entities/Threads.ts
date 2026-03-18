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

/**
 * Threads genéricas (reutilizável para custom_dashboard e outros fluxos de IA).
 */
@Entity({ name: "threads" })
export class Threads {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "int", name: "company_id" })
  company_id!: number;

  @ManyToOne(() => Company, { onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company?: Company;

  /** Tipo da entidade vinculada (ex.: custom_dashboard). */
  @Column({ type: "varchar", length: 64, name: "type_entity" })
  type_entity!: string;

  /** Id da entidade na tabela correspondente (ex.: id em custom_dashboards). */
  @Column({ type: "int", name: "entity_id" })
  entity_id!: number;

  /** Objeto atual (ex.: layout do dashboard na última resposta). */
  @Column({ type: "jsonb", nullable: true, name: "current_object" })
  current_object!: unknown;

  /** Id da conversa/thread na OpenAI (Assistants API). Opcional quando se usa Chat Completions sem thread. */
  @Column({ type: "varchar", length: 128, nullable: true, name: "openai_thread_id" })
  openai_thread_id!: string | null;

  /** Modelo usado (ex.: gpt-4.1). */
  @Column({ type: "varchar", length: 64, nullable: true, name: "model" })
  model!: string | null;

  /** Total de prompt tokens gastos na thread (para custo por cliente). */
  @Column({ type: "int", default: 0, name: "total_prompt_tokens" })
  total_prompt_tokens!: number;

  /** Total de completion tokens gastos na thread (para custo por cliente). */
  @Column({ type: "int", default: 0, name: "total_completion_tokens" })
  total_completion_tokens!: number;

  @CreateDateColumn({ type: "timestamptz", default: () => "now()", name: "created_at" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamptz", default: () => "now()", name: "updated_at" })
  updated_at!: Date;
}
