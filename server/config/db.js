import mysql from "mysql2/promise";
import { config } from "./env.js";
export const pool = mysql.createPool({
  ...config().db,
  waitForConnections: true,
  connectionLimit: 15,
  maxIdle: 10,
  idleTimeout: 60000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  timezone: "Z",
});
