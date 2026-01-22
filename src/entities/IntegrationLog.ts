import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Company } from "./Company.js";
import { Plataform } from "./Plataform.js";

export type IntegrationCommand = "Pedidos" | "Cotações" | "Produtos";
export type IntegrationStatus = "PROCESSANDO" | "FINALIZADO" | "ERRO";

@Entity({ name: "logs" })
export class IntegrationLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: "processed_at", type: "timestamptz", default: () => "now()" })
  processedAt!: Date;

  // Data usada nos filtros do processamento (quando aplicável; ex.: start-date)
  @Column({ type: "date", nullable: true })
  date?: Date | null;

  @Column({ type: "varchar", nullable: true })
  status?: IntegrationStatus | null;

  @Column({ type: "varchar" })
  command!: IntegrationCommand;

  @Column({ type: "jsonb" })
  log!: unknown;

  @Column({ type: "jsonb", nullable: true })
  errors?: unknown | null;

  @Column({ name: "company_id", type: "int" })
  companyId!: number;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @Column({ name: "platform_id", type: "int", nullable: true })
  platformId?: number | null;

  @ManyToOne(() => Plataform, { nullable: true })
  @JoinColumn({ name: "platform_id" })
  platform?: Plataform | null;
}

