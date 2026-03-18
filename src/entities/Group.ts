import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm";
import { Company } from "./Company.js";

/**
 * Grupos de empresas (holding). Companies podem pertencer a um group.
 */
@Entity({ name: "groups" })
export class Group {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar" })
  name?: string;

  @OneToMany(() => Company, (company: Company) => company.group)
  companies?: Company[];
}
