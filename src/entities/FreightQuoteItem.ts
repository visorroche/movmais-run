import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from "typeorm";
import { Company } from "./Company.js";
import { Product } from "./Product.js";
import { FreightQuote } from "./FreightQuote.js";

@Entity({ name: "freight_quotes_items" })
@Unique("UQ_freight_quotes_items_quote_id_line_index", ["quote", "lineIndex"])
export class FreightQuoteItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => FreightQuote, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "quote_id" })
  quote!: FreightQuote;

  @ManyToOne(() => Product, { nullable: true })
  @JoinColumn({ name: "product_id" })
  product?: Product | null;

  // stable identifier inside the quote payload
  @Column({ type: "integer" })
  lineIndex!: number;

  // AllPost product row fields (best-effort mapping)
  @Column({ type: "varchar", nullable: true })
  partnerSku?: string | null;

  @Column({ type: "integer", nullable: true })
  partnerSkuId?: number | null; // idSku

  @Column({ type: "integer", nullable: true })
  quantity?: number | null; // qt

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  price?: string | null; // preco

  @Column({ type: "integer", nullable: true })
  volumes?: number | null;

  @Column({ type: "integer", nullable: true })
  stock?: number | null;

  @Column({ type: "integer", nullable: true })
  stockProduct?: number | null;

  @Column({ type: "varchar", nullable: true })
  category?: string | null;

  @Column({ type: "varchar", nullable: true })
  aggregator?: string | null;

  @Column({ type: "varchar", nullable: true })
  partnerOriginalSku?: string | null;

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  channelPriceFrom?: string | null;

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  registrationPrice?: string | null;

  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  channelPriceTo?: string | null;

  @Column({ type: "jsonb", nullable: true })
  raw?: unknown;
}


