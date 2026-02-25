import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn, Unique } from "typeorm";
import { Company } from "./Company.js";

@Entity({ name: "categories" })
@Unique("UQ_categories_company_parent_name", ["company", "parentId", "name"])
export class Category {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Company, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @Column({ type: "varchar" })
  name!: string;

  // Array de strings (sinônimos) para ajudar em matching/classificação.
  @Column({ type: "jsonb", nullable: true, default: () => "'[]'::jsonb" })
  synonymous!: string[];

  // Level começa em 1 (raiz). Mantemos explícito para facilitar consultas.
  @Column({ type: "integer" })
  level!: number;

  @Column({ type: "integer", nullable: true, name: "parent_id" })
  parentId!: number | null;

  @ManyToOne(() => Category, (c) => (c as any).children, { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "parent_id" })
  parent!: Category | null;

  @OneToMany(() => Category, (c) => (c as any).parent)
  children!: Category[];
}

