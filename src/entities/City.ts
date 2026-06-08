import { Entity, PrimaryGeneratedColumn, Column, Index } from "typeorm";

/**
 * Cidades (IBGE). Usado em endereços e regras de frete (ex.: Avanço).
 */
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

  @Column({ type: "smallint", default: 0 })
  numPeople?: number;

  @Column({ name: "zip_start", type: "text", nullable: true })
  zipStart?: string | null;

  @Column({ name: "zip_end", type: "text", nullable: true })
  zipEnd?: string | null;
}
