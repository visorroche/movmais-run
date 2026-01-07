import express from "express";
import { registerCompany } from "./registerCompany.js";
import { registerPlataform, updatePlataform } from "./registerPlataform.js";
import { installPlataform } from "./installPlataform.js";

const router = express.Router();

router.post("/register-company", registerCompany);
router.post("/plataforms", registerPlataform);
router.put("/plataforms/:id", updatePlataform);
router.post("/company-plataforms", installPlataform);

export default router;
