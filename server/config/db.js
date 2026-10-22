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
  // MySQL DATETIME values in this deployment use Philippine local time.
  // Decode them in UTC+8 before JSON serialization adds the UTC `Z` suffix.
  timezone: "+08:00",
  // Birthdays are calendar dates, not instants that should change timezone.
  dateStrings: ["DATE"],
});

// The driver's timezone option does not set MySQL's session timezone. Keep
// TIMESTAMP reads and NOW() consistent with DATETIME, even on a UTC server.
pool.on("connection", (connection) => {
  connection.query("SET SESSION time_zone = '+08:00'");
});
