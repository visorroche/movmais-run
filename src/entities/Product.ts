import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from "typeorm";
import { Company } from "./Company.js";

@Entity({ name: "products" })
@Unique("UQ_products_company_id_sku", ["company", "sku"])
export class Product {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Company, { nullable: false })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  // sku do produto na plataforma (Precode sku; Tray product_id)
  // SKU pode vir com valores grandes em integrações; manter como string para evitar overflow de int32 no Postgres.
  @Column({ type: "varchar" })
  sku!: string;

  // id do produto no ecommerce (no caso da Tray, é o mesmo `id` retornado no /web_api/products)
  @Column({ type: "integer", nullable: true })
  ecommerceId?: number | null;

  @Column({ type: "varchar", nullable: true })
  ean?: string | null;

  @Column({ type: "varchar", nullable: true })
  slug?: string | null;

  @Column({ type: "varchar", nullable: true })
  name?: string | null;

  @Column({ type: "varchar", nullable: true })
  storeReference?: string | null;

  // reference externo do parceiro (ex.: quando a Tray envia "45145[160151]", este campo armazena "160151")
  @Column({ type: "varchar", nullable: true })
  externalReference?: string | null;

  @Column({ type: "integer", nullable: true })
  brandId?: number | null;

  @Column({ type: "varchar", nullable: true })
  brand?: string | null;

  @Column({ type: "varchar", nullable: true })
  model?: string | null;

  // peso do produto (kg)
  @Column({ type: "numeric", precision: 14, scale: 3, nullable: true })
  weight?: string | null;

  // dimensões (cm)
  @Column({ type: "numeric", precision: 14, scale: 3, nullable: true })
  width?: string | null;

  @Column({ type: "numeric", precision: 14, scale: 3, nullable: true })
  height?: string | null;

  // OBS: nome da coluna no banco deve ser "lenght" (pedido)
  @Column({ name: "lenght", type: "numeric", precision: 14, scale: 3, nullable: true })
  lengthCm?: string | null;

  @Column({ type: "varchar", nullable: true })
  ncm?: string | null;

  @Column({ type: "varchar", nullable: true })
  category?: string | null;

  @Column({ type: "integer", nullable: true })
  categoryId?: number | null;

  @Column({ type: "varchar", nullable: true })
  subcategory?: string | null;

  @Column({ type: "varchar", nullable: true })
  finalCategory?: string | null;

  @Column({ type: "varchar", nullable: true })
  photo?: string | null;

  @Column({ type: "varchar", nullable: true })
  url?: string | null;

  // payload "cru" do parceiro (somente logs/auditoria)
  @Column({ type: "jsonb", nullable: true })
  raw?: unknown;
}


