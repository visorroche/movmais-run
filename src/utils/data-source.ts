import "reflect-metadata";
import { DataSource } from "typeorm";
import { Company } from "../entities/Company.js";
import { Group } from "../entities/Group.js";
import { Plataform } from "../entities/Plataform.js";
import { CompanyPlataform } from "../entities/CompanyPlataform.js";
import { User } from "../entities/User.js";
import { CompanyUser } from "../entities/CompanyUser.js";
import { Customer } from "../entities/Customer.js";
import { Order } from "../entities/Order.js";
import { OrderItem } from "../entities/OrderItem.js";
import { Product } from "../entities/Product.js";
import { FreightQuote } from "../entities/FreightQuote.js";
import { FreightQuoteItem } from "../entities/FreightQuoteItem.js";
import { SnakeNamingStrategy } from "./snake-naming-strategy.js";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USERNAME || '',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || '',
  synchronize: true,
  logging: false,
  namingStrategy: new SnakeNamingStrategy(),
  entities: [
    Company,
    Group,
    Plataform,
    CompanyPlataform,
    User,
    CompanyUser,
    Customer,
    Order,
    Product,
    OrderItem,
    FreightQuote,
    FreightQuoteItem,
  ],
  migrations: [],
  subscribers: [],
});
