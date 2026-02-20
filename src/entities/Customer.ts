import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne, JoinColumn, Unique } from "typeorm";
import { Company } from "./Company.js";
import { CustomersGroup } from "./CustomersGroup.js";
import { Order } from "./Order.js";
import { Representative } from "./Representative.js";
import type { BrazilianState } from "../utils/brazilian-states.js";
import type { PersonType } from "../utils/person-type.js";
import type { Gender } from "../utils/gender.js";
import type { ActiveStatus } from "../utils/active-status.js";

@Entity({ name: "customers" })
@Unique("UQ_customers_company_id_external_id", ["company", "externalId"])
export class Customer {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  // id do customer na plataforma para essa company (ex: Tray customer_id; no Precode usamos cpfCnpj)
  @Column({ type: "varchar", nullable: true })
  externalId?: string | null;

  @Column({ type: "varchar" })
  taxId!: string; // cpfCnpj

  @Column({ type: "varchar", nullable: true, name: "state" })
  state?: BrazilianState | null; // UF

  @Column({ type: "varchar", nullable: true })
  personType?: PersonType | null; // PF | PJ

  @Column({ type: "varchar", nullable: true })
  legalName?: string | null; // nomeRazao

  @Column({ type: "varchar", nullable: true })
  tradeName?: string | null; // fantasia

  @Column({ type: "varchar", nullable: true })
  gender?: Gender | null; // F | M | B

  @Column({ type: "date", nullable: true })
  birthDate?: string | null; // dataNascimento

  @Column({ type: "varchar", nullable: true })
  email?: string | null;

  @Column({ type: "varchar", nullable: true })
  status?: ActiveStatus | null; // ACTIVE | INACTIVE

  @Column({ type: "jsonb", nullable: true })
  deliveryAddress?: unknown; // dadosEntrega

  @Column({ type: "jsonb", nullable: true })
  phones?: unknown; // telefones

  // payload "cru" do parceiro (somente para logs/auditoria)
  @Column({ type: "jsonb", nullable: true })
  raw?: unknown;

  /** Representante da carteira do cliente; vendas do cliente costumam ser lançadas nesse representante. */
  @ManyToOne(() => Representative, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "representative_id" })
  representative?: Representative | null;

  @ManyToOne(() => CustomersGroup, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "customer_group_id" })
  customerGroup?: CustomersGroup | null;

  @OneToMany(() => Order, (order: Order) => order.customer)
  orders?: Order[];
}


