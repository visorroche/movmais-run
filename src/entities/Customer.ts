import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToOne, JoinColumn, Unique } from "typeorm";
import { Company } from "./Company.js";
import { Order } from "./Order.js";

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

  @Column({ type: "varchar", nullable: true })
  stateRegistration?: string | null; // inscEstadualRg

  @Column({ type: "varchar", nullable: true })
  personType?: string | null; // tipo

  @Column({ type: "varchar", nullable: true })
  legalName?: string | null; // nomeRazao

  @Column({ type: "varchar", nullable: true })
  tradeName?: string | null; // fantasia

  @Column({ type: "varchar", nullable: true })
  gender?: string | null; // sexo

  @Column({ type: "date", nullable: true })
  birthDate?: string | null; // dataNascimento

  @Column({ type: "varchar", nullable: true })
  email?: string | null;

  @Column({ type: "varchar", nullable: true })
  status?: string | null; // statusCliente

  @Column({ type: "jsonb", nullable: true })
  deliveryAddress?: unknown; // dadosEntrega

  @Column({ type: "jsonb", nullable: true })
  phones?: unknown; // telefones

  // payload "cru" do parceiro (somente para logs/auditoria)
  @Column({ type: "jsonb", nullable: true })
  raw?: unknown;

  @OneToMany(() => Order, (order: Order) => order.customer)
  orders?: Order[];
}


