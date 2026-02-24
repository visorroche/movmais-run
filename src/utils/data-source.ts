import "reflect-metadata";
import { DataSource } from "typeorm";
import { Company } from "../entities/Company.js";
import { Group } from "../entities/Group.js";
import { Plataform } from "../entities/Plataform.js";
import { CompanyPlataform } from "../entities/CompanyPlataform.js";
import { User } from "../entities/User.js";
import { CompanyUser } from "../entities/CompanyUser.js";
import { Customer } from "../entities/Customer.js";
import { CustomersGroup } from "../entities/CustomersGroup.js";
import { UserActivity } from "../entities/UserActivity.js";
import { Order } from "../entities/Order.js";
import { OrderItem } from "../entities/OrderItem.js";
import { Product } from "../entities/Product.js";
import { Representative } from "../entities/Representative.js";
import { FreightQuote } from "../entities/FreightQuote.js";
import { FreightQuoteItem } from "../entities/FreightQuoteItem.js";
import { FreightQuoteOption } from "../entities/FreightQuoteOption.js";
import { FreightOrder } from "../entities/FreightOrder.js";
import { FreightOrderItem } from "../entities/FreightOrderItem.js";
import { FreightResume } from "../entities/FreightResume.js";
import { IntegrationLog } from "../entities/IntegrationLog.js";
import { Log } from "../entities/Log.js";
import { SnakeNamingStrategy } from "./snake-naming-strategy.js";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "127.0.0.1",
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USERNAME || '',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || '',
  // Timeouts/keepalive para reduzir erros transitórios em conexões longas.
  // - connectionTimeoutMillis: timeout para conectar no DB
  // - query_timeout: timeout no client (pg) aguardando resposta
  // - statement_timeout: timeout no server (Postgres) por query
  extra: {
    keepAlive: true,
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 30_000),
    query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS ?? 300_000), // 5 min
    options: `-c statement_timeout=${Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 300_000)}`, // 5 min
  },
  // IMPORTANTE:
  // Padrão: false. Só habilite explicitamente em DEV (TYPEORM_SYNC=true).
  // Em projetos concorrentes apontando pro mesmo banco, isso pode causar ALTER/DROP.
  synchronize: process.env.TYPEORM_SYNC === "true",
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
    CustomersGroup,
    UserActivity,
    Order,
    Product,
    OrderItem,
    Representative,
    FreightQuote,
    FreightQuoteItem,
    FreightQuoteOption,
    FreightOrder,
    FreightOrderItem,
    FreightResume,
    IntegrationLog,
    Log,
  ],
  migrations: [],
  subscribers: [],
});
