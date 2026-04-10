import type { Repository } from "typeorm";
import { AppDataSource } from "./data-source.js";
import type { Order } from "../entities/Order.js";
import { OrderItem } from "../entities/OrderItem.js";
import { AvancoStock } from "../entities/Avanco/AvancoStock.js";
import { AvancoStockMov } from "../entities/Avanco/AvancoStockMov.js";
import { findAvancoOperatorByCarrier } from "./avancoOperatorByCarrier.js";

/**
 * Baixa ou reverte estoque Avanço conforme carrier do pedido (sinônimos do operador).
 * Cancelado: remove movimentações type=order e devolve quantidade ao estoque.
 */
export async function applyAvancoStockMovForOrder(
  order: Order,
  orderRepo: Repository<Order>,
  companyOriginId: number,
  logPrefix: string,
): Promise<void> {
  const stockRepo = AppDataSource.getRepository(AvancoStock);
  const movRepo = AppDataSource.getRepository(AvancoStockMov);
  const itemRepo = AppDataSource.getRepository(OrderItem);
  const orderIdStr = String(order.id);

  if (order.currentStatus === "cancelado") {
    const movs = await movRepo.find({
      where: { type: "order" as const, typeId: orderIdStr },
    });
    for (const mov of movs) {
      const stock = await stockRepo.findOne({ where: { id: mov.avancoStockId } });
      if (stock) {
        stock.quantity = (stock.quantity ?? 0) + Math.abs(mov.quantity);
        await stockRepo.save(stock);
      }
      await movRepo.remove(mov);
    }
    return;
  }

  if (!order.carrier || !String(order.carrier).trim()) return;

  const operator = await findAvancoOperatorByCarrier(order.carrier, { companyOriginId });
  if (!operator) return;

  order.carrier = operator.company?.name ?? order.carrier;
  await orderRepo.save(order);

  const savedItems = await itemRepo.find({
    where: { order: { id: order.id } },
    relations: ["product"],
  });
  const qtyByProduct = new Map<number, number>();
  for (const oi of savedItems) {
    const productId = oi.product?.id ?? null;
    const qty = Math.max(0, Math.floor(Number(oi.quantity) ?? 0));
    if (productId == null || qty <= 0) continue;
    qtyByProduct.set(productId, (qtyByProduct.get(productId) ?? 0) + qty);
  }

  const missingStockFor: number[] = [];
  for (const [productId, totalQty] of qtyByProduct) {
    const stock = await stockRepo.findOne({
      where: {
        companyOriginId,
        companyLogisticId: operator.companyId,
        productId,
      },
    });
    if (!stock) {
      missingStockFor.push(productId);
      continue;
    }

    const existingMov = await movRepo.findOne({
      where: {
        avancoStockId: stock.id,
        type: "order" as const,
        typeId: orderIdStr,
      },
    });
    if (existingMov) continue;

    const mov = movRepo.create({
      avancoStockId: stock.id,
      quantity: -totalQty,
      type: "order",
      typeId: orderIdStr,
    });
    await movRepo.save(mov);
    stock.quantity = (stock.quantity ?? 0) - totalQty;
    await stockRepo.save(stock);
  }

  if (qtyByProduct.size > 0 && missingStockFor.length > 0) {
    console.warn(
      `[${logPrefix}] Avanço: operador ${operator.company?.name ?? "?"} (logistic_company_id=${operator.companyId}) sem linha avanco_stock para origin=${companyOriginId} product_id(s)=${missingStockFor.join(",")} order_id=${order.id} order_code=${order.orderCode ?? "?"}`,
    );
  }
}
