import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

export interface DbConfig {
  type: "sqlite" | "mysql";
  mysql: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
}

const CONFIG_PATH = path.join(process.cwd(), "db-config.json");

const DEFAULT_CONFIG: DbConfig = {
  type: "sqlite",
  mysql: {
    host: "127.0.0.1",
    port: 3306,
    user: "root",
    password: "",
    database: "career_app",
  },
};

export function getConfig(): DbConfig {
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as DbConfig;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function setConfig(config: DbConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
