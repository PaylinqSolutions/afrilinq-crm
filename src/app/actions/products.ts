"use server";

import { act, optional, type ActionResult } from "@/server/action";
import { formToObject } from "@/lib/schemas";
import * as products from "@/server/services/products";

type A = ActionResult | null;

export async function createProductAction(_: A, fd: FormData) {
  return act(async (actor, db) => { const p = await products.createProduct(db, actor, formToObject(fd)); return { message: `${p.name} added to the catalogue.`, data: { id: p.id } }; }, ["/products", "/deals"]);
}
export async function updateProductAction(id: string, _: A, fd: FormData) {
  return act(async (actor, db) => { await products.updateProduct(db, actor, id, formToObject(fd), optional(fd, "_version")); return "Product saved."; }, ["/products", "/deals"]);
}
export async function setProductActiveAction(id: string, active: boolean, _: A, fd: FormData) {
  return act(async (actor, db) => {
    await products.setProductActive(db, actor, id, active, optional(fd, "reason"));
    return active ? "Product reactivated — staff can add it to deals again." : "Product retired. It can no longer be added to new deals; existing deals, tickets and training keep their history.";
  }, ["/products", "/deals"]);
}
