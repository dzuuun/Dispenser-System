import mysql from "mysql2/promise";
import { config } from "./env.js";
export const pool = mysql.createPool({
  ...config().db,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: "Z",
});
