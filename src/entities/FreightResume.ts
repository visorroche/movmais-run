import { Entity, PrimaryGeneratedColumn, Column, Index, Unique } from "typeorm";

/** Tabela de resumo por dia/canal/estado/faixa de frete e prazo. Preenchida pelo script resume:freight. */
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

  @Column({ type: "varchar", length: 255, default: "" })
  channel!: string;

  @Column({ type: "varchar", length: 32, default: "" })
  state!: string;

  /** Faixa de valor do frete; NULL quando não há opção de entrega disponível. */
  @Column({ type: "varchar", length: 128, nullable: true })
  freightRange?: string | null;

  /** Bucket de prazo; NULL quando não há opção de entrega disponível. */
  @Column({ type: "varchar", length: 16, nullable: true })
  deadlineBucket?: string | null;

  @Column({ type: "int", default: 0 })
  totalSimulations!: number;

  @Column({ type: "int", default: 0 })
  totalOrders!: number;

  @Column({ type: "numeric", precision: 18, scale: 2, nullable: true })
  totalValueSimulations?: string | null;

  @Column({ type: "numeric", precision: 18, scale: 2, nullable: true })
  totalValueOrders?: string | null;
}
