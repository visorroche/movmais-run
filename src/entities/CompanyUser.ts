import { Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Column } from "typeorm";
import { Company } from "./Company.js";
import { User } from "./User.js";

@Entity({ name: "company_users" })
export class CompanyUser {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @Column({ type: "boolean", default: false })
  owner!: boolean;

  // Define quais áreas do sistema o usuário (type="user") pode acessar dentro desta company.
  // Quando o user é type="admin", esse campo é ignorado.
  @Column({ type: "jsonb", default: () => `'["all"]'::jsonb` })
  polices!: string[];

  @Column({ type: "int", nullable: true })
  company_id?: number | null;

  @Column({ type: "int", nullable: true })
  user_id?: number | null;

  @ManyToOne(() => Company, (company: Company) => company.companyUsers, { nullable: true })
  @JoinColumn({ name: "company_id" })
  company?: Company;

  @ManyToOne(() => User, (user: User) => user.companyUsers, { nullable: true })
  @JoinColumn({ name: "user_id" })
  user?: User;
}
