import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn, Unique, Index } from "typeorm";
import { Customer } from "./Customer.js";
import { OrderItem } from "./OrderItem.js";
import { Company } from "./Company.js";
import { Plataform } from "./Plataform.js";
import { Representative } from "./Representative.js";
import type { OrderStatus } from "../utils/status/index.js";

/**
 * Pedidos de venda (e-commerce, B2B, marketplaces). Um pedido pertence a um customer e pode ter representantes e assistentes.
 * Plataformas: ecommerce, b2b
 */
@Entity({ name: "orders" })
@Index("idx_orders_customer_id", ["customer"])
@Index("idx_orders_company_customer_orderdate", ["company", "customer", "orderDate"])
@Unique("UQ_orders_company_id_order_code", ["company", "orderCode"])
export class Order {
  @PrimaryGeneratedColumn()
  id!: number;

  /** ID externo do pedido no banco do cliente (quando existir). */
  @Column({ type: "varchar", nullable: true, name: "external_id" })
  externalId?: string | null;

  /** Código do pedido na plataforma (pode exceder int32; ex.: Panorama `codigo`). Pode ser NULL no banco (legado / sync). */
  @Column({ type: "varchar", length: 64, nullable: true })
  orderCode?: string | null;

  // data de criação do pedido (order date)
  // No banco: order_date timestamp NULL
  @Column({ type: "timestamp", nullable: true })
  orderDate?: Date | null;

  @Column({ type: "varchar", nullable: true })
  partnerOrderId?: string | null; // pedidoParceiro

  @Column({ type: "varchar", nullable: true })
  currentStatus?: OrderStatus | null; // status padronizado (ORDER_STATUSES)

  @Column({ type: "varchar", nullable: true })
  currentStatusCode?: string | null; // codigoStatusAtual

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  shippingAmount?: string | null; // valorFrete

  @Column({ type: "integer", nullable: true })
  deliveryDays?: number | null; // prazoEntrega

  /** Data prevista de entrega (ex.: previsaoEntrega da API). */
  @Column({ type: "date", nullable: true, name: "delivery_forecast" })
  deliveryForecast?: string | null;

  /** Data de entrega efetiva: preenchida apenas quando existe status "entregue" em dadosAcompanhamento. */
  @Column({ type: "date", nullable: true, name: "delivery_date" })
  deliveryDate?: string | null;

  // total do pedido
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  totalAmount?: string | null; 

  // total do desconto aplicado no pedido
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  totalDiscount?: string | null; 

  // nome do marketplace (ex.: Magalu, Shopee, etc.)
  @Column({ type: "varchar", nullable: true })
  marketplaceName?: string | null; 

  // NOMAP
  @Column({ type: "varchar", nullable: true, default: "offline" })
  channel?: string | null; 

  // Data de pagamento (Tray: payment_date; Precode: usamos order_date)
  @Column({ type: "date", nullable: true })
  paymentDate?: string | null;

  /** Forma de pagamento (ex.: Panorama `formaPagamento`). */
  @Column({ type: "varchar", nullable: true, name: "payment_type" })
  paymentType?: string | null;

  /** Número de parcelas; à vista = 1 quando a API envia null. */
  @Column({ type: "integer", nullable: true, name: "payment_installments" })
  paymentInstallments?: number | null;

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

  /** Transportadora (ex.: GBex Express, carrier da API). */
  @Column({ type: "varchar", nullable: true })
  carrier?: string | null;

  /** Filial / cidade de distribuição (ex.: Fortaleza-CE, deliveryMethodName). */
  @Column({ type: "varchar", nullable: true })
  subsidiary?: string | null;

  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  metadata?: unknown;

  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  storePickup?: unknown; // retiraLoja

  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  payments?: unknown; // pagamento

  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  tracking?: unknown; // dadosRastreio

  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  timeline?: unknown; // dadosAcompanhamento

  // NOMAP
  @Column({ type: "jsonb", nullable: true })
  raw?: unknown;

  @ManyToOne(() => Customer, (customer: Customer) => customer.orders, { nullable: true })
  @JoinColumn({ name: "customer_id" })
  customer?: Customer;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  // NOMAP
  @ManyToOne(() => Plataform, { nullable: true })
  @JoinColumn({ name: "platform_id" })
  platform?: Plataform;

  // Uma venda pode ter um representante que é o vendedor do pedido
  @ManyToOne(() => Representative, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "representative_id" })
  representative?: Representative | null;

  // Uma venda pode ter um assistente que ajudou o vendedor a fechar a venda
  @ManyToOne(() => Representative, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "assistant_id" })
  assistant?: Representative | null;

  // Uma venda pode ter um supervisor que é o supervisor do vendedor e ajudou a fechar a venda
  @ManyToOne(() => Representative, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "supervisor_id" })
  supervisor?: Representative | null;

  @OneToMany(() => OrderItem, (item: OrderItem) => item.order)
  items?: OrderItem[];
}


