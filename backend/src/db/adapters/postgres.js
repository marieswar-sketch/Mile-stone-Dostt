const { Pool } = require("pg");

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.on("error", (err) => console.error("[postgres] idle client error", err));
  }
  return pool;
}

/**
 * Build a simple WHERE clause from a plain conditions object.
 * e.g. { phone: "9999", country_code: "+91" }
 *   → "phone = $1 AND country_code = $2", ["9999", "+91"]
 */
function buildWhere(conditions, startIndex = 1) {
  const keys = Object.keys(conditions);
  if (!keys.length) return { clause: "", values: [] };
  const clause = keys.map((k, i) => `${k} = $${startIndex + i}`).join(" AND ");
  return { clause: `WHERE ${clause}`, values: Object.values(conditions) };
}

const adapter = {
  /** Raw parameterised query — escape hatch for complex SQL */
  async query(sql, params = []) {
    const client = await getPool().connect();
    try {
      const result = await client.query(sql, params);
      return result.rows;
    } finally {
      client.release();
    }
  },

  async findOne(table, conditions = {}) {
    const { clause, values } = buildWhere(conditions);
    const rows = await adapter.query(`SELECT * FROM ${table} ${clause} LIMIT 1`, values);
    return rows[0] || null;
  },

  async findMany(table, conditions = {}, { orderBy, limit } = {}) {
    const { clause, values } = buildWhere(conditions);
    let sql = `SELECT * FROM ${table} ${clause}`;
    if (orderBy) sql += ` ORDER BY ${orderBy}`;
    if (limit)   sql += ` LIMIT ${limit}`;
    return adapter.query(sql, values);
  },

  async insert(table, data) {
    const keys   = Object.keys(data);
    const values = Object.values(data);
    const cols   = keys.join(", ");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const rows = await adapter.query(
      `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return rows[0];
  },

  async upsert(table, data, conflictColumns) {
    const keys   = Object.keys(data);
    const values = Object.values(data);
    const cols   = keys.join(", ");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const conflict = conflictColumns.join(", ");
    const updateKeys = keys.filter(k => !conflictColumns.includes(k));
    const updates = updateKeys.map(k => `${k} = EXCLUDED.${k}`).join(", ");
    const onConflict = updates
      ? `DO UPDATE SET ${updates}`
      : `DO NOTHING`;
    const sql = `
      INSERT INTO ${table} (${cols}) VALUES (${placeholders})
      ON CONFLICT (${conflict}) ${onConflict}
      RETURNING *
    `;
    const rows = await adapter.query(sql, values);
    return rows[0];
  },

  async update(table, conditions, data) {
    const dataKeys   = Object.keys(data);
    const dataValues = Object.values(data);
    const setClauses = dataKeys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const { clause, values: whereValues } = buildWhere(conditions, dataKeys.length + 1);
    return adapter.query(
      `UPDATE ${table} SET ${setClauses} ${clause} RETURNING *`,
      [...dataValues, ...whereValues]
    );
  },

  async delete(table, conditions) {
    const { clause, values } = buildWhere(conditions);
    return adapter.query(`DELETE FROM ${table} ${clause} RETURNING *`, values);
  },
};

module.exports = adapter;
