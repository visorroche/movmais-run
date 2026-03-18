import { Entity, PrimaryGeneratedColumn, Column, Index, Unique } from "typeorm";

/**
 * Resumo agregado de frete (totais, métricas). Com o resumo das cotações e pedidos de frete.
 * Plataformas: logistic
 */
@Entity({ name: "freight_resume" })
@Unique("UQ_freight_resume_company_date_channel_state_freight_deadline", [
  "companyId",
  "date",
  "channel",
  "state",
  "freightRange",
  "deadlineBucket",
])
@Index("idx_freight_resume_company_date", ["companyId", "date"])
@Index("idx_freight_resume_company_date_channel", ["companyId", "date", "channel"])
@Index("idx_freight_resume_company_date_state", ["companyId", "date", "state"])
export class FreightResume {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "int" })
  companyId!: number;

  @Column({ type: "date" })
  date!: Date;

  // canal, marketplace que gerou a cotacao Mercado Livre, Amazon, etc.
  @Column({ type: "varchar", length: 255, default: "" })
  channel!: string;

  // uf do estado de destino da cotacao 2 caracteres. Ex: SP, RJ, etc.
  @Column({ type: "varchar", length: 32, default: "" })
  state!: string;

  /** Faixa de valor do frete; NULL quando não há opção de entrega disponível. */
  @Column({ type: "varchar", length: 128, nullable: true })
  freightRange?: string | null;

  /** Bucket de prazo; NULL quando não há opção de entrega disponível. */
  @Column({ type: "varchar", length: 16, nullable: true })
  deadlineBucket?: string | null;

  // total de cotações
  @Column({ type: "int", default: 0 })
  totalSimulations!: number;

  // total de pedidos de frete efetivados
  @Column({ type: "int", default: 0 })
  totalOrders!: number;

  // total do valor das cotações
  @Column({ type: "numeric", precision: 18, scale: 2, nullable: true })
  totalValueSimulations?: string | null;

  // total do valor dos pedidos de frete efetivados
  @Column({ type: "numeric", precision: 18, scale: 2, nullable: true })
  totalValueOrders?: string | null;
}
