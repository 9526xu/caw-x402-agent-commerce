import type { DemoConfig } from "../shared/config.js";
import { createSqliteProviderStore } from "./store.js";

export type DbPlan = {
  sqlitePath: string;
  status: "active";
};

export function dbPlan(config: DemoConfig): DbPlan {
  return {
    sqlitePath: config.sqlitePath,
    status: "active"
  };
}

export function openProviderStore(config: DemoConfig) {
  return createSqliteProviderStore(config.sqlitePath);
}
