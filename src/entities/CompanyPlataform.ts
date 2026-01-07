import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Unique } from "typeorm";
import { Company } from "./Company.js";
import { Plataform } from "./Plataform.js";

@Entity({ name: "company_platforms" })
@Unique("UQ_company_platforms_company_id_platform_id", ["company", "platform"])
export class CompanyPlataform {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "jsonb" })
  config?: any;

  @ManyToOne(() => Company, (company: Company) => company.companyPlatforms)
  @JoinColumn({ name: "company_id" })
  company?: Company;

  @ManyToOne(() => Plataform, (plataform: Plataform) => plataform.companyPlatforms)
  @JoinColumn({ name: "platform_id" })
  platform?: Plataform;
}
