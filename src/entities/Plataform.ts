import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm";
import { CompanyPlataform } from "./CompanyPlataform.js";

export type PlataformType = "ecommerce" | "logistic" | "b2b";

/** Entidade de referência para parâmetros do tipo "schema" (mapeamento tabela/colunas do banco do cliente). */
export type PlataformSchemaEntity = "products" | "customers" | "orders" | "representatives";

/**
 * Campos de pedido reconhecidos no `orders_schema.orderFields` (Database B2B / plataforma schema).
 * Espelha colunas persistidas em `orders` — ex.: `bonificacao` (0 normal, 1 bonificação), `active`.
 */
export type DatabaseB2bOrderSchemaFieldHint =
  | "bonificacao"
  | "active"
  | "external_id"
  | "order_code"
  | "order_date";

export type PlataformParameter = {
  label: string;
  name: string;
  description?: string;
  required: boolean;
  /** text | password | hidden | schema. Quando "schema", use schemaEntity. */
  type?: "text" | "password" | "hidden" | "schema";
  /** Obrigatório quando type === "schema": entidade de referência (products, customers, orders, representatives). */
  schemaEntity?: PlataformSchemaEntity;
};

/**
 * Plataformas de integração (Precode, Tray, AnyMarket, etc.). Uma company pode ter várias via CompanyPlataform.
 */
@Entity({ name: "platforms" })
export class Plataform {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar" })
  type?: PlataformType;

  @Column({ type: "varchar", unique: true })
  slug?: string;

  @Column({ type: "varchar" })
  name?: string;

  /** URL do logo da plataforma (ex.: para exibição na página de integrações). */
  @Column({ type: "varchar", nullable: true })
  logo?: string | null;

  /** URL do site da plataforma (abre em nova guia). */
  @Column({ type: "varchar", nullable: true })
  link?: string | null;

  /** Instruções de uso exibidas no topo do modal de configuração (app). */
  @Column({ type: "text", nullable: true })
  instructions?: string | null;

  @Column({ type: "jsonb" })
  parameters?: PlataformParameter[];

  @OneToMany(() => CompanyPlataform, (cp: CompanyPlataform) => cp.platform)
  companyPlatforms?: CompanyPlataform[];
}
