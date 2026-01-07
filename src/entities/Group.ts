import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm";
import { Company } from "./Company.js";

@Entity({ name: "groups" })
export class Group {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar" })
  name?: string;

  @OneToMany(() => Company, (company: Company) => company.group)
  companies?: Company[];
}
