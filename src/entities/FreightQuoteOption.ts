import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from "typeorm";
import { Company } from "./Company.js";
import { FreightQuote } from "./FreightQuote.js";

@Entity({ name: "freight_quote_options" })
@Unique("UQ_freight_quote_options_freight_quote_id_line_index", ["freightQuote", "lineIndex"])
export class FreightQuoteOption {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => FreightQuote, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "freight_quote_id" })
  freightQuote!: FreightQuote;

  // índice estável dentro do array "delivery_options"
  @Column({ type: "integer" })
  lineIndex!: number;

  // valores do frete
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  shippingValue?: string | null; // freteCobrar

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  shippingCost?: string | null; // freteReal

  // dadosFrete.*
  @Column({ type: "varchar", nullable: true })
  carrier?: string | null; // dadosFrete.transportadoraNome

  @Column({ type: "varchar", nullable: true })
  warehouseUf?: string | null; // dadosFrete.filialUF

  @Column({ type: "varchar", nullable: true })
  warehouseCity?: string | null; // dadosFrete.filialCidade

  @Column({ type: "varchar", nullable: true })
  warehouseName?: string | null; // dadosFrete.filialNome

  @Column({ type: "varchar", nullable: true })
  shippingName?: string | null; // dadosFrete.metodoEnvioNome

  // prazos (prazoEntrega.* e prazoEntregaTotal)
  @Column({ type: "integer", nullable: true })
  carrierDeadline?: number | null; // prazoEntrega.prazoTransportadora

  @Column({ type: "integer", nullable: true })
  holidayDeadline?: number | null; // prazoEntrega.prazoEntregaFeriado

  @Column({ type: "integer", nullable: true })
  warehouseDeadline?: number | null; // prazoEntrega.prazoAdicionalFilial

  @Column({ type: "integer", nullable: true })
  deadline?: number | null; // prazoEntregaTotal

  @Column({ type: "boolean", nullable: true })
  hasStock?: boolean | null; // possuiEstoque (0/1 ou boolean)

  @Column({ type: "jsonb", nullable: true })
  raw?: unknown;
}

