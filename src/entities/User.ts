import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from "typeorm";
import { CompanyUser } from "./CompanyUser.js";

export type UserType = 'admin' | 'user';

/**
 * Usuários do sistema (login). Acesso a companies via CompanyUser.
 */
@Entity({ name: "users" })
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: "varchar" })
  name?: string;

  @Column({ type: "enum", enum: ["admin", "user"] })
  type?: UserType;

  @Column({ type: "varchar", unique: true })
  email?: string;

  @Column({ type: "varchar", nullable: true })
  phone?: string | null;

  @Column({ type: "boolean", default: false, name: "phone_verified" })
  phoneVerified!: boolean;

  @Column({ type: "varchar" })
  password?: string;

  @OneToMany(() => CompanyUser, (cu: CompanyUser) => cu.user)
  companyUsers?: CompanyUser[];
}
