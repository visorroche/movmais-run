import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn } from "typeorm";
import { Group } from "./Group.js";
import { CompanyPlataform } from "./CompanyPlataform.js";
import { CompanyUser } from "./CompanyUser.js";

@Entity({ name: "companies" })
export class Company {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar" })
  name?: string;

  @Column({ type: "varchar" })
  site?: string;

  @ManyToOne(() => Group, (group: Group) => group.companies, { nullable: true })
  @JoinColumn({ name: "group_id" })
  group?: Group;

  @OneToMany(() => CompanyPlataform, (cp: CompanyPlataform) => cp.company)
  companyPlatforms?: CompanyPlataform[];

  @OneToMany(() => CompanyUser, (cu: CompanyUser) => cu.company)
  companyUsers?: CompanyUser[];

  // Configura quais "dashboards" aparecem no menu do front.
  // Defaults true para manter comportamento atual.
  @Column({ name: 'has_representatives', type: 'boolean', default: true })
  has_representatives!: boolean;

  @Column({ name: 'sells_on_marketplaces', type: 'boolean', default: true })
  sells_on_marketplaces!: boolean;

  // Dashboard específico (Televendas).
  @Column({ name: 'televendas', type: 'boolean', default: false })
  televendas!: boolean;

}
