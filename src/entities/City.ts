import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";

@Entity({ name: "cities" })
@Index("idx_cities_uf", ["uf"])
export class City {
  @PrimaryGeneratedColumn("increment", { type: "bigint" })
  id!: string;

  @Column({ name: "cd_ibge", type: "text", nullable: true })
  cdIbge?: string | null;

  @Column({ type: "text", nullable: true })
  uf?: string | null;

  @Column({ type: "text", nullable: true })
  city?: string | null;
}
