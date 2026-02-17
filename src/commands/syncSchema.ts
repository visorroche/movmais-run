/**
 * Sincroniza o schema do banco com as entidades TypeORM (manual).
 * Não depende de TYPEORM_SYNC: pode deixar TYPEORM_SYNC=false e rodar este script quando quiser.
 *
 * Uso: npm run script:sync-schema
 */
import "dotenv/config";
import "reflect-metadata";
import { AppDataSource } from "../utils/data-source.js";

async function main(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  await AppDataSource.synchronize();
  console.log("Schema sincronizado com sucesso.");
  await AppDataSource.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
