import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from "typeorm";
import { Company } from "./Company.js";
import { Category } from "./Category.js";

@Entity({ name: "products" })
@Unique("UQ_products_company_id_sku", ["company", "sku"])
export class Product {
  @PrimaryGeneratedColumn()
  id!: number;

  /** ID externo do produto no banco do cliente (quando existir). */
  @Column({ type: "varchar", nullable: true, name: "external_id" })
  externalId?: string | null;

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

  /** Preço/valor do produto. */
  @Column({ type: "numeric", precision: 14, scale: 2, nullable: true })
  value?: string | null;

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

  /** ID da categoria na plataforma externa (Tray, Precode, etc.). */
  @Column({ type: "integer", nullable: true, name: "external_category_id" })
  externalCategoryId?: number | null;

  /** Vínculo com categoria do nosso banco (tabela categories). */
  @ManyToOne(() => Category, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "category_id" })
  categoryRef?: Category | null;

  @Column({ type: "varchar", nullable: true })
  subcategory?: string | null;

  @Column({ type: "varchar", nullable: true })
  finalCategory?: string | null;

  // Quando TRUE, integrações não devem sobrescrever category/subcategory/finalCategory/brand/model
  @Column({ type: "boolean", name: "manual_attributes_locked", default: false })
  manualAttributesLocked!: boolean;

  // true = ativo; false = inativo. Mantemos o produto para preservar vínculo com vendas antigas.
  @Column({ type: "boolean", default: true })
  active!: boolean;

  @Column({ type: "varchar", nullable: true })
  photo?: string | null;

  @Column({ type: "varchar", nullable: true })
  url?: string | null;

  // payload "cru" do parceiro (somente logs/auditoria)
  @Column({ type: "jsonb", nullable: true })
  raw?: unknown;
}


