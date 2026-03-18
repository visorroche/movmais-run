import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from "typeorm";
import { Company } from "./Company.js";
import { FreightQuote } from "./FreightQuote.js";

/**
 * Opções de entrega de uma cotação (transportadora, prazo, custo). Uma FreightQuote tem várias opções; a melhor é usada em best_deadline/best_freight_cost.
 * Plataformas: logistic
 */
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

  // NOMAP - Níndice estável dentro do array "delivery_options"
  @Column({ type: "integer" })
  lineIndex!: number;

  // valor do frete repassado para o cliente
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  shippingValue?: string | null; // freteCobrar

  // valor do custo do frete real que a empresa paga
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  shippingCost?: string | null; // freteReal

  // nome da transportadora
  @Column({ type: "varchar", nullable: true })
  carrier?: string | null; // dadosFrete.transportadoraNome

  // UF do centro de distribuição
  @Column({ type: "varchar", nullable: true })
  warehouseUf?: string | null; // dadosFrete.filialUF

  // Cidade do centro de distribuição
  @Column({ type: "varchar", nullable: true })
  warehouseCity?: string | null; // dadosFrete.filialCidade

  // Nome do centro de distribuição
  @Column({ type: "varchar", nullable: true })
  warehouseName?: string | null; // dadosFrete.filialNome

  // Nome do método de envio
  @Column({ type: "varchar", nullable: true })
  shippingName?: string | null; // dadosFrete.metodoEnvioNome

  // NOMAP
  @Column({ type: "integer", nullable: true })
  carrierDeadline?: number | null; // prazoEntrega.prazoTransportadora

  // NOMAP
  @Column({ type: "integer", nullable: true })
  holidayDeadline?: number | null; // prazoEntrega.prazoEntregaFeriado

  // NOMAP
  @Column({ type: "integer", nullable: true })
  warehouseDeadline?: number | null; // prazoEntrega.prazoAdicionalFilial

  // Prazo estimado de entrega 
  @Column({ type: "integer", nullable: true })
  deadline?: number | null; 

  // NOMAP
  @Column({ type: "boolean", nullable: true })
  hasStock?: boolean | null; // possuiEstoque (0/1 ou boolean)

  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  raw?: unknown;
}

