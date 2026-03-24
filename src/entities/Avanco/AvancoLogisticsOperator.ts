import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Company } from "../Company.js";

/**
 * Operadores logísticos do Avanço. Usado em pedidos logísticos (AvancoLogisticOrder).
 * Avanço: requer company.avanco=true
 *
 * synonyms: array de termos (razão social, nome fantasia, etc.) que identificam este operador.
 * Quando o carrier do pedido bater com algum sinônimo, gravamos order.carrier = company.name (nome da empresa do operador).
 * slug: mantido para compatibilidade; se synonyms estiver vazio, o matching usa slug.
 */
@Entity({ name: "avanco_logistics_operators" })
export class AvancoLogisticsOperator {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: "company_id", type: "int" })
  companyId!: number;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @Column({ name: "mov_comission_order", type: "numeric", nullable: true })
  movComissionOrder?: string | null;

  /** Lista de sinônimos para matching (ex.: ["FATLOG", "FITA AZUL TRANSPORTES E LOGISTICA LTDA"]). */
  @Column({ type: "jsonb", nullable: true })
  synonyms?: string[] | null;

  /** @deprecated Preferir synonyms; usado como fallback quando synonyms está vazio. */
  @Column({ type: "varchar", nullable: true })
  slug?: string | null;
}

