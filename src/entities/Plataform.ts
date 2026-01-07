import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm";
import { CompanyPlataform } from "./CompanyPlataform.js";

export type PlataformType = "ecommerce" | "logistic";

export type PlataformParameter = {
  label: string;
  name: string;
  description?: string;
  required: boolean;
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
