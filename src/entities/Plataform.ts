import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm";
import { CompanyPlataform } from "./CompanyPlataform.js";

export type PlataformType = "ecommerce" | "logistic" | "b2b";

/** Entidade de referência para parâmetros do tipo "schema" (mapeamento tabela/colunas do banco do cliente). */
export type PlataformSchemaEntity = "products" | "customers" | "orders" | "representatives";

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

  @Column({ type: "jsonb" })
  parameters?: PlataformParameter[];

  @OneToMany(() => CompanyPlataform, (cp: CompanyPlataform) => cp.platform)
  companyPlatforms?: CompanyPlataform[];
}
