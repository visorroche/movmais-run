import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn, Unique } from "typeorm";
import { Customer } from "./Customer.js";
import { OrderItem } from "./OrderItem.js";
import { Company } from "./Company.js";
import { Plataform } from "./Plataform.js";

@Entity({ name: "orders" })
@Unique("UQ_orders_company_id_order_code", ["company", "orderCode"])
export class Order {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "integer" })
  orderCode!: number; // codigoPedido

  // data de criação do pedido (order date)
  // No banco: order_date timestamp NULL
  @Column({ type: "timestamp", nullable: true })
  orderDate?: Date | null;

  @Column({ type: "varchar", nullable: true })
  partnerOrderId?: string | null; // pedidoParceiro

  @Column({ type: "varchar", nullable: true })
  currentStatus?: string | null; // status padronizado (nossos status)

  @Column({ type: "varchar", nullable: true })
  currentStatusCode?: string | null; // codigoStatusAtual

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  shippingAmount?: string | null; // valorFrete

  @Column({ type: "integer", nullable: true })
  deliveryDays?: number | null; // prazoEntrega

  @Column({ type: "date", nullable: true })
  deliveryDate?: string | null; // data prevista de entrega

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  totalAmount?: string | null; // valorTotalCompra

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  totalDiscount?: string | null; // valorTotalDesconto

  @Column({ type: "varchar", nullable: true })
  marketplaceName?: string | null; // nome do marketplace (ex.: Magalu, Shopee, etc.)

  @Column({ type: "varchar", nullable: true })
  channel?: string | null; // canal

  // Data de pagamento (Tray: payment_date; Precode: usamos order_date)
  @Column({ type: "date", nullable: true })
  paymentDate?: string | null;

  // Cupom aplicado (Tray: discount_coupon; Precode não tem → null)
  @Column({ type: "varchar", nullable: true })
  discountCoupon?: string | null;

  // endereço de entrega (por pedido)
  @Column({ type: "varchar", nullable: true })
  deliveryState?: string | null; // uf

  @Column({ type: "varchar", nullable: true })
  deliveryZip?: string | null; // cep / zip_code

  @Column({ type: "varchar", nullable: true })
  deliveryNeighborhood?: string | null; // bairro / neighborhood

  @Column({ type: "varchar", nullable: true })
  deliveryCity?: string | null; // cidade / city

  @Column({ type: "varchar", nullable: true })
  deliveryNumber?: string | null; // numero / number

  @Column({ type: "varchar", nullable: true })
  deliveryAddress?: string | null; // endereco / address

  @Column({ type: "varchar", nullable: true })
  deliveryComplement?: string | null; // complemento / complement

  // campos extras / específicos de integrações
  @Column({ type: "jsonb", nullable: true })
  metadata?: unknown;

  @Column({ type: "jsonb", nullable: true })
  storePickup?: unknown; // retiraLoja

  @Column({ type: "jsonb", nullable: true })
  payments?: unknown; // pagamento

  @Column({ type: "jsonb", nullable: true })
  tracking?: unknown; // dadosRastreio

  @Column({ type: "jsonb", nullable: true })
  timeline?: unknown; // dadosAcompanhamento

  @Column({ type: "jsonb", nullable: true })
  raw?: unknown;

  @ManyToOne(() => Customer, (customer: Customer) => customer.orders, { nullable: true })
  @JoinColumn({ name: "customer_id" })
  customer?: Customer;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => Plataform, { nullable: true })
  @JoinColumn({ name: "platform_id" })
  platform?: Plataform;

  @OneToMany(() => OrderItem, (item: OrderItem) => item.order)
  items?: OrderItem[];
}


