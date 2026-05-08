import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from "typeorm";
import { Company } from "./Company.js";

@Entity({ name: "custom_dashboards" })
export class CustomDashboards {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "int" })
  company_id!: number;

  /** Usuário que criou o dashboard; para draft só ele vê; para published depende de type_access. */
  @Column({ type: "int", nullable: true })
  user_id!: number | null;

  @ManyToOne(() => Company, (company: Company) => (company as any).custom_dashboards, { onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company?: Company;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 64, nullable: true, default: "Layout" })
  icon!: string | null;

  /** draft = em construção pelo chat; published = salvo e visível no menu */
  @Column({ type: "varchar", length: 20, default: "published" })
  status!: string;

  /** Se preenchido: este registro é um rascunho de edição do dashboard publicado com id = original_id. Ao publicar, aplica no original e remove o draft. */
  @Column({ type: "int", nullable: true, name: "original_id" })
  original_id!: number | null;

  /** Opcional: dashboard “pai” para agrupar no menu / breadcrumb (ex.: Representantes → filho “Venda do dia”). */
  @Column({ type: "int", nullable: true, name: "parent_id" })
  parent_id!: number | null;

  @ManyToOne(() => CustomDashboards, (d: CustomDashboards) => d.children, {
    onDelete: "SET NULL",
    nullable: true,
  })
  @JoinColumn({ name: "parent_id" })
  parent?: CustomDashboards | null;

  @OneToMany(() => CustomDashboards, (d: CustomDashboards) => d.parent)
  children?: CustomDashboards[];

  /** only = só o user_id vê; all = todos os usuários da empresa (só para published). */
  @Column({ type: "varchar", length: 10, default: "only" })
  type_access!: string;

  /** Se false, não entra na listagem do menu lateral; acesso só por URL direta. */
  @Column({ type: "boolean", default: true })
  menu!: boolean;

  @Column({ type: "int", default: 1 })
  version!: number;

  @Column({ type: "jsonb" })
  layout!: unknown;

  @CreateDateColumn({ type: "timestamptz", default: () => "now()", name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz", default: () => "now()", name: "updated_at" })
  updatedAt!: Date;
}
