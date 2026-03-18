import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne, JoinColumn, Unique, Index } from "typeorm";
import { Company } from "./Company.js";
import { CustomersGroup } from "./CustomersGroup.js";
import { Order } from "./Order.js";
import { Representative } from "./Representative.js";
import type { BrazilianState } from "../utils/brazilian-states.js";
import type { PersonType } from "../utils/person-type.js";
import type { Gender } from "../utils/gender.js";

/**
 * Clientes finais da company (compradores). Usado em pedidos e em grupos de clientes (CustomersGroup).
 * Plataformas: ecommerce, b2b
 */
@Entity({ name: "customers" })
@Unique("UQ_customers_company_id_external_id", ["company", "externalId"])
@Index("idx_customers_company_internal_cod", ["company", "internalCod"])
@Index("idx_customers_customer_group_id", ["customerGroup"])
export class Customer {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  // id do customer no sistema dele (ex: Tray customer_id; no Precode usamos cpfCnpj)
  @Column({ type: "varchar", nullable: true })
  externalId?: string | null;

  // CPF ou Cnpj do cliente
  @Column({ type: "varchar" })
  taxId!: string; 

  /** Código interno do cliente no ERP/CRM do cliente. */
  @Column({ type: "varchar", nullable: true, name: "internal_cod" })
  internalCod?: string | null;

  /** Data de cadastro do cliente (quando fornecida pela integração). */
  @Column({ type: "date", nullable: true, name: "created_at" })
  createdAt?: string | null;

  @Column({ type: "varchar", nullable: true })
  segmentation?: string | null;

  @Column({ type: "varchar", nullable: true })
  address?: string | null;

  @Column({ type: "varchar", nullable: true })
  zip?: string | null;

  @Column({ type: "varchar", nullable: true })
  city?: string | null;

  @Column({ type: "varchar", nullable: true })
  neighborhood?: string | null;

  @Column({ type: "varchar", nullable: true })
  number?: string | null;

  @Column({ type: "varchar", nullable: true })
  complement?: string | null;

  @Column({ type: "varchar", nullable: true, name: "state" })
  state?: BrazilianState | null; // UF

  @Column({ type: "varchar", nullable: true })
  personType?: PersonType | null; // PF | PJ

  @Column({ type: "varchar", nullable: true })
  legalName?: string | null; // nomeRazao

  @Column({ type: "varchar", nullable: true })
  tradeName?: string | null; // fantasia

  @Column({ type: "varchar", nullable: true })
  gender?: Gender | null; 

  // data de nascimento do cliente
  @Column({ type: "date", nullable: true })
  birthDate?: string | null; 

  @Column({ type: "varchar", nullable: true })
  email?: string | null;

  // status ativo/inativo do cliente usar só true 
  @Column({ type: "boolean", nullable: true })
  status?: boolean | null;

  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  deliveryAddress?: unknown; // dadosEntrega

  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  phones?: unknown; // telefones

  // NOMAP
  @Column({ type: "text", nullable: true })
  obs?: string | null;

  // NOMAP - payload "cru" do parceiro (somente para logs/auditoria)
  @Column({ type: "jsonb", nullable: true })
  raw?: unknown;

  /** Representante da carteira do cliente; vendas do cliente costumam ser lançadas nesse representante. */
  @ManyToOne(() => Representative, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "representative_id" })
  representative?: Representative | null;

  // UM CLIENTE PODE PERTENCER A UM GRUPO MAIOR DE CLIENTES UTIL PARA AGRUPAR CLIENTES DA MESMA REDE
  @ManyToOne(() => CustomersGroup, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "customer_group_id" })
  customerGroup?: CustomersGroup | null;

  @OneToMany(() => Order, (order: Order) => order.customer)
  orders?: Order[];
}


