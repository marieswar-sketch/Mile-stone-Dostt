const { createClient } = require("@supabase/supabase-js");

let client;

function getClient() {
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return client;
}

function applyWhere(query, conditions) {
  for (const [key, value] of Object.entries(conditions)) {
    query = query.eq(key, value);
  }
  return query;
}

const adapter = {
  /** Raw SQL via Supabase rpc — requires a `raw_query` postgres function */
  async query(sql, params = []) {
    const { data, error } = await getClient().rpc("raw_query", { sql, params });
    if (error) throw error;
    return data;
  },

  async findOne(table, conditions = {}) {
    let q = getClient().from(table).select("*");
    q = applyWhere(q, conditions);
    const { data, error } = await q.limit(1).single();
    if (error && error.code === "PGRST116") return null; // not found
    if (error) throw error;
    return data;
  },

  async findMany(table, conditions = {}, { orderBy, limit } = {}) {
    let q = getClient().from(table).select("*");
    q = applyWhere(q, conditions);
    if (orderBy) q = q.order(orderBy);
    if (limit)   q = q.limit(limit);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },

  async insert(table, data) {
    const { data: rows, error } = await getClient()
      .from(table)
      .insert(data)
      .select()
      .single();
    if (error) throw error;
    return rows;
  },

  async upsert(table, data, conflictColumns) {
    const { data: rows, error } = await getClient()
      .from(table)
      .upsert(data, { onConflict: conflictColumns.join(",") })
      .select()
      .single();
    if (error) throw error;
    return rows;
  },

  async update(table, conditions, data) {
    let q = getClient().from(table).update(data);
    q = applyWhere(q, conditions);
    const { data: rows, error } = await q.select();
    if (error) throw error;
    return rows;
  },

  async delete(table, conditions) {
    let q = getClient().from(table).delete();
    q = applyWhere(q, conditions);
    const { data: rows, error } = await q.select();
    if (error) throw error;
    return rows;
  },
};

module.exports = adapter;
