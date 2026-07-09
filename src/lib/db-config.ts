import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

export interface DbConfig {
  installed?: boolean;
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
  installed: false,
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
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as DbConfig;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function isInstalled(): boolean {
  if (!existsSync(CONFIG_PATH)) return false;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as DbConfig;
    return parsed.installed === true;
  } catch {
    return false;
  }
}

export function setConfig(config: DbConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
