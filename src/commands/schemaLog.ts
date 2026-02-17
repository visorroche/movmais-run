/**
 * Mostra o SQL que seria executado pelo schema:sync (apenas visualização, não altera o banco).
 * Útil para revisar diferenças antes de rodar o sync manual.
 *
 * Uso: npm run schema:log
 */
import "dotenv/config";
import "reflect-metadata";
import { AppDataSource } from "../utils/data-source.js";

async function main(): Promise<void> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  const sqlInMemory = await AppDataSource.driver.createSchemaBuilder().log();
  await AppDataSource.destroy();

  if (sqlInMemory.upQueries.length === 0) {
    console.log("Schema em dia — não há queries a executar na sincronização.");
    process.exit(0);
    return;
  }

  const sep = "".padStart(80, "-");
  console.log(sep);
  console.log(
    `Sincronização do schema executaria as seguintes ${sqlInMemory.upQueries.length} query(s):`
  );
  console.log(sep);
  for (const upQuery of sqlInMemory.upQueries) {
    let sql = upQuery.query.trim();
    if (!sql.endsWith(";")) sql += ";";
    console.log(sql);
    console.log();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
