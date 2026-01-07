import { Entity, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from "typeorm";
import { Company } from "./Company.js";
import { User } from "./User.js";

@Entity({ name: "company_users" })
export class CompanyUser {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Company, (company: Company) => company.companyUsers)
  @JoinColumn({ name: "company_id" })
  company?: Company;

  @ManyToOne(() => User, (user: User) => user.companyUsers)
  @JoinColumn({ name: "user_id" })
  user?: User;
}
