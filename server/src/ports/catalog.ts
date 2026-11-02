import type { MicroUsd } from "../domain/model.js";

export interface CatalogItem {
  itemId: string;
  title: string;
  vendor: string;
  price: MicroUsd;
}

export interface AgentTask {
  id: string;
  agentId: string;
  title: string;
  itemIds: string[];
}

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
}

/** The demo merchant and the scripted agent plans. */
export interface Catalog {
  items(): CatalogItem[];
  item(itemId: string): CatalogItem | null;
  agents(): AgentProfile[];
  tasks(agentId?: string): AgentTask[];
  task(taskId: string): AgentTask | null;
  /** The Sui address a vendor is paid at. Agents only ever pay this address. */
  vendorAddress(vendor: string): string;
}
