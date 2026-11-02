import { createHash } from "node:crypto";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { usd } from "../../domain/model.js";
import type { AgentProfile, AgentTask, Catalog, CatalogItem } from "../../ports/catalog.js";

/** Demo merchant (our own, labelled as a demo) and scripted agent plans. */
const ITEMS: CatalogItem[] = [
  { itemId: "os-coffee-exports", title: "Indonesia coffee exports 2025", vendor: "OpenStats", price: usd(0.2) },
  { itemId: "dh-market-deep-dive", title: "Coffee market deep-dive (premium)", vendor: "DataHarbor", price: usd(0.45) },
  { itemId: "qf-price-snapshot", title: "Arabica price snapshot", vendor: "QuickFacts", price: usd(0.1) },
  { itemId: "os-rainfall-yield", title: "Rainfall vs yield, Sumatra", vendor: "OpenStats", price: usd(0.25) },
  { itemId: "qf-farmgate", title: "Farmgate prices Q3", vendor: "QuickFacts", price: usd(0.08) },
  { itemId: "dh-retail-trends", title: "Retail coffee trends", vendor: "DataHarbor", price: usd(0.48) },
  { itemId: "sd-buyer-list", title: "Buyer contact list", vendor: "ShadyData", price: usd(0.05) },
  { itemId: "os-roaster-directory", title: "Roaster directory", vendor: "OpenStats", price: usd(0.3) },
  { itemId: "os-industry-report", title: "Full industry report", vendor: "OpenStats", price: usd(1.2) },
  { itemId: "os-price-index", title: "Weekly arabica price index", vendor: "OpenStats", price: usd(0.15) },
];

const AGENTS: AgentProfile[] = [
  { id: "research-agent", name: "Research Agent", role: "Buys data for market research" },
  { id: "shopping-agent", name: "Shopping Agent", role: "A different agent, same delegate key" },
];

const TASKS: AgentTask[] = [
  {
    id: "research-brief",
    agentId: "research-agent",
    title: "Coffee market brief",
    itemIds: ["os-coffee-exports", "dh-market-deep-dive", "qf-price-snapshot"],
  },
  {
    id: "research-update",
    agentId: "research-agent",
    title: "Weekly update",
    itemIds: ["os-coffee-exports", "os-rainfall-yield", "qf-farmgate", "dh-retail-trends", "sd-buyer-list"],
  },
  {
    id: "shopping-dashboard",
    agentId: "shopping-agent",
    title: "Datasets for a dashboard",
    itemIds: ["os-rainfall-yield", "os-roaster-directory", "qf-price-snapshot", "os-industry-report"],
  },
  {
    // Repeatable: a refused or failed payment leaves the item buyable, so step 5 of the demo can be re-run.
    id: "shopping-price-check",
    agentId: "shopping-agent",
    title: "Price check",
    itemIds: ["os-price-index"],
  },
];

export class DemoCatalog implements Catalog {
  items() {
    return ITEMS;
  }
  item(itemId: string) {
    return ITEMS.find((i) => i.itemId === itemId) ?? null;
  }
  agents() {
    return AGENTS;
  }
  tasks(agentId?: string) {
    return agentId ? TASKS.filter((t) => t.agentId === agentId) : TASKS;
  }
  task(taskId: string) {
    return TASKS.find((t) => t.id === taskId) ?? null;
  }
  /** Demo vendors get a fixed address derived from their name (nobody holds its key; dev only). */
  vendorAddress(vendor: string) {
    return normalizeSuiAddress(`0x${createHash("sha256").update(`mandate-demo-vendor:${vendor}`).digest("hex")}`);
  }
}
