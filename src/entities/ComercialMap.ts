import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from "typeorm";
import { Company } from "./Company.js";
import { Representative } from "./Representative.js";
import { ComercialMapAddress } from "./ComercialMapAddress.js";

@Entity({ name: "comercial_maps" })
export class ComercialMap {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @ManyToOne(() => Company, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => Representative, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "representative_id" })
  representative?: Representative | null;

  @Column({ type: "varchar", length: 180 })
  name!: string;

  @Column({ type: "varchar", length: 2, nullable: true })
  uf?: string | null;

  @Column({ type: "jsonb", nullable: true })
  cities?: unknown;

  @Column({ type: "int", nullable: true, name: "created_by" })
  createdBy?: number | null;

  @CreateDateColumn({ type: "timestamptz", name: "created_at", default: () => "now()" })
  createdAt!: Date;

  @Column({ type: "timestamptz", nullable: true, name: "deleted_at" })
  deletedAt?: Date | null;

  @OneToMany(() => ComercialMapAddress, (row) => row.comercialMap)
  addresses?: ComercialMapAddress[];
}
