import type { Request, Response } from "express";
import { AppDataSource } from "../utils/data-source.js";
import { Company } from "../entities/Company.js";
import { Plataform, type PlataformParameter } from "../entities/Plataform.js";
import { CompanyPlataform } from "../entities/CompanyPlataform.js";

function asPositiveInt(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isProvided(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

export const installPlataform = async (req: Request, res: Response) => {
  const { company_id, plataform_id, config } = req.body ?? {};

  const companyId = asPositiveInt(company_id);
  const plataformId = asPositiveInt(plataform_id);
  if (!companyId || !plataformId) {
    return res.status(400).json({ error: 'Campos "company_id" e "plataform_id" devem ser inteiros positivos.' });
  }

  if (!isPlainObject(config)) {
    return res.status(400).json({ error: 'Campo "config" deve ser um objeto JSON (ex: { "code": "123" }).' });
  }

  const companyRepo = AppDataSource.getRepository(Company);
  const plataformRepo = AppDataSource.getRepository(Plataform);
  const companyPlataformRepo = AppDataSource.getRepository(CompanyPlataform);

  const company = await companyRepo.findOne({ where: { id: companyId } });
  if (!company) return res.status(404).json({ error: "Company não encontrada." });

  const plataform = await plataformRepo.findOne({ where: { id: plataformId } });
  if (!plataform) return res.status(404).json({ error: "Plataform não encontrada." });

  const parameters = (plataform.parameters ?? []) as PlataformParameter[];
  const allowed = new Set(parameters.map((p) => p.name));
  const required = parameters.filter((p) => p.required).map((p) => p.name);

  // valida chaves extras
  const extraKeys = Object.keys(config).filter((k) => !allowed.has(k));
  if (extraKeys.length > 0) {
    return res.status(400).json({
      error: "Config possui parâmetros não mapeados na plataforma.",
      extra_keys: extraKeys,
      allowed_keys: Array.from(allowed),
    });
  }

  const existing = await companyPlataformRepo.findOne({
    where: {
      company: { id: companyId },
      platform: { id: plataformId },
    },
    relations: { company: true, platform: true },
  });

  const incomingConfig = config as Record<string, unknown>;
  const mergedConfig = {
    ...((existing?.config as Record<string, unknown> | undefined) ?? {}),
    ...incomingConfig,
  };

  // valida obrigatórios (no config final que vai ser salvo)
  const missingRequired = required.filter((k) => !isProvided(mergedConfig[k]));
  if (missingRequired.length > 0) {
    return res.status(400).json({
      error: "Config não contém todos os parâmetros obrigatórios.",
      missing_required: missingRequired,
    });
  }

  if (existing) {
    existing.config = mergedConfig;
    const saved = await companyPlataformRepo.save(existing);
    return res.status(200).json(saved);
  }

  const cp = companyPlataformRepo.create({
    company,
    platform: plataform,
    config: mergedConfig,
  });
  const saved = await companyPlataformRepo.save(cp);

  return res.status(201).json(saved);
};


