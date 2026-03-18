import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Company } from "../Company.js";
import { AvancoLogisticsOperator } from "./AvancoLogisticsOperator.js";

/** Status do pedido logístico Avanço. Valores persistidos no banco (campo status). */
export enum AvancoLogisticOrderStatus {
  AguardandoAprovacao = "Aguardando Aprovação",
  Aprovado = "Aprovado",
  Rejeitado = "Rejeitado",
  MercadoriaEnviada = "Mercadoria Enviada",
  Recebido = "Recebido",
}

/**
 * Pedidos logísticos do módulo Avanço (operador logístico).
 * O módulo avanço serve para enviar mercadorias para operadores logisticos parceiros que conseguem fornecer uma competitividade logistica melhor, com menor preço de entrega e menor prazo de entrega.
 * Toda vez que a empresa quer enviar produtos para o operador logistico ela cria uma AvancoLogisticOrder.
 * Avanço: requer company.avanco=true
 */
@Entity({ name: "avanco_logistic_orders" })
export class AvancoLogisticOrder {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "order_code", type: "text", nullable: true })
  orderCode?: string | null;

  @Column({ name: "company_id", type: "int", nullable: true })
  companyId?: number | null;

  @ManyToOne(() => Company, { nullable: true })
  @JoinColumn({ name: "company_id" })
  company?: Company | null;

  @Column({ name: "logistic_operator_id", type: "int", nullable: true })
  logisticOperatorId?: number | null;

  @ManyToOne(() => AvancoLogisticsOperator, { nullable: true })
  @JoinColumn({ name: "logistic_operator_id" })
  logisticOperator?: AvancoLogisticsOperator | null;

  @Column({ type: "text", nullable: true })
  status?: AvancoLogisticOrderStatus | null;

  @Column({ name: "reject_reason", type: "text", nullable: true })
  rejectReason?: string | null;

  /** Quantidade de dias para o produto sair da company e ir para o operador logístico após aprovado. */
  @Column({ name: "delivery_days", type: "integer", nullable: true })
  deliveryDays?: number | null;

  @Column({ name: "created_at", type: "timestamptz", default: () => "now()" })
  createdAt!: Date;
}

