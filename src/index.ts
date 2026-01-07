import "reflect-metadata";
import "dotenv/config";
import express from "express";
import { AppDataSource } from "./utils/data-source.js";
import apiRouter from "./api/index.js";

const app = express();
app.use(express.json());
app.use("/api", apiRouter);

const PORT = process.env.PORT || 3000;

AppDataSource.initialize()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Erro ao inicializar AppDataSource ou iniciar o servidor:', err);
    process.exit(1);
  });
