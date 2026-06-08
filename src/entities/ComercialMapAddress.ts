import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Company } from "./Company.js";
import { ComercialMap } from "./ComercialMap.js";
import { Customer } from "./Customer.js";

@Entity({ name: "comercial_maps_address" })
export class ComercialMapAddress {
  @PrimaryGeneratedColumn("increment")
  id!: number;

  @ManyToOne(() => Company, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "company_id" })
  company!: Company;

  @ManyToOne(() => ComercialMap, (row) => row.addresses, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "comercial_map_id" })
  comercialMap!: ComercialMap;

  @ManyToOne(() => Customer, { nullable: false, onDelete: "CASCADE" })
  @JoinColumn({ name: "customer_id" })
  customer!: Customer;

  @Column({ type: "int", name: "order" })
  order!: number;

  @Column({ type: "jsonb", nullable: true })
  geolocation?: unknown;

  @CreateDateColumn({ type: "timestamptz", name: "created_at", default: () => "now()" })
  createdAt!: Date;

  @Column({ type: "timestamptz", nullable: true, name: "removed_at" })
  removedAt?: Date | null;
}
