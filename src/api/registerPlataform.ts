import type { Request, Response } from "express";
import { QueryFailedError } from "typeorm";
import { AppDataSource } from "../utils/data-source.js";
import { Plataform } from "../entities/Plataform.js";

type PlataformType = "ecommerce" | "logistic";

type PlataformParameter = {
  label: string;
  name: string;
  description?: string;
  required: boolean;
};

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function findUniqueSlug(base: string): Promise<string> {
  const repo = AppDataSource.getRepository(Plataform);

  let i = 0;
  while (true) {
    const candidate = i === 0 ? base : `${base}-${i}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await repo.findOne({ where: { slug: candidate } });
    if (!exists) return candidate;
    i += 1;
  }
}

function isValidType(value: unknown): value is PlataformType {
  return value === "ecommerce" || value === "logistic";
}

function isValidParameters(value: unknown): value is PlataformParameter[] {
  if (!Array.isArray(value)) return false;
  return value.every((p) => {
    if (!p || typeof p !== "object") return false;
    const obj = p as Record<string, unknown>;
    if (typeof obj.label !== "string" || obj.label.trim() === "") return false;
    if (typeof obj.name !== "string" || obj.name.trim() === "") return false;
    if (typeof obj.required !== "boolean") return false;
    if (obj.description !== undefined && typeof obj.description !== "string") return false;
    return true;
  });
}

export const registerPlataform = async (req: Request, res: Response) => {
  const { type, slug, name, parameters } = req.body ?? {};

  if (!isValidType(type)) {
    return res.status(400).json({ error: 'Campo "type" deve ser "ecommerce" ou "logistic".' });
  }

  if (typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: 'Campo "name" é obrigatório.' });
  }

  if (!isValidParameters(parameters)) {
    return res.status(400).json({
      error:
        'Campo "parameters" deve ser um array de { label: string, name: string, description?: string, required: boolean }.',
    });
  }

  const repo = AppDataSource.getRepository(Plataform);

  const baseSlug = slugify(typeof slug === "string" && slug.trim() !== "" ? slug : name);
  if (!baseSlug) {
    return res.status(400).json({ error: 'Não foi possível gerar um "slug" válido.' });
  }

  let finalSlug = baseSlug;
  if (typeof slug === "string" && slug.trim() !== "") {
    const exists = await repo.findOne({ where: { slug: finalSlug } });
    if (exists) {
      return res.status(409).json({ error: 'Já existe uma plataforma com esse "slug".' });
    }
  } else {
    finalSlug = await findUniqueSlug(baseSlug);
  }

  const plataform = repo.create({
    type,
    name: name.trim(),
    slug: finalSlug,
    parameters,
  });

  try {
    await repo.save(plataform);
    return res.status(201).json(plataform);
  } catch (err: unknown) {
    const driverError = (err as { driverError?: unknown } | null)?.driverError as
      | { code?: unknown; constraint?: unknown; detail?: unknown }
      | undefined;

    if (err instanceof QueryFailedError && driverError?.code === "23505") {
      const constraint = typeof driverError.constraint === "string" ? driverError.constraint : undefined;
      if (constraint?.startsWith("PK_")) {
        return res.status(409).json({
          error:
            "Conflito ao criar plataforma: chave primária duplicada (sequência do Postgres pode estar fora de sincronia).",
          constraint,
        });
      }
      return res.status(409).json({
        error: "Conflito ao criar plataforma: violação de unicidade no banco.",
        constraint,
      });
    }

    console.error("[registerPlataform] erro ao salvar:", err);
    return res.status(500).json({ error: "Erro interno ao criar plataforma." });
  }
};

export const updatePlataform = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Parâmetro "id" inválido.' });
  }

  const { type, slug, name, parameters } = req.body ?? {};
  const repo = AppDataSource.getRepository(Plataform);

  const plataform = await repo.findOne({ where: { id } });
  if (!plataform) return res.status(404).json({ error: "Plataform não encontrada." });

  if (type !== undefined) {
    if (!isValidType(type)) {
      return res.status(400).json({ error: 'Campo "type" deve ser "ecommerce" ou "logistic".' });
    }
    plataform.type = type;
  }

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim() === "") {
      return res.status(400).json({ error: 'Campo "name" é obrigatório.' });
    }
    plataform.name = name.trim();
  }

  if (parameters !== undefined) {
    if (!isValidParameters(parameters)) {
      return res.status(400).json({
        error:
          'Campo "parameters" deve ser um array de { label: string, name: string, description?: string, required: boolean }.',
      });
    }
    plataform.parameters = parameters;
  }

  // slug: só altera se vier no payload; se não vier, mantém o atual
  if (slug !== undefined) {
    if (typeof slug !== "string" || slug.trim() === "") {
      return res.status(400).json({ error: 'Campo "slug" precisa ser uma string não vazia quando enviado.' });
    }
    const normalized = slugify(slug);
    if (!normalized) {
      return res.status(400).json({ error: 'Não foi possível gerar um "slug" válido.' });
    }

    const exists = await repo.findOne({ where: { slug: normalized } });
    if (exists && exists.id !== plataform.id) {
      return res.status(409).json({ error: 'Já existe uma plataforma com esse "slug".' });
    }
    plataform.slug = normalized;
  }

  // se ainda não tiver slug (casos antigos), tenta gerar a partir do name atual
  if (!plataform.slug) {
    const base = slugify(plataform.name ?? "");
    if (!base) {
      return res.status(400).json({ error: 'Não foi possível gerar um "slug" válido.' });
    }
    plataform.slug = await findUniqueSlug(base);
  }

  try {
    await repo.save(plataform);
    return res.status(200).json(plataform);
  } catch (err: unknown) {
    const driverError = (err as { driverError?: unknown } | null)?.driverError as
      | { code?: unknown; constraint?: unknown; detail?: unknown }
      | undefined;

    if (err instanceof QueryFailedError && driverError?.code === "23505") {
      const constraint = typeof driverError.constraint === "string" ? driverError.constraint : undefined;
      return res.status(409).json({
        error: "Conflito ao atualizar plataforma: violação de unicidade no banco.",
        constraint,
      });
    }

    console.error("[updatePlataform] erro ao salvar:", err);
    return res.status(500).json({ error: "Erro interno ao atualizar plataforma." });
  }
};


