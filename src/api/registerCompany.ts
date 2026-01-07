import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import { AppDataSource } from "../utils/data-source.js";
import { Company } from "../entities/Company.js";
import { Group } from "../entities/Group.js";
import { User } from "../entities/User.js";
import { CompanyUser } from "../entities/CompanyUser.js";

export const registerCompany = async (req: Request, res: Response) => {
  const {
    group_name,
    company_name,
    company_site,
    user_name,
    user_email,
    user_password,
  } = req.body;

  if (!company_name || !company_site || !user_name || !user_email || !user_password) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const userRepo = AppDataSource.getRepository(User);
  const companyRepo = AppDataSource.getRepository(Company);
  const groupRepo = AppDataSource.getRepository(Group);
  const companyUserRepo = AppDataSource.getRepository(CompanyUser);

  let group: Group | null = null;
  if (group_name) {
    group = await groupRepo.findOne({ where: { name: group_name } });
    if (!group) {
      group = groupRepo.create({ name: group_name });
      await groupRepo.save(group);
    }
  }

  const company = companyRepo.create({
    name: company_name,
    site: company_site,
    ...(group ? { group } : {}),
  });
  await companyRepo.save(company);

  const user = userRepo.create({
    name: user_name,
    email: user_email,
    password: createHash("md5").update(String(user_password), "utf8").digest("hex"),
    type: "user",
  });
  await userRepo.save(user);

  const companyUser = companyUserRepo.create({
    company,
    user,
  });
  await companyUserRepo.save(companyUser);

  return res.status(201).json({ company, user });
};
