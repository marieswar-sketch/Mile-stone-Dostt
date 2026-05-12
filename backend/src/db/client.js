/**
 * Generic DB client — swap adapters via DB_ADAPTER env variable.
 *
 * Supported values: "postgres" (default) | "supabase"
 *
 * Every adapter exposes the same interface:
 *   query(sql, params?)          – raw SQL (postgres) / rpc (supabase)
 *   findOne(table, conditions)
 *   findMany(table, conditions, { orderBy?, limit? })
 *   insert(table, data)
 *   upsert(table, data, conflictColumns[])
 *   update(table, conditions, data)
 *   delete(table, conditions)
 */

const adapter = process.env.DB_ADAPTER === "supabase"
  ? require("./adapters/supabase")
  : require("./adapters/postgres");

module.exports = adapter;
