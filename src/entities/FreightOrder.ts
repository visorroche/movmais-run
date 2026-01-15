import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from "typeorm";
import { Company } from "./Company.js";
import { Plataform } from "./Plataform.js";

@Entity({ name: "freight_orders" })
@Unique("UQ_freight_orders_company_id_platform_id_external_id", ["company", "platform", "externalId"])
export class FreightOrder {
  @PrimaryGeneratedColumn()
  id!: number;

  // AllPost: _id
  @Column({ type: "varchar" })
  externalId!: string;

  // AllPost: data (ex: "2022-10-01 00:00:00")
  @Column({ type: "timestamptz", nullable: true })
  orderDate?: Date | null;

  // AllPost: numeroPedido
  @Column({ type: "varchar", nullable: true })
  orderCode?: string | null;

  // AllPost: nomeLoja
  @Column({ type: "varchar", nullable: true })
  storeName?: string | null;

  // AllPost: idCotacao
  @Column({ type: "varchar", nullable: true })
  quoteId?: string | null;

  // AllPost: canal
  @Column({ type: "varchar", nullable: true })
  channel?: string | null;

  // AllPost: valorFreteCobrado
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  freightAmount?: string | null;

  // AllPost: valorFreteReal
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  freightCost?: string | null;

  // AllPost: valorFreteDiferencaPedidoCotacao
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  deltaQuote?: string | null;

  // enderecoEntrega.*
  @Column({ type: "varchar", nullable: true })
  address?: string | null;

  @Column({ type: "varchar", nullable: true })
  addressZip?: string | null;

  @Column({ type: "varchar", nullable: true })
  addressState?: string | null;

  @Column({ type: "varchar", nullable: true })
  addressCity?: string | null;

  @Column({ type: "varchar", nullable: true })
  addressNeighborhood?: string | null;

  @Column({ type: "varchar", nullable: true })
  addressNumber?: string | null;

  @Column({ type: "varchar", nullable: true })
  addressComplement?: string | null;

  // derivados de envio[] (sempre max)
  @Column({ type: "timestamptz", nullable: true })
  estimatedDeliveryDate?: Date | null; // max(envio.prazoEntregaPedido)

  @Column({ type: "timestamptz", nullable: true })
  deliveryDate?: Date | null; // max(envio.dataEntrega)

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  deltaQuoteDeliveryDate?: string | null; // max(envio.diferencaPedidoCotacao)

  @Column({ type: "jsonb", nullable: true })
  raw?: unknown;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => Plataform, { nullable: true })
  @JoinColumn({ name: "platform_id" })
  platform?: Plataform;
}

